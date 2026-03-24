# Google Calendar Sync

This document covers everything needed to configure and operate the one-directional sync from the Sink database to Google Calendar. Outlook calendar entries are uploaded to Sink via JSON, then a background task pushes those entries to Google Calendar automatically.

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Google Cloud Setup](#google-cloud-setup)
4. [Environment Configuration](#environment-configuration)
5. [User Setup](#user-setup)
6. [How Sync Works](#how-sync-works)
7. [Sync Configuration Reference](#sync-configuration-reference)
8. [Event Field Mapping](#event-field-mapping)
9. [API Reference](#api-reference)
10. [Troubleshooting](#troubleshooting)
11. [Security Considerations](#security-considerations)

---

## Overview

The calendar sync pipeline moves Outlook calendar data into Google Calendar in three stages:

```
Outlook (PST/Exchange)
        |
        | Export to JSON
        v
POST /api/calendar/entries/upload
        |
        | Upsert into calendar_entries table
        | (syncStatus = pending)
        v
Background task (runs every minute)
        |
        | For each user with sync enabled and due
        v
Google Calendar API
        |
        | Create / Update / Delete events
        v
calendar_entries.syncStatus = synced
calendar_sync_logs record written
```

The sync is strictly one-directional: changes in Google Calendar are not reflected back into Sink. Only entries with `syncStatus: pending` are processed on each run, keeping API calls to Google to a minimum.

---

## Prerequisites

Before configuring calendar sync you need:

- A **Google Cloud project** with billing enabled (the Calendar API is free within quota, but billing must be enabled for the project).
- The **Google Calendar API** enabled in that project.
- An **OAuth 2.0 consent screen** configured with the `https://www.googleapis.com/auth/calendar` scope.
- The same **OAuth client credentials** (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`) already used for the main application login flow. No second client is required.
- The `CALENDAR_ENCRYPTION_KEY` environment variable set before starting the API (see [Environment Configuration](#environment-configuration)).

---

## Google Cloud Setup

### Step 1: Enable the Google Calendar API

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Select your project from the project picker at the top.
3. Go to **APIs & Services** > **Library**.
4. Search for **Google Calendar API**.
5. Click the result, then click **Enable**.

### Step 2: Add the calendar scope to your OAuth consent screen

1. In the same project, go to **APIs & Services** > **OAuth consent screen**.
2. Click **Edit App**.
3. Proceed to the **Scopes** step.
4. Click **Add or remove scopes**.
5. Search for `https://www.googleapis.com/auth/calendar` and check it.
6. Click **Update**, then save the consent screen.

If your app is in **Testing** mode, the Google Account that will connect calendar sync must be listed as a test user. Go to the **Test users** section of the consent screen and add the account.

### Step 3: Verify your OAuth redirect URI

The calendar sync OAuth callback uses a separate redirect URI from the main login flow. Add the following URI to your existing OAuth 2.0 Client ID:

1. Go to **APIs & Services** > **Credentials**.
2. Click on your existing OAuth 2.0 Client ID.
3. Under **Authorized redirect URIs**, click **Add URI**.
4. Enter: `{APP_URL}/api/calendar/sync/auth/google/callback`

   Replace `{APP_URL}` with your actual application base URL, for example:
   - Development: `http://localhost:3535/api/calendar/sync/auth/google/callback`
   - Production: `https://your-domain.com/api/calendar/sync/auth/google/callback`

5. Click **Save**.

---

## Environment Configuration

### Generate the encryption key

The API encrypts each user's Google Calendar refresh token before storing it in the database. The encryption key must be a 32-byte value expressed as a 64-character hex string.

Generate one with OpenSSL:

```bash
openssl rand -hex 32
```

Example output (do not use this value):

```
a3f1c29d8e4b7605f2d9a1c3e8b4f071d6a9c2e5b8f3a06d4c1e9b2f7a4d8c5
```

### Add to your environment file

Open `infra/compose/.env` and add:

```bash
# Google Calendar Sync
CALENDAR_ENCRYPTION_KEY=<your-64-char-hex-key>
```

The variable must be set before the API container starts. If you add it to a running deployment, restart the API service:

```bash
cd infra/compose && docker compose -f base.compose.yml -f dev.compose.yml restart api
```

If `CALENDAR_ENCRYPTION_KEY` is absent or empty, any attempt to connect a Google Calendar will return an error.

---

## User Setup

All calendar sync configuration is admin-only. Complete these steps in the Sink web UI.

### Step 1: Navigate to Calendar Sync

Go to the admin area and open the **Calendar Sync** page. The exact navigation path depends on your UI layout (for example, a sidebar link labeled "Calendar Sync").

### Step 2: Connect Google Calendar

1. Click **Connect Google Calendar**.
2. You are redirected to Google's OAuth consent screen.
3. Select the Google Account whose calendar will receive the synced events.
4. Grant the requested calendar permission.
5. Google redirects back to Sink. The page now shows the connected account and a list of available calendars.

### Step 3: Select the target calendar

By default, events are created in the user's **primary** calendar. To use a different calendar:

1. In the **Calendar** dropdown, select the desired calendar from the list returned by `GET /api/calendar/sync/calendars`.
2. Save the selection.

### Step 4: Set the sync frequency

Choose how often the background task should process this user's pending entries:

| Option | Value |
|---|---|
| Every 5 minutes | 5 |
| Every 15 minutes | 15 |
| Every hour | 60 |
| Every 6 hours | 360 |
| Once a day | 1440 |

### Step 5: Enable sync

Toggle **Sync enabled** to on and save. The background task will pick up pending entries on its next run.

### Disconnecting

To remove the stored Google credentials:

1. Open the Calendar Sync page.
2. Click **Disconnect**.
3. This calls `POST /api/calendar/sync/auth/disconnect`, which clears the stored refresh token and disables sync.

---

## How Sync Works

### Background task cadence

A scheduler runs every minute and checks all users who have:

- `enabled: true` in their `calendar_sync_configs` record
- A stored (encrypted) refresh token
- A `nextSyncAt` timestamp that is in the past (or null)

For each qualifying user the task runs an incremental sync, then updates `nextSyncAt` to `now + syncFrequencyMinutes`.

### Incremental processing

Only entries with `syncStatus: pending` are read. The three operations are:

| Condition | Action |
|---|---|
| `syncStatus = pending`, no `googleEventId` | Create a new event in Google Calendar |
| `syncStatus = pending`, has `googleEventId` | Update the existing Google event |
| `syncStatus = pending`, `isDeleted = true`, has `googleEventId` | Delete the Google event |

After each successful operation the entry's `syncStatus` is set to `synced` and `googleEventId` is stored (for creates). If the entry has no `googleEventId` and `isDeleted = true`, it is marked `synced` without calling Google (nothing to delete).

### No-changes path

If there are no pending entries for a user, the sync run is logged with result `no_changes` and returns immediately.

### Per-entry error isolation

A failure on one entry does not abort the remaining entries. The failed entry retains `syncStatus: pending` so it will be retried on the next sync run. The sync log records the number of successes and failures.

### Sync log

Every sync run (including no-changes runs) writes a record to `calendar_sync_logs`. Retrieve logs via `GET /api/calendar/sync/logs`.

---

## Sync Configuration Reference

Managed via `GET /api/calendar/sync/config` and `PATCH /api/calendar/sync/config`.

| Field | Type | Default | Description |
|---|---|---|---|
| `calendarId` | string | `"primary"` | Target Google Calendar ID. Use `"primary"` for the default calendar or a full calendar ID (e.g., `abc123@group.calendar.google.com`). |
| `syncFrequencyMinutes` | integer | `60` | Minutes between scheduled sync runs. Allowed values: 5, 15, 60, 360, 1440. |
| `enabled` | boolean | `false` | Whether the background task should process this user's entries. |

---

## Event Field Mapping

When creating or updating a Google Calendar event, Sink maps Outlook fields as follows:

| Outlook Field | Google Calendar Field | Notes |
|---|---|---|
| `subject` | `summary` | |
| `location` | `location` | |
| `start` + `startTimeZone` | `start.dateTime` + `timeZone` | When `isAllDay = false` |
| `start` (date only) | `start.date` | When `isAllDay = true` |
| `end` + `endTimeZone` | `end.dateTime` + `timeZone` | When `isAllDay = false` |
| `end` (date only) | `end.date` | When `isAllDay = true` |
| `busyStatus: Free` | `transparency: transparent` | |
| All other `busyStatus` values | `transparency: opaque` | |
| `recurrencePattern` | `recurrence` (RRULE) | Converted to RFC 5545 RRULE format |

The event `description` field is populated with metadata that does not have a direct Google Calendar equivalent:

- Database entry ID
- Outlook source entry ID
- Organizer domain
- Attendee count
- Attendee domains
- Response status
- Busy status

---

## API Reference

All sync endpoints require a valid JWT Bearer token and the **Admin** role.

### Authentication

#### GET /api/calendar/sync/auth/google

Initiates the Google OAuth consent flow. Redirects the browser to Google. No request body required.

#### GET /api/calendar/sync/auth/google/callback

OAuth callback handled by the API. On success, stores the encrypted refresh token and redirects the browser to the Calendar Sync UI page. Not called directly by clients.

#### POST /api/calendar/sync/auth/disconnect

Clears the stored Google credentials for the authenticated user and sets `enabled: false`.

**Response (HTTP 200)**

```json
{ "data": { "disconnected": true } }
```

---

### Configuration

#### GET /api/calendar/sync/config

Returns the current sync configuration for the authenticated user.

**Response (HTTP 200)**

```json
{
  "data": {
    "calendarId": "primary",
    "syncFrequencyMinutes": 60,
    "enabled": true,
    "connected": true,
    "nextSyncAt": "2026-03-24T11:00:00.000Z"
  }
}
```

The `connected` field is `true` when a refresh token is stored. `nextSyncAt` is `null` if sync has never run.

#### PATCH /api/calendar/sync/config

Updates one or more configuration fields.

**Request body** (all fields optional)

```json
{
  "calendarId": "abc123@group.calendar.google.com",
  "syncFrequencyMinutes": 15,
  "enabled": true
}
```

**Response (HTTP 200)** — returns the full updated configuration (same shape as GET).

---

### Manual Trigger

#### POST /api/calendar/sync/trigger

Runs a sync immediately for the authenticated user, regardless of `nextSyncAt`. Useful for testing or after uploading a large batch of entries.

**Response (HTTP 200)**

```json
{
  "data": {
    "logId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "result": "success",
    "entriesCreated": 3,
    "entriesUpdated": 1,
    "entriesDeleted": 0,
    "entriesFailed": 0,
    "durationMs": 842
  }
}
```

Possible `result` values: `success`, `no_changes`, `partial_failure`, `failure`.

---

### Sync Logs

#### GET /api/calendar/sync/logs

Returns paginated sync history for the authenticated user, newest first.

**Query parameters**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `page` | integer | 1 | Page number (1-based). |
| `pageSize` | integer | 20 | Items per page. Maximum 100. |

**Response (HTTP 200)**

```json
{
  "data": {
    "items": [
      {
        "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
        "result": "success",
        "entriesCreated": 3,
        "entriesUpdated": 1,
        "entriesDeleted": 0,
        "entriesFailed": 0,
        "durationMs": 842,
        "errorMessage": null,
        "createdAt": "2026-03-24T10:05:00.000Z"
      }
    ],
    "meta": {
      "page": 1,
      "pageSize": 20,
      "totalItems": 47,
      "totalPages": 3
    }
  }
}
```

#### GET /api/calendar/sync/logs/:id

Returns the full detail for a single sync log entry, including per-entry error details when available.

---

### Calendars

#### GET /api/calendar/sync/calendars

Returns the list of Google Calendars available to the connected account. Requires the user to be connected (i.e., have a stored refresh token).

**Response (HTTP 200)**

```json
{
  "data": [
    {
      "id": "primary",
      "summary": "John Smith",
      "primary": true
    },
    {
      "id": "abc123@group.calendar.google.com",
      "summary": "Team Shared Calendar",
      "primary": false
    }
  ]
}
```

---

## Troubleshooting

### `invalid_grant` error in sync logs

**Cause**: The stored refresh token has been revoked or expired. This happens when the user revokes access in their Google Account security settings, or when a new OAuth consent overwrites the previous token.

**Fix**: Disconnect and reconnect the Google Calendar account from the Calendar Sync page.

---

### `Insufficient Permission` or `insufficientPermissions` error

**Cause**: The OAuth token was issued without the `https://www.googleapis.com/auth/calendar` scope. This can happen if the scope was added to the consent screen after the user already connected, or if the user did not grant the calendar permission during the consent flow.

**Fix**:
1. Verify the scope is listed on the OAuth consent screen (see [Step 2](#step-2-add-the-calendar-scope-to-your-oauth-consent-screen)).
2. Disconnect and reconnect the account. The new consent flow will request the full scope.

---

### `Calendar not found` or `notFound` error

**Cause**: The configured `calendarId` does not exist or is not accessible to the connected account.

**Fix**:
1. Call `GET /api/calendar/sync/calendars` to list valid calendar IDs.
2. Update the config with a valid ID via `PATCH /api/calendar/sync/config`.

---

### `Encryption key not configured` error

**Cause**: `CALENDAR_ENCRYPTION_KEY` is not set in the environment, or the API was started before the variable was added.

**Fix**:
1. Generate a key: `openssl rand -hex 32`
2. Add `CALENDAR_ENCRYPTION_KEY=<key>` to `infra/compose/.env`.
3. Restart the API service.

---

### No events appearing in Google Calendar

Work through the following checks in order:

1. **Is sync enabled?** Call `GET /api/calendar/sync/config` and confirm `enabled: true` and `connected: true`.
2. **Are there pending entries?** Call `GET /api/calendar/entries?syncStatus=pending`. If the list is empty there is nothing to sync.
3. **Has a sync run recently?** Check `GET /api/calendar/sync/logs`. If no logs exist, the background task may not have run yet (it runs every minute) or the user was not yet due based on `nextSyncAt`.
4. **Did the last sync fail?** Check the `result` and `errorMessage` fields in the most recent log entry.
5. **Is the correct calendar selected?** Confirm `calendarId` in the config points to the calendar you are checking in Google Calendar.

---

### Rate limiting from the Google Calendar API

Google Calendar API allows up to **1,000,000 queries per day** per project (at the time of writing). For deployments with many users or very high upload frequency this limit could be reached.

**Mitigations**:
- Increase `syncFrequencyMinutes` to reduce how often the background task fires per user.
- Monitor the Google Cloud Console quota dashboard under **APIs & Services** > **Google Calendar API** > **Quotas**.
- If needed, request a quota increase in the Cloud Console.

---

### OAuth consent screen is in Testing mode

If the app has not been published through Google's verification process, the consent screen remains in **Testing** mode. Only accounts listed as test users can complete the OAuth flow.

**Fix**: Add the Google Account that will be connecting calendar sync to the **Test users** list on the OAuth consent screen, or publish the app if it has passed Google verification.

---

## Security Considerations

### Refresh token encryption

Each user's Google Calendar refresh token is encrypted with **AES-256-GCM** before being written to the `calendar_sync_configs` table. The encryption key (`CALENDAR_ENCRYPTION_KEY`) is never stored in the database. Losing the key renders all stored tokens unreadable; users would need to reconnect their accounts.

Keep the encryption key:
- Out of source control
- In a secrets manager (e.g., AWS Secrets Manager, HashiCorp Vault) for production deployments
- Backed up securely — if the key is lost and tokens become unreadable, all users must reconnect

### Scope minimization

The OAuth consent requests only the `https://www.googleapis.com/auth/calendar` scope, which allows reading and writing calendar events. It does not request access to email, contacts, or other Google services.

Note that `calendar` (not `calendar.readonly`) is required because the sync writes, updates, and deletes events. There is no narrower scope that supports all three operations.

### Admin-only access

All sync configuration and log endpoints enforce the **Admin** role via RBAC. Regular users cannot view or modify sync settings, nor can they read sync logs for other users.

### No inbound data from Google

The sync is strictly outbound (DB to Google). The API does not subscribe to Google Calendar push notifications and does not process any inbound webhooks from Google. This eliminates a class of webhook-based attack vectors.

### OAuth callback security

The callback URI (`/api/calendar/sync/auth/google/callback`) is handled server-side and immediately exchanges the authorization code for tokens. The refresh token is encrypted before being written to the database and is never returned to the client.
