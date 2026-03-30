import { Command } from 'commander';
import {
  config,
  getAppUrl,
  getApiUrl,
  getAppUrlSource,
  setAppUrl,
  clearConfig,
} from '../utils/config.js';
import { OutputManager } from '../utils/output.js';
import * as out from '../utils/output.js';
import type { GlobalOptions } from '../utils/types.js';

function getOutput(cmd: Command): OutputManager {
  const opts = cmd.optsWithGlobals<GlobalOptions>();
  return new OutputManager(opts.json ? 'json' : opts.quiet ? 'quiet' : 'human');
}

export function registerConfigCommands(program: Command): void {
  const cfg = program
    .command('config')
    .description(
      'View and manage CLI configuration. Configuration controls the API URL and is stored ' +
      'at ~/.config/smscli/config.json. Environment variables (SMSCLI_APP_URL, SMSCLI_API_URL) ' +
      'take precedence over the config file.',
    );

  // -----------------------------------------------------------------------
  // show
  // -----------------------------------------------------------------------
  cfg
    .command('show')
    .description(
      'Display the current CLI configuration including the API URL (and whether it came from ' +
      'an environment variable, config file, or default), config directory path, and auth file location.',
    )
    .action((_opts: unknown, cmd: Command) => {
      const output = getOutput(cmd);
      const data = {
        appUrl: getAppUrl(),
        apiUrl: getApiUrl(),
        urlSource: getAppUrlSource(),
        configDir: config.configDir,
        configFile: config.configFile,
        authFile: config.authFile,
      };

      output.result(
        data,
        (d) => {
          out.header('Configuration');
          out.keyValue('App URL', `${d.appUrl} (${d.urlSource})`);
          out.keyValue('API URL', d.apiUrl);
          out.keyValue('Config Dir', d.configDir);
          out.keyValue('Config File', d.configFile);
          out.keyValue('Auth File', d.authFile);
        },
        (d) => console.log(d.apiUrl),
      );
    });

  // -----------------------------------------------------------------------
  // set-url
  // -----------------------------------------------------------------------
  cfg
    .command('set-url')
    .description(
      'Set the Sink application base URL. The API URL is derived by appending "/api". ' +
      'Persisted to ~/.config/smscli/config.json. ' +
      'Example: smscli config set-url https://vitalmesh.dev.marin.cr',
    )
    .argument('<url>', 'The application base URL (e.g., https://vitalmesh.dev.marin.cr).')
    .action((url: string, _opts: unknown, cmd: Command) => {
      const output = getOutput(cmd);
      // Strip trailing slash
      const cleanUrl = url.replace(/\/+$/, '');
      setAppUrl(cleanUrl);
      output.result(
        { appUrl: cleanUrl, apiUrl: `${cleanUrl}/api` },
        (d) => out.success(`URL set. API URL: ${d.apiUrl}`),
        (d) => console.log(d.apiUrl),
      );
    });

  // -----------------------------------------------------------------------
  // reset
  // -----------------------------------------------------------------------
  cfg
    .command('reset')
    .description(
      'Reset all CLI configuration to defaults. Removes the config file but preserves ' +
      'authentication tokens. After reset, the default URL (http://localhost:3535) is used.',
    )
    .action((_opts: unknown, cmd: Command) => {
      const output = getOutput(cmd);
      clearConfig();
      output.result(
        { message: 'Configuration reset to defaults' },
        () => out.success('Configuration reset to defaults.'),
        () => console.log('ok'),
      );
    });
}
