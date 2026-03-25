export interface Role {
  name: string;
}

export interface User {
  id: string;
  email: string;
  displayName: string | null;
  profileImageUrl: string | null;
  roles: Role[];
  permissions: string[];
  isActive: boolean;
  createdAt: string;
}

export interface UserSettings {
  theme: 'light' | 'dark' | 'system';
  profile: {
    displayName?: string;
    useProviderImage: boolean;
    customImageUrl?: string | null;
  };
  updatedAt: string;
  version: number;
}

export interface SystemSettings {
  ui: {
    allowUserThemeOverride: boolean;
  };
  features: Record<string, boolean>;
  updatedAt: string;
  updatedBy: { id: string; email: string } | null;
  version: number;
}

export interface AuthProvider {
  name: string;
  authUrl: string;
}

export interface AllowedEmailEntry {
  id: string;
  email: string;
  addedBy: { id: string; email: string } | null;
  addedAt: string;
  claimedBy: { id: string; email: string } | null;
  claimedAt: string | null;
  notes: string | null;
}

export interface AllowlistResponse {
  items: AllowedEmailEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface UserListItem {
  id: string;
  email: string;
  displayName: string | null;
  providerDisplayName: string | null;
  profileImageUrl: string | null;
  providerProfileImageUrl?: string | null;
  isActive: boolean;
  roles: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UsersResponse {
  items: UserListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface DeviceActivationInfo {
  userCode: string;
  clientInfo: {
    deviceName?: string;
    userAgent?: string;
    ipAddress?: string;
  };
  expiresAt: string;
}

export interface DeviceAuthorizationResponse {
  success: boolean;
  message: string;
}

export interface PersonalAccessToken {
  id: string;
  name: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  isActive: boolean;
}

export interface PersonalAccessTokensResponse {
  items: PersonalAccessToken[];
  meta: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

export interface CreateTokenResponse {
  id: string;
  name: string;
  token: string;
  expiresAt: string;
  createdAt: string;
}

// Calendar Sync
export interface CalendarSyncConfig {
  enabled: boolean;
  calendarId: string;
  syncFrequencyMinutes: number;
  googleEmail: string | null;
  isConnected: boolean;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
}

export interface CalendarSyncLog {
  id: string;
  startedAt: string;
  completedAt: string | null;
  status: string;
  entriesProcessed: number;
  entriesCreated: number;
  entriesUpdated: number;
  entriesDeleted: number;
  errorMessage: string | null;
  errorDetails: unknown | null;
}

export interface CalendarSyncLogsResponse {
  items: CalendarSyncLog[];
  meta: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

export interface GoogleCalendarListItem {
  id: string;
  summary: string;
  primary: boolean;
}

export interface CalendarUploadResponse {
  uploadId: string;
  entriesProcessed: number;
  entriesCreated: number;
  entriesUpdated: number;
  entriesDeleted: number;
}
