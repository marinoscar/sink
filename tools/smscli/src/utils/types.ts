/**
 * TypeScript interfaces for Sink SMS API responses.
 *
 * These types mirror the JSON shapes returned by the SMS relay API endpoints
 * documented in docs/SMS-RELAY-API.md.
 */

// ---------------------------------------------------------------------------
// Output mode
// ---------------------------------------------------------------------------

/** The three output modes supported by every command. */
export type OutputMode = 'human' | 'json' | 'quiet';

// ---------------------------------------------------------------------------
// JSON envelope
// ---------------------------------------------------------------------------

/** Successful JSON response wrapper. */
export interface CliSuccess<T> {
  success: true;
  data: T;
}

/** Failed JSON response wrapper. */
export interface CliError {
  success: false;
  error: string;
  code?: string;
}

/** Union type for all JSON output. */
export type CliResult<T> = CliSuccess<T> | CliError;

// ---------------------------------------------------------------------------
// Device & SIM
// ---------------------------------------------------------------------------

/** A SIM card slot on a registered device. */
export interface DeviceSim {
  id: string;
  deviceId: string;
  slotIndex: number;
  subscriptionId: number;
  carrierName: string | null;
  phoneNumber: string | null;
  iccId: string | null;
  displayName: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A registered Android device belonging to the authenticated user. */
export interface Device {
  id: string;
  userId: string;
  name: string;
  platform: string;
  manufacturer: string | null;
  model: string | null;
  osVersion: string | null;
  appVersion: string | null;
  deviceCodeId: string | null;
  isActive: boolean;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
  sims: DeviceSim[];
}

// ---------------------------------------------------------------------------
// SMS message
// ---------------------------------------------------------------------------

/** Inline device info included in each message response item. */
export interface MessageDevice {
  id: string;
  name: string;
  platform: string;
}

/** Inline SIM info included in each message response item. */
export interface MessageSim {
  id: string;
  displayName: string | null;
  carrierName: string | null;
  phoneNumber: string | null;
}

/** A single SMS message returned by the list endpoint. */
export interface SmsMessage {
  id: string;
  userId: string;
  deviceId: string;
  deviceSimId: string | null;
  sender: string;
  body: string;
  smsTimestamp: string;
  receivedAt: string;
  messageHash: string;
  simSlotIndex: number | null;
  createdAt: string;
  device: MessageDevice;
  sim: MessageSim | null;
}

/** Paginated response from GET /api/device-text-messages. */
export interface PaginatedMessages {
  items: SmsMessage[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ---------------------------------------------------------------------------
// Query parameters
// ---------------------------------------------------------------------------

/** Parameters for querying messages via the API. */
export interface MessageQueryParams {
  page?: number;
  pageSize?: number;
  dateFrom?: string;
  dateTo?: string;
  sender?: string;
  deviceId?: string;
  deviceSimId?: string;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/** Stored authentication tokens. */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp in milliseconds
}

/** User info extracted from the JWT or /auth/me endpoint. */
export interface UserInfo {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
}

// ---------------------------------------------------------------------------
// Global CLI options
// ---------------------------------------------------------------------------

/** Global options parsed from root Commander flags. */
export interface GlobalOptions {
  json?: boolean;
  quiet?: boolean;
  apiUrl?: string;
  color?: boolean; // --no-color sets this to false
  verbose?: boolean;
}
