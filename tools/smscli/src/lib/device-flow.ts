import { config } from '../utils/config.js';
import * as output from '../utils/output.js';
import { saveTokens } from './auth-store.js';
import { VERSION } from '../version.js';
import type { AuthTokens } from '../utils/types.js';

/** Sleep helper. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

interface DeviceCodeResponse {
  data: {
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    verificationUriComplete: string;
    expiresIn: number;
    interval: number;
  };
}

interface TokenResponse {
  data: {
    accessToken: string;
    refreshToken: string;
    tokenType: string;
    expiresIn: number;
  };
}

interface ErrorResponse {
  error?: string;
  message?: string;
}

// ---------------------------------------------------------------------------
// Device flow
// ---------------------------------------------------------------------------

/**
 * Execute the RFC 8628 Device Authorization flow.
 *
 * 1. Request a device code from the API.
 * 2. Display the user code and open the browser.
 * 3. Poll until the user authorises the device or the code expires.
 */
export async function loginWithDeviceFlow(): Promise<AuthTokens> {
  output.info('Requesting device authorization…');

  const codeResponse = await fetch(`${config.apiUrl}/auth/device/code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientInfo: {
        deviceName: 'Sink SMS CLI',
        userAgent: `smscli/${VERSION}`,
      },
    }),
  });

  if (!codeResponse.ok) {
    const err = (await codeResponse.json()) as ErrorResponse;
    throw new Error(err.message || 'Failed to request device code');
  }

  const { data: codeData } = (await codeResponse.json()) as DeviceCodeResponse;

  // Display user code and open browser
  output.blank();
  output.info(`Opening browser to: ${codeData.verificationUriComplete}`);
  output.blank();
  output.bold(`Your code: ${codeData.userCode}`);
  output.blank();
  output.dim('If the browser does not open, visit the URL above and enter the code.');
  output.blank();

  try {
    const openModule = await import('open');
    const openFn = openModule.default;
    await openFn(codeData.verificationUriComplete);
    output.dim('Browser opened.');
  } catch {
    output.warn('Could not open browser automatically.');
    output.info(`Please visit: ${codeData.verificationUriComplete}`);
  }

  // Poll for authorisation
  output.info('Waiting for authorization (this may take a few minutes)…');

  let pollInterval = (codeData.interval || 5) * 1000;
  const expiresIn = (codeData.expiresIn || 900) * 1000;
  const deadline = Date.now() + expiresIn;

  while (Date.now() < deadline) {
    await sleep(pollInterval);

    try {
      const tokenResponse = await fetch(`${config.apiUrl}/auth/device/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceCode: codeData.deviceCode }),
      });

      if (tokenResponse.ok) {
        const { data: tokenData } = (await tokenResponse.json()) as TokenResponse;
        const tokens: AuthTokens = {
          accessToken: tokenData.accessToken,
          refreshToken: tokenData.refreshToken,
          expiresAt: Date.now() + tokenData.expiresIn * 1000,
        };
        saveTokens(tokens);
        output.blank();
        return tokens;
      }

      let errorData: ErrorResponse;
      try {
        errorData = (await tokenResponse.json()) as ErrorResponse;
      } catch {
        process.stdout.write('.');
        continue;
      }

      const errorCode = errorData.error || '';

      switch (errorCode) {
        case 'authorization_pending':
          process.stdout.write('.');
          continue;
        case 'slow_down':
          pollInterval += 5000;
          process.stdout.write('s');
          continue;
        case 'expired_token':
          throw new Error('Authorization code expired. Please try again.');
        case 'access_denied':
          throw new Error('Authorization was denied.');
        default:
          process.stdout.write('?');
          continue;
      }
    } catch (err) {
      const e = err as Error;
      if (e.message.includes('expired') || e.message.includes('denied')) throw e;
      process.stdout.write('!');
      continue;
    }
  }

  output.blank();
  throw new Error('Authorization timed out. Please try again.');
}

/**
 * Refresh the access token using a stored refresh token.
 */
export async function refreshAccessToken(refreshToken: string): Promise<AuthTokens> {
  const response = await fetch(`${config.apiUrl}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });

  if (!response.ok) {
    throw new Error('Failed to refresh token. Please login again: smscli auth login');
  }

  const { data } = (await response.json()) as TokenResponse;
  const tokens: AuthTokens = {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    expiresAt: Date.now() + data.expiresIn * 1000,
  };
  saveTokens(tokens);
  return tokens;
}
