# SMS Relay API

This document covers the server-side SMS relay feature: database schema, API endpoints, permissions, and deduplication strategy.

## Table of Contents

- [Overview](#overview)
- [Database Schema](#database-schema)
- [API Endpoints](#api-endpoints)
- [Permissions](#permissions)
- [Deduplication](#deduplication)
- [Future: Media Attachments](#future-media-attachments)

---

## Overview

The SMS relay feature allows an Android companion app to forward incoming SMS messages to the Sink API. Messages are stored in PostgreSQL and exposed through a query API for use in the web UI.

**Architecture:**

```
Android device
    |  POST /api/device-text-messages/relay
    v
NestJS API (RelayService)
    |  createMany({ skipDuplicates: true })
    v
PostgreSQL (sms_messages table)
    |
    v
Web UI  <-- GET /api/device-text-messages (paginated, filterable)
```

**Key design decisions:**

- Each Android device is represented by a `Device` record linked to a user.
- SIM cards are tracked as `DeviceSim` records linked to a device.
- SMS messages are linked to both a device and optionally a SIM.
- A `messageHash` unique constraint provides idempotent relay — the Android app can safely retry without creating duplicates.
- The module is split into two controllers: `RelayController` handles device/SIM management and message ingestion; `DeviceTextMessagesController` handles message querying.

---

## Database Schema

### devices

Represents a registered Android device belonging to a user.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | Auto-generated |
| `user_id` | UUID FK → users | Cascade delete |
| `device_code_id` | UUID FK → device_codes (unique, nullable) | Links to the device auth session used to register |
| `name` | varchar | Human-readable name, e.g. "Google Pixel 8" |
| `platform` | varchar | Always `"android"` for current app |
| `manufacturer` | varchar (nullable) | e.g. "Google" |
| `model` | varchar (nullable) | e.g. "Pixel 8" |
| `os_version` | varchar (nullable) | e.g. "Android 15" |
| `app_version` | varchar (nullable) | e.g. "1.0.0" |
| `push_token` | varchar (nullable) | Reserved for future push notifications |
| `last_seen_at` | timestamptz (nullable) | Updated on each device registration call |
| `is_active` | boolean | Default `true` |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | Auto-updated |

Unique constraint: `(user_id, name)` — upsert key for device registration.
Index: `user_id`.

### device_sims

Represents a SIM card slot active on a registered device.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | Auto-generated |
| `device_id` | UUID FK → devices | Cascade delete |
| `slot_index` | integer | Physical SIM slot (0-based) |
| `subscription_id` | integer | Android SubscriptionManager ID |
| `carrier_name` | varchar (nullable) | e.g. "T-Mobile" |
| `phone_number` | varchar (nullable) | May be empty on some carriers |
| `icc_id` | varchar (nullable) | SIM card serial number |
| `display_name` | varchar (nullable) | User-assigned name |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | Auto-updated |

Unique constraint: `(device_id, subscription_id)` — upsert key for SIM sync.
Index: `device_id`.

SIM records are managed by the SIM sync endpoint: records present in the request are upserted, records absent from the request (no longer in the device's active SIM list) are deleted. This keeps the server's SIM list in sync with the device.

### sms_messages

Stores relayed SMS messages.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | Auto-generated |
| `user_id` | UUID FK → users | Cascade delete |
| `device_id` | UUID FK → devices | Cascade delete |
| `device_sim_id` | UUID FK → device_sims (nullable) | Set null on SIM delete |
| `sender` | varchar | Originating address (phone number or short code) |
| `body` | text | Full message body (concatenated for multi-part SMS) |
| `sms_timestamp` | timestamptz | When the SMS was sent (from the device's clock) |
| `received_at` | timestamptz | When the API received the relay request |
| `message_hash` | varchar UNIQUE | SHA-256 hash for deduplication |
| `sim_slot_index` | integer (nullable) | SIM slot index at time of receipt |
| `carrier_name` | varchar (nullable) | Reserved for future use |
| `metadata` | jsonb (nullable) | Reserved for future extensible fields |
| `created_at` | timestamptz | |

Unique constraint: `message_hash` — enforces exactly-once storage.
Indexes: `(user_id, sms_timestamp)`, `(user_id, sender)`, `device_id`, `received_at`.

### sms_attachments

Tracks MMS media attachments linked to SMS messages. No relay endpoints exist yet — see [Future: Media Attachments](#future-media-attachments).

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | Auto-generated |
| `message_id` | UUID FK → sms_messages | Cascade delete |
| `storage_object_id` | UUID FK → storage_objects (nullable) | Set null on storage object delete |
| `mime_type` | varchar | e.g. "image/jpeg" |
| `file_name` | varchar (nullable) | Original filename |
| `size` | bigint | File size in bytes |
| `created_at` | timestamptz | |

Index: `message_id`.

---

## API Endpoints

All endpoints are under `/api/device-text-messages`. All require a valid JWT Bearer token unless noted.

Standard response envelope:

```json
{ "data": <response body> }
```

Standard error shape:

```json
{
  "code": "ERROR_CODE",
  "message": "Human readable description"
}
```

---

### POST /api/device-text-messages/devices/register

Registers a new device or updates an existing one. The upsert key is `(userId, name)` — calling this endpoint again with the same device name updates metadata and refreshes `last_seen_at`.

**Authentication:** JWT Bearer token required.

**Request body:**

```json
{
  "name": "Google Pixel 8",
  "platform": "android",
  "manufacturer": "Google",
  "model": "Pixel 8",
  "osVersion": "Android 15",
  "appVersion": "1.0.0",
  "deviceCodeId": "550e8400-e29b-41d4-a716-446655440000"
}
```

| Field | Type | Required | Constraints |
|-------|------|----------|------------|
| `name` | string | Yes | 1–100 chars |
| `platform` | string | No | 1–20 chars; default `"android"` |
| `manufacturer` | string | No | max 100 chars |
| `model` | string | No | max 100 chars |
| `osVersion` | string | No | max 50 chars |
| `appVersion` | string | No | max 50 chars |
| `deviceCodeId` | UUID string | No | Links device to the auth session |

**Response `201`:**

```json
{
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440001",
    "userId": "550e8400-e29b-41d4-a716-446655440002",
    "name": "Google Pixel 8",
    "platform": "android",
    "manufacturer": "Google",
    "model": "Pixel 8",
    "osVersion": "Android 15",
    "appVersion": "1.0.0",
    "isActive": true,
    "lastSeenAt": "2026-03-29T14:00:00.000Z",
    "createdAt": "2026-03-29T14:00:00.000Z",
    "updatedAt": "2026-03-29T14:00:00.000Z",
    "sims": []
  }
}
```

**Error responses:**

| Status | Condition |
|--------|-----------|
| `401` | Missing or invalid token |
| `422` | Validation error (e.g. name too long) |

---

### POST /api/device-text-messages/devices/:deviceId/sims

Syncs the SIM card list for a registered device. This is a full replacement: SIMs in the request are upserted, and any SIMs previously recorded for the device but absent from the request are deleted.

**Authentication:** JWT Bearer token required. The device must belong to the authenticated user.

**Path parameters:**

| Parameter | Type | Notes |
|-----------|------|-------|
| `deviceId` | UUID | Must be a device owned by the current user |

**Request body:**

```json
{
  "sims": [
    {
      "slotIndex": 0,
      "subscriptionId": 1,
      "carrierName": "T-Mobile",
      "phoneNumber": "+15551234567",
      "iccId": "89012601234567890123",
      "displayName": "Personal"
    },
    {
      "slotIndex": 1,
      "subscriptionId": 2,
      "carrierName": "AT&T",
      "phoneNumber": "+15557654321",
      "iccId": "89014103211118510720",
      "displayName": "Work"
    }
  ]
}
```

| Field | Type | Required | Constraints |
|-------|------|----------|------------|
| `sims` | array | Yes | 1–10 items |
| `sims[].slotIndex` | integer | Yes | >= 0 |
| `sims[].subscriptionId` | integer | Yes | Android subscription ID |
| `sims[].carrierName` | string | No | max 100 chars |
| `sims[].phoneNumber` | string | No | max 30 chars |
| `sims[].iccId` | string | No | max 30 chars |
| `sims[].displayName` | string | No | max 100 chars |

**Response `201`:** Array of all `DeviceSim` objects currently stored for the device, ordered by `slotIndex`.

```json
{
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440010",
      "deviceId": "550e8400-e29b-41d4-a716-446655440001",
      "slotIndex": 0,
      "subscriptionId": 1,
      "carrierName": "T-Mobile",
      "phoneNumber": "+15551234567",
      "iccId": "89012601234567890123",
      "displayName": "Personal",
      "createdAt": "2026-03-29T14:00:00.000Z",
      "updatedAt": "2026-03-29T14:00:00.000Z"
    }
  ]
}
```

**Error responses:**

| Status | Condition |
|--------|-----------|
| `401` | Missing or invalid token |
| `403` | Device exists but belongs to a different user |
| `404` | Device ID not found |
| `422` | Validation error |

---

### POST /api/device-text-messages/relay

Relays a batch of SMS messages from a registered device to the API. Duplicate messages (matched by `messageHash`) are silently skipped.

**Authentication:** JWT Bearer token required. Requires `device_text_messages:write` permission. The device must belong to the authenticated user.

**Request body:**

```json
{
  "deviceId": "550e8400-e29b-41d4-a716-446655440001",
  "messages": [
    {
      "sender": "+15559876543",
      "body": "Your verification code is 123456",
      "smsTimestamp": "2026-03-29T14:00:00.000Z",
      "simSubscriptionId": 1,
      "simSlotIndex": 0
    },
    {
      "sender": "ACME-BANK",
      "body": "Transaction alert: $50.00 charged",
      "smsTimestamp": "2026-03-29T14:01:30.000Z"
    }
  ]
}
```

| Field | Type | Required | Constraints |
|-------|------|----------|------------|
| `deviceId` | UUID string | Yes | Must belong to the authenticated user |
| `messages` | array | Yes | 1–100 items per request |
| `messages[].sender` | string | Yes | 1–50 chars (phone number or short code) |
| `messages[].body` | string | Yes | max 10,000 chars |
| `messages[].smsTimestamp` | ISO 8601 string | Yes | UTC datetime |
| `messages[].simSubscriptionId` | integer | No | Android subscription ID; used to link message to a `DeviceSim` record |
| `messages[].simSlotIndex` | integer | No | Physical SIM slot index |

**Response `201`:**

```json
{
  "data": {
    "stored": 2,
    "duplicates": 0
  }
}
```

- `stored`: number of new messages written to the database
- `duplicates`: number of messages skipped due to hash collision

**Error responses:**

| Status | Condition |
|--------|-----------|
| `401` | Missing or invalid token |
| `403` | Device does not belong to the authenticated user, or missing `device_text_messages:write` permission |
| `404` | Device ID not found |
| `422` | Validation error (e.g. messages array empty, timestamp not ISO 8601) |

---

### GET /api/device-text-messages/devices

Lists all devices registered by the authenticated user, ordered by `lastSeenAt` descending. Each device includes its SIM cards.

**Authentication:** JWT Bearer token required.

**Response `200`:**

```json
{
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440001",
      "name": "Google Pixel 8",
      "platform": "android",
      "manufacturer": "Google",
      "model": "Pixel 8",
      "isActive": true,
      "lastSeenAt": "2026-03-29T14:00:00.000Z",
      "sims": [
        {
          "id": "550e8400-e29b-41d4-a716-446655440010",
          "slotIndex": 0,
          "subscriptionId": 1,
          "carrierName": "T-Mobile",
          "displayName": "Personal"
        }
      ]
    }
  ]
}
```

---

### GET /api/device-text-messages

Lists SMS messages for the authenticated user with pagination and optional filtering. Results are ordered by `smsTimestamp` descending.

**Authentication:** JWT Bearer token required. Requires `device_text_messages:read` permission.

**Query parameters:**

| Parameter | Type | Default | Notes |
|-----------|------|---------|-------|
| `page` | integer | `1` | Page number (1-based) |
| `pageSize` | integer | `20` | Items per page; max 100 |
| `dateFrom` | ISO 8601 string | — | Filter: `smsTimestamp >= dateFrom` |
| `dateTo` | ISO 8601 string | — | Filter: `smsTimestamp <= dateTo` |
| `sender` | string | — | Case-insensitive partial match on sender |
| `deviceId` | UUID string | — | Filter by specific device |

**Example request:**

```
GET /api/device-text-messages?page=1&pageSize=20&sender=%2B1555&dateFrom=2026-03-01T00:00:00.000Z
```

**Response `200`:**

```json
{
  "data": {
    "items": [
      {
        "id": "550e8400-e29b-41d4-a716-446655440020",
        "userId": "550e8400-e29b-41d4-a716-446655440002",
        "deviceId": "550e8400-e29b-41d4-a716-446655440001",
        "deviceSimId": "550e8400-e29b-41d4-a716-446655440010",
        "sender": "+15559876543",
        "body": "Your verification code is 123456",
        "smsTimestamp": "2026-03-29T14:00:00.000Z",
        "receivedAt": "2026-03-29T14:00:05.000Z",
        "simSlotIndex": 0,
        "device": {
          "id": "550e8400-e29b-41d4-a716-446655440001",
          "name": "Google Pixel 8",
          "platform": "android"
        },
        "sim": {
          "id": "550e8400-e29b-41d4-a716-446655440010",
          "displayName": "Personal",
          "carrierName": "T-Mobile",
          "phoneNumber": "+15551234567"
        }
      }
    ],
    "total": 142,
    "page": 1,
    "pageSize": 20,
    "totalPages": 8
  }
}
```

**Error responses:**

| Status | Condition |
|--------|-----------|
| `401` | Missing or invalid token |
| `403` | Missing `device_text_messages:read` permission |
| `422` | Invalid query parameter (e.g. non-ISO datetime) |

---

### GET /api/device-text-messages/senders

Returns a deduplicated, alphabetically sorted list of all sender values for the authenticated user. Useful for populating filter dropdowns in the web UI.

**Authentication:** JWT Bearer token required. Requires `device_text_messages:read` permission.

**Response `200`:**

```json
{
  "data": [
    "+15551234567",
    "+15559876543",
    "ACME-BANK",
    "T-Mobile"
  ]
}
```

---

## Permissions

The SMS relay feature introduces three permissions. Role assignments follow the standard RBAC model defined in the platform.

### device_text_messages:write

Permission string: `device_text_messages:write`

Required for the relay endpoint (`POST /api/device-text-messages/relay`). Allows a user to submit messages on behalf of their own devices.

Granted to: **Contributor**, **Admin** roles by default.

### device_text_messages:read

Permission string: `device_text_messages:read`

Required for the query endpoints (`GET /api/device-text-messages`, `GET /api/device-text-messages/senders`). Allows a user to read their own messages.

Granted to: **Contributor**, **Admin** roles by default.

### device_text_messages:read_any

Permission string: `device_text_messages:read_any`

Reserved for admin-level cross-user access (e.g., support tooling). Not yet used by any endpoint; add this permission check when building admin views that display messages across all users.

Granted to: **Admin** role only.

### Notes on Device Endpoints

The device registration and SIM sync endpoints (`POST /api/device-text-messages/devices/register`, `POST /api/device-text-messages/devices/:deviceId/sims`, `GET /api/device-text-messages/devices`) require only a valid JWT — no additional permission beyond authentication. Ownership is enforced by comparing `device.userId` against the authenticated user's ID.

---

## Deduplication

The relay feature uses hash-based deduplication to ensure each unique SMS is stored exactly once, regardless of how many times the Android app retries.

### Hash Computation

For each message in a relay request, `RelayService` computes:

```typescript
const messageHash = createHash('sha256')
  .update(`${dto.deviceId}:${msg.sender}:${msg.body}:${msg.smsTimestamp}`)
  .digest('hex');
```

The input string is the concatenation of four fields separated by colons:
- `deviceId` — ensures the same SMS from two different devices produces different hashes
- `sender` — originating address
- `body` — full message text
- `smsTimestamp` — ISO 8601 UTC string from the device

The resulting hex string is stored in the `message_hash` column.

### Database Constraint

`message_hash` has a `@unique` constraint in the Prisma schema, which maps to a `UNIQUE` index on the `sms_messages` table in PostgreSQL.

### Insertion Strategy

Messages are inserted using Prisma's `createMany` with `skipDuplicates: true`:

```typescript
const result = await this.prisma.smsMessage.createMany({
  data: messagesToInsert,
  skipDuplicates: true,
});
```

This maps to `INSERT ... ON CONFLICT DO NOTHING` in PostgreSQL. The `result.count` reflects only the rows actually inserted.

### Why This Matters

The Android app uses WorkManager with exponential backoff. A network timeout can cause a scenario where:

1. The relay request reaches the API and messages are stored.
2. The API response is lost before the app receives it.
3. WorkManager retries the job and sends the same messages again.

Without deduplication, this would produce duplicate records. With `skipDuplicates: true`, the retry is safe — already-stored messages are silently ignored, and the response correctly reports `duplicates: N`.

The response breakdown `{ stored, duplicates }` allows the Android app to log accurate relay statistics even when some messages in a batch were already present.

---

## Future: Media Attachments

The `sms_attachments` table exists in the schema but has no relay endpoints today. It is designed for MMS support.

### Current State

- The table is created by migration and available in the database.
- No API endpoints write to or read from `sms_attachments`.
- `SmsMessage.attachments` is a Prisma relation but is not included in any current query.

### Planned Design

Each `SmsAttachment` links:
- A `SmsMessage` (via `message_id`)
- A `StorageObject` (via `storage_object_id`) — the platform's existing file storage abstraction

When MMS support is added, the flow would be:

1. Android app detects an MMS with media parts.
2. App uploads each media file using the existing storage upload endpoints (`POST /api/storage/objects` or the resumable upload flow).
3. App calls the relay endpoint with an extended message body that includes attachment references (storage object IDs).
4. The relay endpoint creates `SmsAttachment` records linking the message to each storage object.

### Changes Required to Add MMS Support

1. **Extend `RelaySmsDto`** — add an optional `attachments` array to `SmsItem`, each item containing a `storageObjectId` and `mimeType`.
2. **Update `RelayService.relaySms`** — after creating each `SmsMessage`, create `SmsAttachment` records for any provided attachment references.
3. **Update query endpoints** — include `attachments` in the `SmsMessage` select if callers need them.
4. **Update `ApiService.kt`** — add attachment fields to `SmsItem` in the Android app.
5. **Add MMS capture to `SmsReceiver`** — handle `MMS_RECEIVED` broadcast and upload media before relaying.
