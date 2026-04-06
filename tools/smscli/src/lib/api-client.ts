import { config } from '../utils/config.js';
import { loadTokens, isTokenExpired } from './auth-store.js';
import { refreshAccessToken } from './device-flow.js';
import type {
  AuthTokens,
  Device,
  MessageQueryParams,
  PaginatedMessages,
  UserInfo,
} from '../utils/types.js';

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------

async function ensureValidTokens(): Promise<AuthTokens> {
  const tokens = loadTokens();
  if (!tokens) {
    throw new Error('Not authenticated. Run: smscli auth login');
  }
  if (isTokenExpired(tokens)) {
    try {
      return await refreshAccessToken(tokens.refreshToken);
    } catch {
      throw new Error('Session expired. Please login again: smscli auth login');
    }
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Generic request helper
// ---------------------------------------------------------------------------

export interface ApiRequestOptions extends RequestInit {
  requireAuth?: boolean;
}

export async function apiRequest(
  path: string,
  options: ApiRequestOptions = {},
): Promise<Response> {
  const { requireAuth = true, ...fetchOptions } = options;
  const url = `${config.apiUrl}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(fetchOptions.headers as Record<string, string>),
  };

  if (requireAuth) {
    const tokens = await ensureValidTokens();
    headers['Authorization'] = `Bearer ${tokens.accessToken}`;
  }

  const response = await fetch(url, { ...fetchOptions, headers });

  if (response.status === 401 && requireAuth) {
    throw new Error('Session expired. Please login again: smscli auth login');
  }

  return response;
}

// ---------------------------------------------------------------------------
// Typed API methods
// ---------------------------------------------------------------------------

/**
 * GET /api/auth/me — current user info.
 */
export async function getCurrentUser(): Promise<UserInfo> {
  const res = await apiRequest('/auth/me');
  if (!res.ok) throw new Error('Failed to get user info');
  const json = (await res.json()) as { data: UserInfo };
  return json.data;
}

/**
 * GET /api/health/live + /api/health/ready — API health check.
 */
export async function checkHealth(): Promise<{ live: boolean; ready: boolean }> {
  try {
    const [liveRes, readyRes] = await Promise.all([
      fetch(`${config.apiUrl}/health/live`),
      fetch(`${config.apiUrl}/health/ready`),
    ]);
    return { live: liveRes.ok, ready: readyRes.ok };
  } catch {
    return { live: false, ready: false };
  }
}

/**
 * GET /api/device-text-messages — paginated, filterable message list.
 */
export async function getMessages(
  params: MessageQueryParams = {},
): Promise<PaginatedMessages> {
  const qs = new URLSearchParams();
  if (params.page !== undefined) qs.set('page', String(params.page));
  if (params.pageSize !== undefined) qs.set('pageSize', String(params.pageSize));
  if (params.dateFrom) qs.set('dateFrom', params.dateFrom);
  if (params.dateTo) qs.set('dateTo', params.dateTo);
  if (params.sender) qs.set('sender', params.sender);
  if (params.deviceId) qs.set('deviceId', params.deviceId);
  if (params.deviceSimId) qs.set('deviceSimId', params.deviceSimId);
  if (params.messageType) qs.set('messageType', params.messageType);
  if (params.isOtp !== undefined) qs.set('isOtp', String(params.isOtp));

  const path = `/device-text-messages${qs.toString() ? '?' + qs.toString() : ''}`;
  const res = await apiRequest(path);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message || `API error ${res.status}`);
  }
  const json = (await res.json()) as { data: PaginatedMessages };
  return json.data;
}

/**
 * GET /api/device-text-messages/senders — unique sender list.
 */
export async function getSenders(): Promise<string[]> {
  const res = await apiRequest('/device-text-messages/senders');
  if (!res.ok) throw new Error('Failed to get senders');
  const json = (await res.json()) as { data: string[] };
  return json.data;
}

/**
 * GET /api/device-text-messages/devices — registered devices with SIMs.
 */
export async function getDevices(): Promise<Device[]> {
  const res = await apiRequest('/device-text-messages/devices');
  if (!res.ok) throw new Error('Failed to get devices');
  const json = (await res.json()) as { data: Device[] };
  return json.data;
}

// ---------------------------------------------------------------------------
// OTP extraction (LLM-powered, server-side)
// ---------------------------------------------------------------------------

export interface OtpExtractionResult {
  code: string | null;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

/**
 * POST /api/device-text-messages/extract-otp — extract OTP using LLM.
 */
export async function extractOtpViaApi(messageBody: string): Promise<OtpExtractionResult> {
  const res = await apiRequest('/device-text-messages/extract-otp', {
    method: 'POST',
    body: JSON.stringify({ messageBody }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message || `API error ${res.status}`);
  }
  const json = (await res.json()) as { data: OtpExtractionResult };
  return json.data;
}

// ---------------------------------------------------------------------------
// Phone number → SIM ID resolution
// ---------------------------------------------------------------------------

/**
 * Normalise a phone number by stripping whitespace, dashes, and parentheses.
 */
function normalizePhone(n: string): string {
  return n.replace(/[\s\-()]/g, '');
}

/**
 * Check whether two phone numbers match.
 * Supports exact match and suffix match (e.g. "7580" matches "+12488057580").
 */
export function matchPhoneNumber(simNumber: string, query: string): boolean {
  const a = normalizePhone(simNumber);
  const b = normalizePhone(query);
  return a === b || a.endsWith(b) || b.endsWith(a);
}

/**
 * Resolve a phone number string to a `deviceSimId` by querying the user's
 * registered devices and finding the SIM whose phoneNumber matches.
 *
 * Throws if no matching SIM is found.
 */
export async function resolvePhoneNumber(number: string): Promise<string> {
  const devices = await getDevices();
  for (const device of devices) {
    for (const sim of device.sims) {
      if (sim.phoneNumber && matchPhoneNumber(sim.phoneNumber, number)) {
        return sim.id;
      }
    }
  }
  throw new Error(
    `No SIM found with phone number matching "${number}". ` +
    'Run "smscli devices list" to see registered devices and their SIM phone numbers.',
  );
}
