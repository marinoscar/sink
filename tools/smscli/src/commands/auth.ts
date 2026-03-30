import { Command } from 'commander';
import { loginWithDeviceFlow, refreshAccessToken } from '../lib/device-flow.js';
import {
  loadTokens,
  clearTokens,
  isTokenExpired,
  getUserFromToken,
} from '../lib/auth-store.js';
import { getCurrentUser } from '../lib/api-client.js';
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
      'Manage authentication with the Sink API. ' +
      'Uses the OAuth 2.0 Device Authorization flow (RFC 8628) to obtain and persist access tokens.',
    );

  // -----------------------------------------------------------------------
  // login
  // -----------------------------------------------------------------------
  auth
    .command('login')
    .description(
      'Authenticate with the Sink API using the OAuth 2.0 Device Authorization flow (RFC 8628). ' +
      'Opens a browser to the activation page, displays a one-time user code, and polls until ' +
      'the user approves the device. Stores tokens locally at ~/.config/smscli/auth.json.',
    )
    .action(async (_opts: unknown, cmd: Command) => {
      const output = getOutput(cmd);
      try {
        const tokens = await loginWithDeviceFlow();
        const userInfo = getUserFromToken(tokens);

        output.result(
          { email: userInfo?.email, roles: userInfo?.roles },
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
          out.keyValue('Status', expired ? '⚠ Expired (will auto-refresh)' : '✓ Valid');
        },
        () => console.log(email),
      );
    });

  // -----------------------------------------------------------------------
  // refresh
  // -----------------------------------------------------------------------
  auth
    .command('refresh')
    .description(
      'Force an immediate refresh of the access token using the stored refresh token. ' +
      'Useful when the access token is about to expire and you want to avoid interruption ' +
      'during a long operation.',
    )
    .action(async (_opts: unknown, cmd: Command) => {
      const output = getOutput(cmd);
      const tokens = loadTokens();

      if (!tokens) {
        output.fail('Not logged in. Run: smscli auth login', 'NOT_AUTHENTICATED');
        process.exit(1);
      }

      try {
        const newTokens = await refreshAccessToken(tokens.refreshToken);
        const expiresAt = new Date(newTokens.expiresAt).toISOString();
        output.result(
          { refreshed: true, expiresAt },
          () => out.success(`Token refreshed. New expiry: ${expiresAt}`),
          () => console.log('ok'),
        );
      } catch (err) {
        output.fail((err as Error).message, 'REFRESH_FAILED');
        process.exit(1);
      }
    });
}
