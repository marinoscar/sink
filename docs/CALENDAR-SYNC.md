# Calendar Sync API Guide

This guide explains how to authenticate with Sink and call the Calendar Sync API from scripts. It covers both authentication methods and provides ready-to-use PowerShell and shell script examples.

## Table of Contents

1. [Overview](#overview)
2. [Authentication - Getting a Token](#authentication---getting-a-token)
   - [Option A: Personal Access Token (recommended)](#option-a-personal-access-token-pat--recommended-for-scripts)
   - [Option B: Device Authorization Flow](#option-b-device-authorization-flow-rfc-8628)
3. [Calendar Sync API Endpoints](#calendar-sync-api-endpoints)
4. [PowerShell Script Example](#powershell-script-example-sync-calendarps1)
5. [Shell Script Example](#shell-script-example-sync-calendarsh)
6. [Obtaining a Token via Device Flow](#obtaining-a-token-via-device-flow-script-examples)

---

## Overview

The Calendar Sync API allows scripts and automation tools to upload Outlook calendar exports to Sink, which then syncs the entries to Google Calendar. The typical workflow is:

1. Export your Outlook calendar to JSON using a companion export script or tool.
2. Authenticate with Sink to obtain a token (once, then store it).
3. POST the JSON export to `/api/calendar/entries/upload` on a schedule (e.g., hourly via cron or Task Scheduler).
4. Sink upserts the entries and marks any entries missing from the export as deleted, keeping the Google Calendar in sync.

All Calendar Sync API endpoints require authentication. Choose one of the two methods below to obtain a token for use in your scripts.

---

## Authentication - Getting a Token

### Option A: Personal Access Token (PAT) — recommended for scripts

A PAT is a long-lived JWT that you create once and store securely. It is the simplest option for unattended scripts because it does not require browser interaction after initial setup.

#### Step 1: Obtain a short-lived session token from the browser

Log into the Sink web UI via Google OAuth at `https://your-sink-instance`. Once logged in, your browser holds a session. You need this session's access token to create a PAT via the API.

The easiest way to extract the access token is from your browser's developer tools:

1. Open DevTools (F12) and go to the **Application** tab (Chrome) or **Storage** tab (Firefox).
2. Look for the access token in cookies or local storage (the exact key depends on your Sink configuration).
3. Alternatively, open the **Network** tab and inspect any authenticated API request — the `Authorization: Bearer <token>` header contains the access token.

#### Step 2: Create a PAT

With your browser session token in hand, make the following request:

```http
POST https://your-sink-instance/api/tokens
Authorization: Bearer <your-session-token>
Content-Type: application/json

{
  "name": "calendar-sync",
  "expiresInHours": 8760
}
```

`expiresInHours` of `8760` is one year. The maximum allowed value is `876600` (approximately 100 years).

The response looks like:

```json
{
  "data": {
    "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "name": "calendar-sync",
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresAt": "2027-03-24T00:00:00.000Z",
    "createdAt": "2026-03-24T00:00:00.000Z"
  }
}
```

**The `data.token` value is returned only once.** Copy it immediately and store it in a secrets manager, an encrypted file, or an environment variable. It cannot be retrieved again.

#### Revoking a PAT

To revoke a PAT, send a DELETE request using the `id` from the create response:

```http
DELETE https://your-sink-instance/api/tokens/3fa85f64-5717-4562-b3fc-2c963f66afa6
Authorization: Bearer <any-valid-token>
```

A successful revoke returns HTTP 204 with no body.

---

### Option B: Device Authorization Flow (RFC 8628)

The device authorization flow is suited for headless environments or cases where you want the script to prompt the user to authorize in a browser without embedding long-lived credentials.

#### How it works

```
Script                          Sink API                     User's Browser
  |                                |                               |
  |-- POST /api/auth/device/code ->|                               |
  |<-- deviceCode, userCode, URL --|                               |
  |                                |                               |
  |-- display userCode + URL ----->|                               |
  |                                |<-- GET /device?code=XXXX-1234-|
  |                                |<-- POST /api/auth/device/auth-|
  |                                |                               |
  |-- POST /api/auth/device/token ->| (poll every `interval` secs) |
  |<-- authorization_pending ------|                               |
  |-- POST /api/auth/device/token ->|                              |
  |<-- { accessToken, ... } -------|                               |
```

#### Step 1: Request a device code

```http
POST https://your-sink-instance/api/auth/device/code
Content-Type: application/json

{
  "clientInfo": "my-sync-script/1.0"
}
```

The `clientInfo` field is optional but helps identify the device session in the Sink UI. The response:

```json
{
  "deviceCode": "a4f3b8c9d2e1f5a6b7c8d9e0f1a2b3c4",
  "userCode": "ABCD-1234",
  "verificationUri": "https://your-sink-instance/device",
  "verificationUriComplete": "https://your-sink-instance/device?code=ABCD-1234",
  "expiresIn": 900,
  "interval": 5
}
```

| Field | Description |
|---|---|
| `deviceCode` | Opaque code used by the script when polling. Do not display this. |
| `userCode` | Human-readable code that the user enters in the browser. |
| `verificationUri` | URL the user visits to authorize. |
| `verificationUriComplete` | Same URL with the code pre-filled. |
| `expiresIn` | Seconds until both codes expire (default: 900 = 15 minutes). |
| `interval` | Minimum seconds to wait between polling attempts. |

#### Step 2: Prompt the user

Display the `userCode` and `verificationUri` (or `verificationUriComplete`) to the user. Example output:

```
To authorize this script, visit:
  https://your-sink-instance/device

Enter code: ABCD-1234

Waiting for authorization...
```

The user logs in via Google OAuth in the browser and approves the device.

#### Step 3: Poll for the token

Every `interval` seconds, POST to the token endpoint:

```http
POST https://your-sink-instance/api/auth/device/token
Content-Type: application/json

{
  "deviceCode": "a4f3b8c9d2e1f5a6b7c8d9e0f1a2b3c4"
}
```

**Possible responses while waiting:**

| HTTP | `error` field | Meaning |
|---|---|---|
| 400 | `authorization_pending` | User has not approved yet. Keep polling. |
| 400 | `slow_down` | You are polling too fast. Increase the interval by 5 seconds. |
| 400 | `access_denied` | User denied the request. Stop polling. |
| 400 | `expired_token` | The device code expired. Start over from Step 1. |

**Success response (HTTP 200):**

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
  "tokenType": "Bearer",
  "expiresIn": 900
}
```

The `accessToken` is short-lived (default 15 minutes). Use the `refreshToken` to obtain a new access token via `POST /api/auth/refresh`, or re-run the device flow before the next scheduled sync.

For long-running automation, prefer creating a PAT using this access token (see Option A, Step 2) immediately after the device flow succeeds.

---

## Calendar Sync API Endpoints

All endpoints require `Authorization: Bearer <token>` and return JSON.

### POST /api/calendar/entries/upload

Uploads an Outlook calendar JSON export. Sink upserts all entries and soft-deletes any existing entries for the user that are absent from the upload.

**Request**

```http
POST https://your-sink-instance/api/calendar/entries/upload
Authorization: Bearer <token>
Content-Type: application/json
```

**Request body**

```json
{
  "exportDate": "2026-03-24T10:00:00",
  "rangeStart": "2026-01-01T00:00:00",
  "rangeEnd": "2026-12-31T23:59:59",
  "itemCount": 2,
  "entries": [
    {
      "entryId": "AAMkAGI2NGVH...",
      "lastModified": "2026-03-20T14:30:00",
      "subject": "Team Standup",
      "location": "Teams",
      "start": "2026-03-25T09:00:00",
      "startTimeZone": "America/New_York",
      "end": "2026-03-25T09:30:00",
      "endTimeZone": "America/New_York",
      "isAllDay": false,
      "isRecurring": true,
      "attendeeCount": 5,
      "attendeeDomains": ["example.com", "partner.com"],
      "organizerDomain": "example.com",
      "busyStatus": "Busy",
      "responseStatus": "Accepted",
      "recurrencePattern": {
        "type": "Weekly",
        "interval": 1,
        "daysOfWeek": ["Monday", "Wednesday", "Friday"],
        "dayOfMonth": 0,
        "monthOfYear": 0,
        "instance": 0,
        "patternStart": "2026-01-06",
        "patternEnd": null,
        "occurrences": 0
      }
    }
  ]
}
```

**Top-level fields**

| Field | Type | Required | Description |
|---|---|---|---|
| `exportDate` | string (ISO 8601) | Yes | Timestamp when the export was generated. |
| `rangeStart` | string (ISO 8601) | Yes | Start of the exported calendar range. |
| `rangeEnd` | string (ISO 8601) | Yes | End of the exported calendar range. |
| `itemCount` | integer | Yes | Number of items in the export (used for audit). |
| `entries` | array | Yes | Calendar entries. See below. |

**Entry fields**

| Field | Type | Required | Description |
|---|---|---|---|
| `entryId` | string | Yes | Stable identifier from Outlook (e.g., the PR_ENTRYID value). |
| `lastModified` | string (ISO 8601) | Yes | Last modification timestamp from Outlook. |
| `subject` | string | Yes | Event title. |
| `location` | string | No | Meeting location or Teams/Zoom link. |
| `start` | string (ISO 8601) | Yes | Event start time. |
| `startTimeZone` | string | Yes | IANA time zone name for the start time (e.g., `America/New_York`). |
| `end` | string (ISO 8601) | Yes | Event end time. |
| `endTimeZone` | string | Yes | IANA time zone name for the end time. |
| `isAllDay` | boolean | Yes | Whether the event is an all-day event. |
| `isRecurring` | boolean | Yes | Whether the event is part of a recurring series. |
| `attendeeCount` | integer | Yes | Number of attendees (excluding organizer). |
| `attendeeDomains` | string[] | Yes | Unique email domains of attendees. |
| `organizerDomain` | string | No | Email domain of the organizer. |
| `busyStatus` | enum | Yes | `Free`, `Tentative`, `Busy`, `OutOfOffice`, or `WorkingElsewhere`. |
| `responseStatus` | enum | Yes | `None`, `Organized`, `Tentative`, `Accepted`, `Declined`, or `NotResponded`. |
| `recurrencePattern` | object | No | Present only when `isRecurring` is true. See below. |

**Recurrence pattern fields**

| Field | Type | Description |
|---|---|---|
| `type` | enum | `Daily`, `Weekly`, `Monthly`, `MonthlyNth`, `Yearly`, or `YearlyNth`. |
| `interval` | integer | Recurrence interval (e.g., 2 = every 2 weeks). Minimum 1. |
| `daysOfWeek` | string[] | Days the event occurs on (e.g., `["Monday", "Wednesday"]`). |
| `dayOfMonth` | integer | Day of month for monthly recurrences (0 if not applicable). |
| `monthOfYear` | integer | Month for yearly recurrences (0 if not applicable). |
| `instance` | integer | Week instance for nth-day rules (e.g., 2 = second occurrence). |
| `patternStart` | string (date) | Date the recurrence pattern starts (YYYY-MM-DD). |
| `patternEnd` | string (date) or null | Date the pattern ends, or null for no end date. |
| `occurrences` | integer | Number of occurrences (0 means not used). |

**Response (HTTP 201)**

```json
{
  "data": {
    "uploadId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "entriesProcessed": 42,
    "entriesCreated": 5,
    "entriesUpdated": 3,
    "entriesDeleted": 1
  }
}
```

Entries not present in the upload but previously stored for the same user are soft-deleted and marked for sync so that Google Calendar removes them.

---

### GET /api/calendar/entries

Lists calendar entries for the authenticated user with pagination and optional filtering.

**Query parameters**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `page` | integer | 1 | Page number (1-based). |
| `pageSize` | integer | 20 | Items per page. Maximum 100. |
| `syncStatus` | string | (all) | Filter by sync status: `pending`, `synced`, or `deleted`. |
| `includeDeleted` | boolean | false | Whether to include soft-deleted entries. |

**Example**

```http
GET https://your-sink-instance/api/calendar/entries?page=1&pageSize=50&syncStatus=pending
Authorization: Bearer <token>
```

**Response (HTTP 200)**

```json
{
  "data": {
    "items": [
      {
        "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
        "entryId": "AAMkAGI2NGVH...",
        "data": { "subject": "Team Standup", "..." : "..." },
        "version": 3,
        "syncStatus": "pending",
        "googleEventId": null,
        "lastSyncedAt": null,
        "isDeleted": false,
        "createdAt": "2026-03-01T09:00:00.000Z",
        "updatedAt": "2026-03-24T10:00:00.000Z"
      }
    ],
    "meta": {
      "page": 1,
      "pageSize": 50,
      "totalItems": 1,
      "totalPages": 1
    }
  }
}
```

---

### GET /api/calendar/entries/pending-sync

Returns all entries currently awaiting sync to Google Calendar (i.e., `syncStatus = pending`), ordered oldest-first. Useful for a sync worker that processes entries in order.

```http
GET https://your-sink-instance/api/calendar/entries/pending-sync
Authorization: Bearer <token>
```

Response shape is the same as individual entry objects in the list endpoint, wrapped in `{ "data": [...] }`.

---

### GET /api/calendar/entries/:id

Returns a single calendar entry by its Sink UUID.

```http
GET https://your-sink-instance/api/calendar/entries/3fa85f64-5717-4562-b3fc-2c963f66afa6
Authorization: Bearer <token>
```

Returns `404` if the entry does not exist or belongs to a different user.

---

### GET /api/calendar/uploads

Returns the upload history for the authenticated user, newest first. Up to 50 records are returned.

```http
GET https://your-sink-instance/api/calendar/uploads
Authorization: Bearer <token>
```

**Response (HTTP 200)**

```json
{
  "data": [
    {
      "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      "exportDate": "2026-03-24T10:00:00",
      "rangeStart": "2026-01-01T00:00:00",
      "rangeEnd": "2026-12-31T23:59:59",
      "itemCount": 42,
      "entriesProcessed": 42,
      "entriesCreated": 5,
      "entriesUpdated": 3,
      "entriesDeleted": 1,
      "createdAt": "2026-03-24T10:05:00.000Z"
    }
  ]
}
```

---

## Google Calendar Token Lifecycle

This section explains how Sink manages Google OAuth tokens for Calendar Sync, what causes tokens to expire or become invalid, and how to recover when that happens.

### Access tokens

Google access tokens have a TTL of approximately 60 minutes. Sink uses the `googleapis` `OAuth2Client`, which **automatically exchanges the stored refresh token for a new access token** whenever the current one is expired or near expiry. No manual intervention is required; this happens transparently on every sync cycle.

### Refresh tokens

Refresh tokens are long-lived credentials issued once during the Google OAuth consent flow. Sink requests them with `access_type: offline` and `prompt: consent`, which forces Google to issue a fresh refresh token on each consent. The token is stored encrypted in the database using AES-256-GCM; it is never exposed in API responses or logs.

### When a refresh token expires or is revoked

Despite being long-lived, a refresh token can become invalid in several scenarios:

- **User revokes access** — the user removes Sink from their authorized apps at myaccount.google.com → Security → Third-party apps.
- **OAuth app is in "Testing" mode** — Google automatically expires all refresh tokens after 7 days for apps that have not completed the verification/publishing process.
- **Password or security event** — Google may invalidate tokens when the account password changes or suspicious activity is detected.
- **50-token limit per account** — Google allows at most 50 outstanding refresh tokens per app per Google account. Issuing a 51st invalidates the oldest one.

### Automatic recovery

When the sync engine calls a Google Calendar API and receives an `invalid_grant` (or similar auth error), it:

1. Marks the user's calendar sync as disabled.
2. Sets `lastSyncStatus` to `token_revoked`.
3. Stops retrying until the user reconnects.

The user will see a "Reconnect required" warning on the Calendar Sync page.

### Manual recovery

To restore sync after a token revocation:

1. Navigate to the **Calendar Sync** page in the Sink UI.
2. Click **Disconnect** to remove the stale credentials.
3. Click **Connect Google Calendar** and complete the consent flow.

Because the OAuth flow uses `prompt: consent`, Google will always issue a new refresh token regardless of whether it had one on file for Sink.

### Best practices

- **Publish your OAuth consent screen.** While in "Testing" mode, refresh tokens expire after 7 days. Complete the Google verification process or move to production status to get long-lived tokens.
- **Avoid creating excessive OAuth connections.** Each time a user reconnects, Sink issues a new refresh token. With many users, stale entries count toward the 50-token-per-account limit. Encourage users to disconnect cleanly rather than reconnecting repeatedly.
- **Monitor sync status in logs and observability.** Look for `auth_error` log entries or `lastSyncStatus: token_revoked` in the database to identify users who need to reconnect before they notice it themselves.

---

## PowerShell Script Example (sync-calendar.ps1)

The script below reads an Outlook calendar JSON export from disk and uploads it to Sink. It is designed for use in Task Scheduler or manual invocation.

```powershell
<#
.SYNOPSIS
    Uploads an Outlook calendar JSON export to the Sink Calendar Sync API.

.DESCRIPTION
    Reads a JSON file produced by your Outlook export tool and POSTs it to
    the Sink /api/calendar/entries/upload endpoint. Displays the upload
    result summary on completion.

.PARAMETER BaseUrl
    Base URL of the Sink instance. Do not include a trailing slash.
    Default: https://your-sink-instance

.PARAMETER Token
    Personal Access Token (PAT) or device-flow access token. Required.
    Store this in a secrets manager or read it from an encrypted file.

.PARAMETER CalendarJsonPath
    Path to the Outlook calendar JSON export file. Required.

.EXAMPLE
    # Using a PAT stored in an environment variable:
    .\sync-calendar.ps1 `
        -BaseUrl "https://your-sink-instance" `
        -Token $env:SINK_TOKEN `
        -CalendarJsonPath "C:\exports\outlook-calendar.json"

.EXAMPLE
    # Run from Task Scheduler with a secrets file:
    $token = Get-Content "C:\secrets\sink-token.txt" -Raw | ForEach-Object { $_.Trim() }
    .\sync-calendar.ps1 -Token $token -CalendarJsonPath "C:\exports\calendar.json"
#>

param(
    [string]$BaseUrl = "https://your-sink-instance",
    [Parameter(Mandatory = $true)][string]$Token,
    [Parameter(Mandatory = $true)][string]$CalendarJsonPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# --- Validate inputs ---

if (-not (Test-Path -Path $CalendarJsonPath -PathType Leaf)) {
    Write-Error "Calendar JSON file not found: $CalendarJsonPath"
    exit 1
}

if ([string]::IsNullOrWhiteSpace($Token)) {
    Write-Error "Token must not be empty. Set -Token or assign SINK_TOKEN."
    exit 1
}

# --- Read and validate the JSON file ---

Write-Host "Reading calendar export: $CalendarJsonPath"

try {
    $jsonContent = Get-Content -Path $CalendarJsonPath -Raw -Encoding UTF8
    $null = $jsonContent | ConvertFrom-Json  # Validate JSON structure
} catch {
    Write-Error "Failed to read or parse JSON file: $_"
    exit 1
}

# --- Upload to Sink ---

$uploadUrl = "$BaseUrl/api/calendar/entries/upload"
Write-Host "Uploading to: $uploadUrl"

$headers = @{
    "Authorization" = "Bearer $Token"
    "Content-Type"  = "application/json"
}

try {
    $response = Invoke-RestMethod `
        -Method Post `
        -Uri $uploadUrl `
        -Headers $headers `
        -Body $jsonContent `
        -ContentType "application/json"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    $errorBody  = $_.ErrorDetails.Message

    Write-Error "Upload failed (HTTP $statusCode): $errorBody"
    exit 1
}

# --- Display results ---

$result = $response.data
Write-Host ""
Write-Host "Upload complete"
Write-Host "  Upload ID        : $($result.uploadId)"
Write-Host "  Entries processed: $($result.entriesProcessed)"
Write-Host "  Entries created  : $($result.entriesCreated)"
Write-Host "  Entries updated  : $($result.entriesUpdated)"
Write-Host "  Entries deleted  : $($result.entriesDeleted)"
```

---

## Shell Script Example (sync-calendar.sh)

The script below is equivalent to the PowerShell version and is designed for cron or manual invocation on Linux/macOS.

```bash
#!/usr/bin/env bash
# sync-calendar.sh — Upload an Outlook calendar JSON export to Sink
#
# Usage:
#   SINK_TOKEN=<token> ./sync-calendar.sh /path/to/calendar.json
#
#   Or with all options via environment variables:
#   SINK_URL=https://your-sink-instance \
#   SINK_TOKEN=<token> \
#   ./sync-calendar.sh /path/to/calendar.json
#
# The script exits non-zero on any error (curl failure or HTTP error).

set -euo pipefail

# --- Configuration ---

SINK_URL="${SINK_URL:-https://your-sink-instance}"
SINK_TOKEN="${SINK_TOKEN:-}"
CALENDAR_JSON_PATH="${1:-}"

# --- Validate inputs ---

if [[ -z "$SINK_TOKEN" ]]; then
    echo "Error: SINK_TOKEN environment variable is required." >&2
    echo "       Export your Personal Access Token before running this script." >&2
    exit 1
fi

if [[ -z "$CALENDAR_JSON_PATH" ]]; then
    echo "Usage: $0 /path/to/calendar.json" >&2
    exit 1
fi

if [[ ! -f "$CALENDAR_JSON_PATH" ]]; then
    echo "Error: File not found: $CALENDAR_JSON_PATH" >&2
    exit 1
fi

# --- Upload ---

UPLOAD_URL="${SINK_URL}/api/calendar/entries/upload"
echo "Uploading $(basename "$CALENDAR_JSON_PATH") to $UPLOAD_URL"

# Write the HTTP response body and status code to separate variables.
HTTP_RESPONSE=$(mktemp)

HTTP_STATUS=$(curl \
    --silent \
    --show-error \
    --write-out "%{http_code}" \
    --output "$HTTP_RESPONSE" \
    --request POST "$UPLOAD_URL" \
    --header "Authorization: Bearer $SINK_TOKEN" \
    --header "Content-Type: application/json" \
    --data-binary "@$CALENDAR_JSON_PATH")

CURL_EXIT=$?

if [[ $CURL_EXIT -ne 0 ]]; then
    echo "Error: curl failed with exit code $CURL_EXIT." >&2
    rm -f "$HTTP_RESPONSE"
    exit 1
fi

RESPONSE_BODY=$(cat "$HTTP_RESPONSE")
rm -f "$HTTP_RESPONSE"

if [[ "$HTTP_STATUS" -lt 200 || "$HTTP_STATUS" -ge 300 ]]; then
    echo "Error: Upload failed with HTTP $HTTP_STATUS." >&2
    echo "Response: $RESPONSE_BODY" >&2
    exit 1
fi

# --- Display results ---

# Requires jq for JSON parsing. Falls back to raw output if jq is absent.
if command -v jq &>/dev/null; then
    echo ""
    echo "Upload complete"
    echo "  Upload ID        : $(echo "$RESPONSE_BODY" | jq -r '.data.uploadId')"
    echo "  Entries processed: $(echo "$RESPONSE_BODY" | jq -r '.data.entriesProcessed')"
    echo "  Entries created  : $(echo "$RESPONSE_BODY" | jq -r '.data.entriesCreated')"
    echo "  Entries updated  : $(echo "$RESPONSE_BODY" | jq -r '.data.entriesUpdated')"
    echo "  Entries deleted  : $(echo "$RESPONSE_BODY" | jq -r '.data.entriesDeleted')"
else
    echo "Upload complete (HTTP $HTTP_STATUS)"
    echo "$RESPONSE_BODY"
fi
```

Make the script executable before first use:

```bash
chmod +x sync-calendar.sh
```

---

## Obtaining a Token via Device Flow (Script Examples)

Use these snippets when you want the script to guide the user through browser-based authorization rather than requiring a pre-existing token.

### PowerShell

```powershell
# device-login.ps1
# Runs the RFC 8628 device authorization flow and prints the access token.
# Run this interactively once to obtain a token, then store it as a PAT.

param(
    [string]$BaseUrl = "https://your-sink-instance"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Step 1: Request a device code
$codeResponse = Invoke-RestMethod `
    -Method Post `
    -Uri "$BaseUrl/api/auth/device/code" `
    -ContentType "application/json" `
    -Body (@{ clientInfo = "calendar-sync-script/1.0" } | ConvertTo-Json)

$deviceCode = $codeResponse.deviceCode
$interval   = $codeResponse.interval
$expiresIn  = $codeResponse.expiresIn

# Step 2: Prompt the user
Write-Host ""
Write-Host "Open this URL in your browser to authorize:"
Write-Host "  $($codeResponse.verificationUriComplete)"
Write-Host ""
Write-Host "Or visit $($codeResponse.verificationUri) and enter code: $($codeResponse.userCode)"
Write-Host ""
Write-Host "Waiting for authorization (expires in $expiresIn seconds)..."

# Step 3: Poll for the token
$pollInterval = $interval  # seconds; may be increased on slow_down
$deadline     = (Get-Date).AddSeconds($expiresIn)

while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds $pollInterval

    try {
        $tokenResponse = Invoke-RestMethod `
            -Method Post `
            -Uri "$BaseUrl/api/auth/device/token" `
            -ContentType "application/json" `
            -Body (@{ deviceCode = $deviceCode } | ConvertTo-Json)

        # Success
        Write-Host "Authorization successful."
        Write-Host ""
        Write-Host "Access token (valid for $($tokenResponse.expiresIn)s):"
        Write-Host $tokenResponse.accessToken
        Write-Host ""
        Write-Host "To avoid repeating this flow, create a long-lived PAT using this token:"
        Write-Host "  Invoke-RestMethod -Method Post -Uri '$BaseUrl/api/tokens' \"
        Write-Host "    -Headers @{ Authorization = 'Bearer <access-token>' } \"
        Write-Host "    -Body (@{ name = 'calendar-sync'; expiresInHours = 8760 } | ConvertTo-Json)"
        exit 0

    } catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        $errorBody  = $_.ErrorDetails.Message | ConvertFrom-Json -ErrorAction SilentlyContinue

        switch ($errorBody.error) {
            "authorization_pending" {
                Write-Host "  Still waiting..." -NoNewline
                continue
            }
            "slow_down" {
                $pollInterval += 5
                Write-Host "  Slowing down, next poll in $pollInterval seconds..." -NoNewline
                continue
            }
            "access_denied" {
                Write-Error "Authorization denied by user."
                exit 1
            }
            "expired_token" {
                Write-Error "Device code expired. Run the script again."
                exit 1
            }
            default {
                Write-Error "Unexpected error (HTTP $statusCode): $errorBody"
                exit 1
            }
        }
    }
}

Write-Error "Timed out waiting for authorization."
exit 1
```

### Bash

```bash
#!/usr/bin/env bash
# device-login.sh
# Runs the RFC 8628 device authorization flow and prints the access token.
# Requires: curl, jq

set -euo pipefail

SINK_URL="${SINK_URL:-https://your-sink-instance}"

# Step 1: Request a device code
echo "Requesting device code..."

CODE_RESPONSE=$(curl --silent --fail --show-error \
    --request POST "${SINK_URL}/api/auth/device/code" \
    --header "Content-Type: application/json" \
    --data '{"clientInfo":"calendar-sync-script/1.0"}')

DEVICE_CODE=$(echo "$CODE_RESPONSE" | jq -r '.deviceCode')
USER_CODE=$(echo "$CODE_RESPONSE"   | jq -r '.userCode')
VERIFY_URL=$(echo "$CODE_RESPONSE"  | jq -r '.verificationUriComplete')
EXPIRES_IN=$(echo "$CODE_RESPONSE"  | jq -r '.expiresIn')
INTERVAL=$(echo "$CODE_RESPONSE"    | jq -r '.interval')

# Step 2: Prompt the user
echo ""
echo "Open this URL in your browser to authorize:"
echo "  $VERIFY_URL"
echo ""
echo "Waiting for authorization (expires in ${EXPIRES_IN}s)..."

# Step 3: Poll for the token
POLL_INTERVAL=$INTERVAL
DEADLINE=$(( $(date +%s) + EXPIRES_IN ))

while [[ $(date +%s) -lt $DEADLINE ]]; do
    sleep "$POLL_INTERVAL"

    HTTP_RESPONSE=$(mktemp)
    HTTP_STATUS=$(curl \
        --silent \
        --show-error \
        --write-out "%{http_code}" \
        --output "$HTTP_RESPONSE" \
        --request POST "${SINK_URL}/api/auth/device/token" \
        --header "Content-Type: application/json" \
        --data "{\"deviceCode\":\"$DEVICE_CODE\"}" || true)

    RESPONSE_BODY=$(cat "$HTTP_RESPONSE")
    rm -f "$HTTP_RESPONSE"

    if [[ "$HTTP_STATUS" == "200" ]]; then
        ACCESS_TOKEN=$(echo "$RESPONSE_BODY" | jq -r '.accessToken')
        EXPIRES=$(echo "$RESPONSE_BODY"      | jq -r '.expiresIn')
        echo ""
        echo "Authorization successful."
        echo ""
        echo "Access token (valid for ${EXPIRES}s):"
        echo "$ACCESS_TOKEN"
        echo ""
        echo "To avoid repeating this flow, create a long-lived PAT:"
        echo "  curl -s -X POST '${SINK_URL}/api/tokens' \\"
        echo "    -H 'Authorization: Bearer <access-token>' \\"
        echo "    -H 'Content-Type: application/json' \\"
        echo "    -d '{\"name\":\"calendar-sync\",\"expiresInHours\":8760}'"
        exit 0
    fi

    ERROR_CODE=$(echo "$RESPONSE_BODY" | jq -r '.error // "unknown"')

    case "$ERROR_CODE" in
        authorization_pending)
            printf "."
            ;;
        slow_down)
            POLL_INTERVAL=$(( POLL_INTERVAL + 5 ))
            echo "  Slowing down, next poll in ${POLL_INTERVAL}s..."
            ;;
        access_denied)
            echo "" >&2
            echo "Error: Authorization denied by user." >&2
            exit 1
            ;;
        expired_token)
            echo "" >&2
            echo "Error: Device code expired. Run the script again." >&2
            exit 1
            ;;
        *)
            echo "" >&2
            echo "Error: Unexpected response (HTTP $HTTP_STATUS): $RESPONSE_BODY" >&2
            exit 1
            ;;
    esac
done

echo "" >&2
echo "Error: Timed out waiting for authorization." >&2
exit 1
```

Make the script executable before first use:

```bash
chmod +x device-login.sh
```

#### Recommended workflow when using device flow for automation

1. Run `device-login.sh` (or `device-login.ps1`) interactively once.
2. Copy the printed access token.
3. Immediately use it to create a PAT via `POST /api/tokens` (the token in the create command output is returned only once — save it).
4. Store the PAT in a secrets manager or encrypted file.
5. Configure `sync-calendar.sh` / `sync-calendar.ps1` to use `SINK_TOKEN` / `-Token` from that stored PAT.
6. Schedule the sync script as a cron job or Windows Task Scheduler task.
