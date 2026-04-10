import * as readline from 'readline';
import { getAppUrl } from '../utils/config.js';
import { saveTokens, parseJwt, clearTokens } from './auth-store.js';
import { fetchWithDiagnostics } from './http.js';
import { config } from '../utils/config.js';
import * as output from '../utils/output.js';
import type { AuthTokens } from '../utils/types.js';

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * Authenticate smscli using a Personal Access Token.
 * Prompts the user to paste a token created in the web UI.
 */
export async function loginWithPat(): Promise<AuthTokens> {
  const tokensUrl = `${getAppUrl()}/settings/tokens`;

  output.blank();
  output.info('To authenticate smscli, you need a Personal Access Token (PAT).');
  output.blank();
  output.dim('  1. Open this URL in your browser and sign in:');
  output.bold(`     ${tokensUrl}`);
  output.dim('  2. Click "Create Token", give it a name (e.g. "smscli"),');
  output.dim('     set an expiration, then copy the token.');
  output.dim('  3. Paste the token below and press Enter.');
  output.blank();

  const pasted = (await prompt('Paste your PAT: ')).trim();

  if (!pasted) {
    throw new Error('No token provided. Aborting.');
  }

  // Basic JWT shape validation (3 segments).
  const parts = pasted.split('.');
  if (parts.length !== 3) {
    throw new Error('That does not look like a valid token (expected 3 JWT segments).');
  }

  // Parse exp from JWT payload to populate expiresAt for status display.
  const payload = parseJwt(pasted);
  if (!payload) {
    throw new Error('Failed to decode token payload.');
  }
  const exp = typeof payload.exp === 'number' ? payload.exp : null;
  if (!exp) {
    throw new Error('Token has no expiration claim.');
  }

  const tokens: AuthTokens = {
    accessToken: pasted,
    expiresAt: exp * 1000, // JWT exp is seconds since epoch
  };

  // Save first so apiRequest can pick it up.
  saveTokens(tokens);

  // Verify with the server.
  output.info('Verifying…');
  const res = await fetchWithDiagnostics(`${config.apiUrl}/auth/me`, {
    headers: { Authorization: `Bearer ${pasted}` },
  });

  if (!res.ok) {
    // Roll back the saved token so the user isn't left with a bad file.
    clearTokens();
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { message?: string }).message ||
        `Server rejected the token (HTTP ${res.status}). Make sure the token is active and not revoked.`,
    );
  }

  return tokens;
}
