import { Command } from 'commander';
import { loginWithPat } from '../lib/pat-auth.js';
import {
  loadTokens,
  clearTokens,
  isTokenExpired,
  getUserFromToken,
} from '../lib/auth-store.js';
import { getCurrentUser } from '../lib/api-client.js';
import { getAppUrl } from '../utils/config.js';
import { OutputManager } from '../utils/output.js';
import * as out from '../utils/output.js';
import type { GlobalOptions } from '../utils/types.js';

function getOutput(cmd: Command): OutputManager {
  const opts = cmd.optsWithGlobals<GlobalOptions>();
  const mode = opts.json ? 'json' : opts.quiet ? 'quiet' : 'human';
  return new OutputManager(mode);
}

export function registerAuthCommands(program: Command): void {
  const auth = program
    .command('auth')
    .description(
      'Manage authentication with the Sink API using a Personal Access Token (PAT).',
    );

  // -----------------------------------------------------------------------
  // login
  // -----------------------------------------------------------------------
  auth
    .command('login')
    .description(
      `Authenticate with the Sink API by pasting a Personal Access Token created at ${getAppUrl()}/settings/tokens. Stores the token locally at ~/.config/smscli/auth.json.`,
    )
    .action(async (_opts: unknown, cmd: Command) => {
      const output = getOutput(cmd);
      try {
        await loginWithPat();
        const userInfo = await getCurrentUser();

        output.result(
          { email: userInfo.email, roles: userInfo.roles },
          (data) => {
            out.success(`Logged in as ${data.email}`);
            if (data.roles?.length) {
              out.dim(`Roles: ${data.roles.join(', ')}`);
            }
          },
          (data) => console.log(data.email),
        );
      } catch (err) {
        output.fail((err as Error).message, 'AUTH_FAILED');
        process.exit(1);
      }
    });

  // -----------------------------------------------------------------------
  // logout
  // -----------------------------------------------------------------------
  auth
    .command('logout')
    .description(
      'Remove all stored authentication tokens from the local machine. ' +
      'After logout, you must run "smscli auth login" again to use authenticated commands.',
    )
    .action((_opts: unknown, cmd: Command) => {
      const output = getOutput(cmd);
      clearTokens();
      output.result(
        { message: 'Logged out successfully' },
        () => out.success('Logged out successfully.'),
        () => console.log('ok'),
      );
    });

  // -----------------------------------------------------------------------
  // status
  // -----------------------------------------------------------------------
  auth
    .command('status')
    .description(
      'Display the current authentication state: logged-in user email, assigned roles, ' +
      'access token expiration time, and whether the token is still valid or expired.',
    )
    .action(async (_opts: unknown, cmd: Command) => {
      const output = getOutput(cmd);
      const tokens = loadTokens();

      if (!tokens) {
        output.result(
          { authenticated: false },
          () => out.warn('Not logged in. Run: smscli auth login'),
          () => console.log('not_authenticated'),
        );
        return;
      }

      const expired = isTokenExpired(tokens);
      const localUser = getUserFromToken(tokens);

      let remoteUser: { email: string; displayName: string; roles: string[] } | null = null;
      if (!expired) {
        try {
          remoteUser = await getCurrentUser();
        } catch { /* ignore — offline or token just expired */ }
      }

      const email = remoteUser?.email ?? localUser?.email ?? 'unknown';
      const roles = remoteUser?.roles ?? localUser?.roles ?? [];
      const expiresAt = new Date(tokens.expiresAt).toISOString();

      output.result(
        { authenticated: true, email, roles, expiresAt, expired },
        () => {
          out.header('Auth Status');
          out.keyValue('Email', email);
          out.keyValue('Roles', roles.join(', ') || '—');
          out.keyValue('Expires', expiresAt);
          out.keyValue('Status', expired ? '⚠ Expired (run smscli auth login)' : '✓ Valid');
        },
        () => console.log(email),
      );
    });
}
