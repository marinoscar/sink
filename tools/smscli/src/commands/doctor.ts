import { Command } from 'commander';
import chalk from 'chalk';
import { config, getApiUrl, getAppUrlSource } from '../utils/config.js';
import { loadTokens, isTokenExpired, getUserFromToken } from '../lib/auth-store.js';
import { checkHealth, getCurrentUser, getMessages, getDevices } from '../lib/api-client.js';
import { OutputManager } from '../utils/output.js';
import * as out from '../utils/output.js';
import type { GlobalOptions } from '../utils/types.js';

function getOutput(cmd: Command): OutputManager {
  const opts = cmd.optsWithGlobals<GlobalOptions>();
  return new OutputManager(opts.json ? 'json' : opts.quiet ? 'quiet' : 'human');
}

interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
  hint?: string;
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description(
      'Run a comprehensive health check of the CLI setup. ' +
      'Checks: (1) Configuration — API URL and source, ' +
      '(2) API connectivity — can reach the health endpoint, ' +
      '(3) Authentication — tokens exist and are valid, user info, ' +
      '(4) SMS permissions — can query the messages endpoint, ' +
      '(5) Devices — lists registered devices and SIMs. ' +
      'Reports pass/fail for each check with remediation suggestions.',
    )
    .action(async (_opts: unknown, cmd: Command) => {
      const output = getOutput(cmd);
      const checks: CheckResult[] = [];

      // 1. Configuration
      const apiUrl = getApiUrl();
      const source = getAppUrlSource();
      checks.push({
        name: 'Configuration',
        pass: true,
        detail: `API URL: ${apiUrl} (source: ${source})`,
      });

      // 2. API connectivity
      let apiReachable = false;
      try {
        const health = await checkHealth();
        apiReachable = health.live;
        checks.push({
          name: 'API Connectivity',
          pass: health.live && health.ready,
          detail: `live=${health.live}, ready=${health.ready}`,
          hint: !health.live
            ? `Cannot reach ${apiUrl}. Check the URL with "smscli config set-url <url>".`
            : !health.ready
              ? 'API is live but not ready (database may be down).'
              : undefined,
        });
      } catch {
        checks.push({
          name: 'API Connectivity',
          pass: false,
          detail: `Cannot connect to ${apiUrl}`,
          hint: 'Check the URL with "smscli config set-url <url>" or verify the server is running.',
        });
      }

      // 3. Authentication
      const tokens = loadTokens();
      if (!tokens) {
        checks.push({
          name: 'Authentication',
          pass: false,
          detail: 'No tokens stored',
          hint: 'Run "smscli auth login" to authenticate.',
        });
      } else {
        const expired = isTokenExpired(tokens);
        const local = getUserFromToken(tokens);
        let email = local?.email ?? 'unknown';

        if (apiReachable && !expired) {
          try {
            const user = await getCurrentUser();
            email = user.email;
          } catch { /* use local */ }
        }

        checks.push({
          name: 'Authentication',
          pass: true,
          detail: `${email}${expired ? ' (token expired — will auto-refresh)' : ''}`,
        });
      }

      // 4. SMS permissions
      if (tokens && apiReachable) {
        try {
          await getMessages({ page: 1, pageSize: 1 });
          checks.push({
            name: 'SMS Permissions',
            pass: true,
            detail: 'Can query messages endpoint',
          });
        } catch (err) {
          checks.push({
            name: 'SMS Permissions',
            pass: false,
            detail: (err as Error).message,
            hint: 'Your account may lack the "device_text_messages:read" permission. Contact an admin.',
          });
        }
      } else {
        checks.push({
          name: 'SMS Permissions',
          pass: false,
          detail: 'Skipped (no auth or API unreachable)',
          hint: 'Fix authentication and connectivity first.',
        });
      }

      // 5. Devices
      if (tokens && apiReachable) {
        try {
          const devices = await getDevices();
          const simCount = devices.reduce((n, d) => n + d.sims.length, 0);
          checks.push({
            name: 'Devices',
            pass: devices.length > 0,
            detail: `${devices.length} device(s), ${simCount} SIM(s)`,
            hint: devices.length === 0
              ? 'No devices registered. Install the Sink Android app and register a device.'
              : undefined,
          });
        } catch (err) {
          checks.push({
            name: 'Devices',
            pass: false,
            detail: (err as Error).message,
          });
        }
      } else {
        checks.push({
          name: 'Devices',
          pass: false,
          detail: 'Skipped (no auth or API unreachable)',
        });
      }

      // Output
      const allPass = checks.every((c) => c.pass);

      output.result(
        { checks, allPass },
        (data) => {
          out.header('Doctor');
          for (const c of data.checks) {
            const icon = c.pass ? chalk.green('✓') : chalk.red('✗');
            console.log(`  ${icon} ${chalk.bold(c.name)}: ${c.detail}`);
            if (c.hint) {
              console.log(`    ${chalk.yellow('→')} ${c.hint}`);
            }
          }
          out.blank();
          if (data.allPass) {
            out.success('All checks passed!');
          } else {
            out.warn('Some checks failed. See hints above.');
          }
        },
        (data) => console.log(data.allPass ? 'ok' : 'fail'),
      );

      if (!allPass) process.exit(1);
    });
}
