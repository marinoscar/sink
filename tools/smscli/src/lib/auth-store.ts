import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { dirname } from 'path';
import { config } from '../utils/config.js';
import type { AuthTokens } from '../utils/types.js';

/**
 * Save authentication tokens to disk.
 * File is created with mode 0o600 (owner read/write only).
 */
export function saveTokens(tokens: AuthTokens): void {
  const dir = dirname(config.authFile);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(config.authFile, JSON.stringify(tokens, null, 2), {
    mode: 0o600,
  });
}

/**
 * Load stored authentication tokens, or null if none exist.
 */
export function loadTokens(): AuthTokens | null {
  try {
    if (!existsSync(config.authFile)) return null;
    const content = readFileSync(config.authFile, 'utf-8');
    return JSON.parse(content) as AuthTokens;
  } catch {
    return null;
  }
}

/**
 * Delete stored tokens (logout).
 */
export function clearTokens(): void {
  try {
    if (existsSync(config.authFile)) unlinkSync(config.authFile);
  } catch { /* ignore */ }
}

/**
 * Returns true when the access token is expired (or within 30 s of expiry).
 */
export function isTokenExpired(tokens: AuthTokens): boolean {
  return Date.now() >= tokens.expiresAt - 30_000;
}

/**
 * Decode the JWT payload without cryptographic verification.
 */
export function parseJwt(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = Buffer.from(parts[1], 'base64').toString('utf-8');
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

/**
 * Extract user info from the stored access token.
 */
export function getUserFromToken(
  tokens: AuthTokens,
): { email: string; roles: string[] } | null {
  const payload = parseJwt(tokens.accessToken);
  if (!payload) return null;
  return {
    email: payload.email as string,
    roles: payload.roles as string[],
  };
}
