import { getAppUrl, getAppUrlSource } from '../utils/config.js';

export async function fetchWithDiagnostics(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    const cause = (err as { cause?: { code?: string; message?: string } }).cause;
    const reason = cause?.code || cause?.message || (err as Error).message || 'unknown';
    const method = (init?.method || 'GET').toUpperCase();
    const source = getAppUrlSource();

    const lines = [
      `Network request failed: ${method} ${url}`,
      `  Reason: ${reason}`,
      `  App URL: ${getAppUrl()} (source: ${source})`,
      '',
      'To point smscli at a different server, run:',
      '  smscli config set-url <https://your-server>',
      'Or set SMSCLI_APP_URL for a one-off override.',
    ];
    throw new Error(lines.join('\n'), { cause: err });
  }
}
