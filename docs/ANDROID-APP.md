# Android App

This guide covers the Sink companion Android app — its architecture, features, and how to extend it.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Getting Started](#getting-started)
- [Authentication Flow](#authentication-flow)
- [Message Sync Feature](#message-sync-feature)
- [Logging System](#logging-system)
- [Adding New Features](#adding-new-features)
- [API Contract](#api-contract)
- [Build and Release](#build-and-release)

---

## Overview

The Sink Android app is a companion application for the Sink platform. It runs on Android devices and enables features that require physical device capabilities such as SMS access.

**First feature: Message Sync (SMS Relay).** The app captures incoming SMS messages and relays them to the Sink API in near real-time, making messages searchable and accessible in the web UI.

**Tech stack:**

| Library | Purpose |
|---------|---------|
| Kotlin | Primary language |
| Jetpack Compose + Material 3 | Declarative UI |
| Hilt (Dagger) | Dependency injection |
| Room | Local SQLite databases |
| Retrofit + OkHttp | HTTP client |
| WorkManager | Reliable background tasks |
| DataStore (Preferences) | Token persistence |

Minimum SDK: API 26 (Android 8.0). Target SDK: API 35.

---

## Architecture

### Package Structure

```
com.sink.app/
  SinkApplication.kt          # Application class; Hilt entry point, WorkManager config
  MainActivity.kt             # Single activity; hosts Compose NavHost

  api/
    ApiClient.kt              # Hilt module: OkHttpClient, Retrofit, ApiService providers
    ApiService.kt             # Retrofit interface — all API calls
    models/
      ApiModels.kt            # Request/response data classes

  auth/
    AuthInterceptor.kt        # OkHttp interceptor: attaches Bearer token, handles 401
    TokenManager.kt           # DataStore wrapper: access token, refresh token, device ID
    DeviceAuthScreen.kt       # Compose UI for device authorization
    DeviceAuthViewModel.kt    # ViewModel: drives the RFC 8628 polling loop

  messagesync/
    SmsReceiver.kt            # BroadcastReceiver: captures SMS_RECEIVED broadcasts
    SmsRelayWorker.kt         # WorkManager worker: reads outbox, calls relay API
    DeviceRegistrationManager.kt  # Registers device + syncs SIM cards on first login
    SimCardReader.kt          # Reads active SIM subscriptions via SubscriptionManager
    MessageSyncScreen.kt      # Compose UI: relay status and device info
    MessageSyncViewModel.kt   # ViewModel: polls device state, triggers registration
    db/
      SmsOutboxEntity.kt      # Room entity: pending messages
      SmsOutboxDao.kt         # DAO: insert, getPending, updateStatus
      SmsOutboxDatabase.kt    # Room database definition

  logging/
    LogFeature.kt             # Enum of features that can emit logs
    LogRepository.kt          # debug/info/warn/error helpers + cleanup
    LogCleanupWorker.kt       # WorkManager worker: purges logs older than 7 days
    LogsScreen.kt             # Compose UI: filterable log viewer + export
    LogsViewModel.kt          # ViewModel: drives log queries and share intent
    db/
      LogEntity.kt            # Room entity: structured log records
      LogDao.kt               # DAO: insert, getAll, getByFeature, deleteOlderThan
      LogDatabase.kt          # Room database definition

  navigation/
    NavGraph.kt               # Root composable: auth gate + bottom-nav scaffold
    BottomNavBar.kt           # Icon mapping for bottom navigation items

  settings/
    SettingsScreen.kt         # Compose UI: account info, logout
    SettingsViewModel.kt      # ViewModel: logout flow

  ui/
    theme/                    # Material 3 color scheme and typography
    components/               # Shared Compose components
```

### Dependency Injection Graph

Hilt manages all dependencies as singletons in `SingletonComponent`:

```
SingletonComponent
  TokenManager          (DataStore wrapper)
  AuthInterceptor       (OkHttp interceptor, depends on TokenManager)
  OkHttpClient          (depends on AuthInterceptor)
  Retrofit              (depends on OkHttpClient)
  ApiService            (depends on Retrofit)
  SimCardReader         (depends on Application context)
  DeviceRegistrationManager  (depends on ApiService, TokenManager, SimCardReader, LogRepository)
  SmsOutboxDao          (provided by SmsOutboxDatabase)
  LogRepository         (depends on LogDao)
```

WorkManager workers (`SmsRelayWorker`, `LogCleanupWorker`) use `@HiltWorker` / `@AssistedInject`. The `SinkApplication` class installs the `HiltWorkerFactory` so WorkManager can inject into workers.

### Data Flow: SMS Capture to API

```
Incoming SMS
    |
    v
SmsReceiver (BroadcastReceiver)
    |  groups multi-part messages by sender
    |  reads subscription ID and SIM slot from intent extras
    v
SmsOutboxDao.insert()  [Room: sms_outbox table, status = PENDING]
    |
    v
WorkManager.enqueueUniqueWork("sms_relay", REPLACE)
    |  constraint: CONNECTED network
    |  backoff: EXPONENTIAL from WorkRequest.MIN_BACKOFF_MILLIS
    v
SmsRelayWorker.doWork()
    |  reads up to 100 PENDING records
    |  formats timestamps as ISO 8601 UTC
    |  calls POST /api/device-text-messages/relay
    |  on success: marks records as SYNCED
    |  on failure: returns Result.retry() (triggers exponential backoff)
    v
API: stored to sms_messages table (deduplication via messageHash)
```

---

## Getting Started

### Prerequisites

- Android Studio Hedgehog (2023.1) or later
- JDK 17 (bundled with Android Studio)
- An Android device or emulator running API 26+
- A running Sink API (local or remote)

### Opening the Project

Open `apps/android/` as the project root in Android Studio. Do not open the repository root — Android Studio expects the `settings.gradle.kts` at the project root.

### Configuring the API URL

API URLs are set per build variant in `apps/android/app/build.gradle.kts`:

```kotlin
defaultConfig {
    // Used for release builds
    buildConfigField("String", "API_BASE_URL", "\"https://sink.marin.cr/api\"")
}

buildTypes {
    debug {
        // 10.0.2.2 is the Android emulator's alias for the host machine's localhost
        buildConfigField("String", "API_BASE_URL", "\"http://10.0.2.2:3535/api\"")
    }
}
```

To point a debug build at a different server, change the `debug` `buildConfigField` value and rebuild.

### Build and Run

1. Connect a device or start an emulator.
2. Select the `debug` build variant in Android Studio.
3. Click Run (or press Shift+F10).

### Required Permissions

The app declares these permissions in `AndroidManifest.xml`:

| Permission | Purpose | Runtime prompt required |
|-----------|---------|------------------------|
| `INTERNET` | API communication | No |
| `RECEIVE_SMS` | Capture incoming SMS | Yes (dangerous permission) |
| `READ_SMS` | Access SMS content | Yes (dangerous permission) |
| `READ_PHONE_STATE` | Read SIM card info via SubscriptionManager | Yes (dangerous permission) |
| `POST_NOTIFICATIONS` | Show WorkManager notifications on API 33+ | Yes (dangerous permission) |

The `SmsReceiver` is registered with `android:permission="android.permission.BROADCAST_SMS"` to prevent third-party apps from sending fake SMS broadcasts to it.

Permissions are requested at runtime from the `MessageSyncScreen` when the user enables message sync. If a permission is denied, the affected feature is gracefully degraded (e.g., `SimCardReader` returns an empty list if `READ_PHONE_STATE` is denied).

---

## Authentication Flow

The app uses the OAuth 2.0 Device Authorization Grant (RFC 8628). There is no username/password or browser-based login.

### Step-by-Step

1. **App starts** — `NavGraph.kt` checks `TokenManager.isLoggedIn`. If no access token is stored, `DeviceAuthScreen` is shown instead of the main navigation.

2. **Request device code** — `DeviceAuthViewModel` calls `POST /api/auth/device/code` with optional `clientInfo` (device name, manufacturer, model, OS version, app version). The server returns a `userCode` and `verificationUri`.

3. **Display code** — The screen shows the `userCode` and `verificationUri`. The user opens the verification URL on another device (phone or computer) and enters the code.

4. **Poll for token** — The ViewModel polls `POST /api/auth/device/token` every `interval` seconds (returned by the server, default 5 s). Possible poll outcomes:
   - `authorization_pending` — keep polling
   - `slow_down` — increase interval and keep polling
   - `access_denied` — user rejected; reset and show error
   - `expired_token` — code expired; restart flow
   - HTTP 200 with tokens — authorization granted

5. **Store tokens** — On success, `TokenManager.saveTokens(accessToken, refreshToken)` writes both tokens to the DataStore preferences file (`auth_tokens`).

6. **Register device** — `DeviceRegistrationManager.registerDeviceAndSyncSims()` is called once after first login. It calls `POST /api/device-text-messages/devices/register` and stores the returned `deviceId` in `TokenManager`. It then reads SIM cards and calls `POST /api/device-text-messages/devices/:deviceId/sims`.

7. **Main UI appears** — `NavGraph` observes `isLoggedIn` reactively; switching to `true` replaces `DeviceAuthScreen` with the bottom-nav scaffold.

### Token Storage

Tokens are stored in Android DataStore (Preferences) under the filename `auth_tokens`. Three keys are used:

- `access_token` — JWT bearer token
- `refresh_token` — long-lived refresh token
- `device_id` — UUID assigned by the API after device registration

DataStore writes are atomic and survive process death.

### Token Refresh via AuthInterceptor

`AuthInterceptor` is an OkHttp interceptor that runs on every request:

1. Reads the current access token from `TokenManager`.
2. Attaches it as `Authorization: Bearer <token>`.
3. If the response is HTTP 401 and a token was sent, it attempts a token refresh (calls `POST /api/auth/refresh`).
4. On successful refresh, stores the new access token and retries the original request once.
5. If refresh fails, clears all stored tokens; the app returns to the login screen because `isLoggedIn` becomes `false`.

The interceptor skips auth header injection for `auth/device/code` and `auth/device/token` endpoints, which are public.

### Logout

From `SettingsScreen`, the user can tap Logout. `SettingsViewModel` calls `TokenManager.clearTokens()`, which removes all keys from the DataStore. The reactive `isLoggedIn` flow emits `false`, and `NavGraph` immediately returns to `DeviceAuthScreen`.

---

## Message Sync Feature

### SMS Capture

`SmsReceiver` is a `BroadcastReceiver` registered in `AndroidManifest.xml` for the `android.provider.Telephony.SMS_RECEIVED` action with priority 999 (high priority to capture before other apps).

When an SMS arrives:

1. `Telephony.Sms.Intents.getMessagesFromIntent(intent)` extracts all message PDUs.
2. PDUs from the same sender are grouped together and concatenated — this handles multi-part (long) SMS messages correctly.
3. The subscription ID and SIM slot index are read from intent extras (`"subscription"` and `"slot"`). These are `-1` if unavailable (single-SIM devices or older Android versions).
4. A `SmsOutboxEntity` is inserted into Room with status `PENDING`.
5. `WorkManager.enqueueUniqueWork("sms_relay", REPLACE, ...)` is called to schedule an immediate relay attempt. `REPLACE` policy ensures only one relay job is queued at a time even if multiple messages arrive rapidly.

### Multi-SIM Support

`SimCardReader` uses `SubscriptionManager.getActiveSubscriptionInfoList()` to enumerate all active SIM subscriptions. For each subscription it reads:

- `simSlotIndex` — physical SIM slot (0, 1, ...)
- `subscriptionId` — Android's unique identifier for the subscription
- `carrierName` — carrier display name (e.g., "T-Mobile")
- `phoneNumber` — phone number if available (may be empty)
- `iccId` — SIM card serial number
- `displayName` — user-assigned name

This information is sent to the API at login time and kept up to date. `READ_PHONE_STATE` permission is required; if denied, `readSimCards()` returns an empty list and SIM-related fields are omitted.

### Local Outbox Pattern

All incoming messages are written to a local Room database (`sms_outbox` table) before any network attempt. This guarantees no messages are lost due to network failures. The `SmsOutboxEntity` tracks three states:

- `PENDING` — captured but not yet sent
- `SYNCED` — successfully delivered to the API
- `FAILED` — permanently failed (reserved for future use; currently all failures trigger retry)

`SmsRelayWorker` always reads `PENDING` records in batches of up to 100. After a successful API call, it marks the batch as `SYNCED`.

### Background Relay with WorkManager

`SmsRelayWorker` is a `CoroutineWorker` with `@HiltWorker` for dependency injection. Its constraints and retry behavior:

- **Network constraint**: `CONNECTED` — the worker only runs when network is available.
- **Backoff**: `EXPONENTIAL` starting from `WorkRequest.MIN_BACKOFF_MILLIS` (10 seconds). WorkManager automatically doubles the delay on each retry, capped at 5 minutes.
- **Unique work**: named `"sms_relay"` with `REPLACE` policy — if a new SMS arrives while a relay is already queued, the queue entry is replaced, preventing duplicates.

On failure (network error, API error), `doWork()` returns `Result.retry()`, which triggers the backoff. On success it returns `Result.success()`.

### Deduplication

The server computes a `messageHash` (`SHA-256` of `deviceId:sender:body:smsTimestamp`) and enforces a unique constraint on it. The relay endpoint uses `createMany` with `skipDuplicates: true`. This means:

- If the Android app retries after a network timeout (message was received by the server but the response was lost), the duplicate is silently skipped.
- The API response includes `{ stored: N, duplicates: M }` so the app can log accurate counts.

### Device and SIM Registration

`DeviceRegistrationManager` is called once after the first successful login. It:

1. Calls `POST /api/device-text-messages/devices/register` with device metadata (name, platform, manufacturer, model, OS version, app version). The server upserts by `(userId, name)`, so re-running registration on the same device is safe.
2. Stores the returned `deviceId` in `TokenManager`.
3. Calls `POST /api/device-text-messages/devices/:deviceId/sims` with the SIM list from `SimCardReader`. The server upserts SIMs and removes any SIM records that are no longer present on the device.

---

## Logging System

The app maintains an internal structured log that is separate from Android's Logcat. This log is visible in the app's Logs screen and can be exported.

### Writing Logs

Inject `LogRepository` and call one of the level methods:

```kotlin
@Inject lateinit var logRepository: LogRepository

// Inside a suspend function or coroutine:
logRepository.debug(LogFeature.MESSAGE_SYNC, "Starting relay batch")
logRepository.info(LogFeature.MESSAGE_SYNC, "Relay complete: 5 stored, 0 duplicates")
logRepository.warn(LogFeature.GENERAL, "Permission not granted", details = "READ_PHONE_STATE")
logRepository.error(LogFeature.MESSAGE_SYNC, "Relay failed", details = exception.message)
```

All four methods (`debug`, `info`, `warn`, `error`) accept an optional `details: String?` parameter for additional context (e.g., stack trace excerpt, raw error message).

### LogFeature Enum

`LogFeature` categorizes logs by the feature that emitted them. Current values:

| Enum value | Display name | Used by |
|-----------|-------------|--------|
| `MESSAGE_SYNC` | Message Sync | `SmsRelayWorker`, `DeviceRegistrationManager`, `SmsReceiver` indirectly |
| `DEVICE_AUTH` | Device Auth | `DeviceAuthViewModel` |
| `GENERAL` | General | `LogCleanupWorker`, catch-all |

To add a new feature, add an entry to the `LogFeature` enum:

```kotlin
enum class LogFeature(val displayName: String) {
    MESSAGE_SYNC("Message Sync"),
    DEVICE_AUTH("Device Auth"),
    GENERAL("General"),
    MY_FEATURE("My Feature");  // add here
    ...
}
```

### Storage

Logs are stored in a Room database (`app_logs` table). Each `LogEntity` record has:

- `id` — auto-increment primary key
- `feature` — `LogFeature.name` string
- `level` — `"DEBUG"`, `"INFO"`, `"WARN"`, or `"ERROR"`
- `message` — primary log message
- `details` — optional additional context
- `timestamp` — Unix millis at time of logging

### Retention

`LogCleanupWorker` is a WorkManager worker scheduled to run periodically (caller is responsible for scheduling it at app startup). It calls `LogRepository.cleanup(retentionDays = 7)`, which deletes all records older than 7 days.

### Export

From `LogsScreen`, users can filter logs by feature and export them. The export uses a `FileProvider` to create a temporary file and shares it via Android's share intent (`ACTION_SEND`), allowing the user to send logs by email, messaging app, or save to files.

---

## Adding New Features

Follow this template when adding a new feature to the app.

### 1. Create the Feature Package

```
com.sink.app/
  myfeature/
    MyFeatureScreen.kt
    MyFeatureViewModel.kt
    db/                   # only if local storage is needed
      MyFeatureEntity.kt
      MyFeatureDao.kt
      MyFeatureDatabase.kt
```

### 2. Create the Screen Composable

```kotlin
// myfeature/MyFeatureScreen.kt
@Composable
fun MyFeatureScreen(viewModel: MyFeatureViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsState()
    // Compose UI here
}
```

### 3. Create the ViewModel

```kotlin
// myfeature/MyFeatureViewModel.kt
@HiltViewModel
class MyFeatureViewModel @Inject constructor(
    private val apiService: ApiService,
    private val logRepository: LogRepository
) : ViewModel() {

    private val _state = MutableStateFlow(MyFeatureState())
    val state: StateFlow<MyFeatureState> = _state.asStateFlow()

    fun doSomething() {
        viewModelScope.launch {
            try {
                // call API or Room
                logRepository.info(LogFeature.MY_FEATURE, "Done")
            } catch (e: Exception) {
                logRepository.error(LogFeature.MY_FEATURE, "Failed", e.message)
            }
        }
    }
}
```

### 4. Add Navigation Entry to NavGraph.kt

```kotlin
// In NavGraph.kt — add to the sealed class:
sealed class Screen(val route: String, val label: String) {
    object MyFeature : Screen("my_feature", "My Feature")
    // ...existing entries
}

// In SinkNavHost(), add to bottomNavItems list:
val bottomNavItems = listOf(Screen.MessageSync, Screen.Logs, Screen.Settings, Screen.MyFeature)

// In NavHost block:
composable(Screen.MyFeature.route) { MyFeatureScreen() }
```

### 5. Add Icon to BottomNavBar.kt

```kotlin
object BottomNavBar {
    fun iconFor(screen: Screen): ImageVector = when (screen) {
        is Screen.MyFeature -> Icons.Default.Star  // choose an appropriate icon
        // ...existing entries
    }
}
```

### 6. Add LogFeature Enum Value

```kotlin
enum class LogFeature(val displayName: String) {
    MY_FEATURE("My Feature"),
    // ...existing entries
}
```

### 7. Add API Endpoints to ApiService.kt

```kotlin
interface ApiService {
    @GET("my-feature/items")
    suspend fun listItems(): ApiResponse<List<MyItem>>

    @POST("my-feature/items")
    suspend fun createItem(@Body request: CreateItemRequest): ApiResponse<MyItem>
}
```

### 8. Add API Models to ApiModels.kt

```kotlin
data class MyItem(val id: String, val name: String)
data class CreateItemRequest(val name: String)
```

### 9. Create Room Entities and DAOs (if local storage needed)

```kotlin
// db/MyFeatureEntity.kt
@Entity(tableName = "my_feature_items")
data class MyFeatureEntity(
    @PrimaryKey val id: String,
    val name: String,
    val syncedAt: Long? = null
)

// db/MyFeatureDao.kt
@Dao
interface MyFeatureDao {
    @Query("SELECT * FROM my_feature_items")
    fun getAll(): Flow<List<MyFeatureEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(item: MyFeatureEntity)
}
```

Provide the database and DAO from a Hilt module (follow the pattern in `SmsOutboxDatabase.kt`).

### 10. Update AndroidManifest.xml if New Permissions Needed

```xml
<uses-permission android:name="android.permission.MY_NEW_PERMISSION" />
```

For dangerous permissions, also add runtime permission request logic in your screen composable using `rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission())`.

---

## API Contract

All endpoints use the base URL configured in `BuildConfig.API_BASE_URL`. All authenticated endpoints require `Authorization: Bearer <accessToken>`.

### POST /api/auth/device/code

Initiates the device authorization flow. Public — no token required.

Request:
```json
{
  "clientInfo": {
    "deviceName": "Google Pixel 8",
    "manufacturer": "Google",
    "model": "Pixel 8",
    "osVersion": "Android 15",
    "appVersion": "1.0.0"
  }
}
```

Response `200`:
```json
{
  "data": {
    "deviceCode": "...",
    "userCode": "ABCD-1234",
    "verificationUri": "https://sink.marin.cr/device",
    "verificationUriComplete": "https://sink.marin.cr/device?code=ABCD-1234",
    "expiresIn": 900,
    "interval": 5
  }
}
```

### POST /api/auth/device/token

Polls for authorization status. Public — no token required.

Request:
```json
{ "deviceCode": "<deviceCode from above>" }
```

Response `200` (granted):
```json
{
  "data": {
    "accessToken": "<jwt>",
    "refreshToken": "<token>",
    "tokenType": "Bearer",
    "expiresIn": 900
  }
}
```

Response `400` (pending/slow_down/denied/expired):
```json
{
  "error": "authorization_pending",
  "error_description": "The user has not yet authorized the device."
}
```

### POST /api/auth/refresh

Refreshes the access token. Requires a valid refresh token (sent as an `HttpOnly` cookie or Bearer — check the server implementation).

Response `200`:
```json
{
  "data": {
    "accessToken": "<new jwt>",
    "expiresIn": 900
  }
}
```

### POST /api/device-text-messages/devices/register

Registers or updates the device. Requires authentication.

Request:
```json
{
  "name": "Google Pixel 8",
  "platform": "android",
  "manufacturer": "Google",
  "model": "Pixel 8",
  "osVersion": "Android 15",
  "appVersion": "1.0.0",
  "deviceCodeId": "<uuid, optional>"
}
```

Response `201`:
```json
{
  "data": {
    "id": "<uuid>",
    "name": "Google Pixel 8",
    "platform": "android",
    "isActive": true
  }
}
```

### POST /api/device-text-messages/devices/:deviceId/sims

Syncs SIM cards for a registered device. Stale SIMs are removed. Requires authentication.

Request:
```json
{
  "sims": [
    {
      "slotIndex": 0,
      "subscriptionId": 1,
      "carrierName": "T-Mobile",
      "phoneNumber": "+15551234567",
      "iccId": "8901260...",
      "displayName": "Personal"
    }
  ]
}
```

Response `201`: array of `DeviceSim` objects after upsert.

### POST /api/device-text-messages/relay

Relays a batch of SMS messages. Requires `device_text_messages:write` permission.

Request:
```json
{
  "deviceId": "<uuid>",
  "messages": [
    {
      "sender": "+15559876543",
      "body": "Your verification code is 123456",
      "smsTimestamp": "2026-03-29T14:00:00.000Z",
      "simSubscriptionId": 1,
      "simSlotIndex": 0
    }
  ]
}
```

- `messages`: 1–100 items per request
- `sender`: max 50 characters
- `body`: max 10,000 characters
- `smsTimestamp`: ISO 8601 UTC datetime string
- `simSubscriptionId` / `simSlotIndex`: optional; omit on single-SIM devices

Response `201`:
```json
{
  "data": {
    "stored": 1,
    "duplicates": 0
  }
}
```

### GET /api/device-text-messages/devices

Lists all devices registered by the authenticated user.

Response `200`:
```json
{
  "data": [
    {
      "id": "<uuid>",
      "name": "Google Pixel 8",
      "platform": "android",
      "isActive": true,
      "sims": [
        {
          "id": "<uuid>",
          "slotIndex": 0,
          "subscriptionId": 1,
          "carrierName": "T-Mobile",
          "phoneNumber": "+15551234567",
          "displayName": "Personal"
        }
      ]
    }
  ]
}
```

---

## Build and Release

### Build Variants

| Variant | API URL | Minification | Logging |
|---------|---------|-------------|--------|
| `debug` | `http://10.0.2.2:3535/api` | Off | HTTP body logging via OkHttp |
| `release` | `https://sink.marin.cr/api` | On (ProGuard) | No HTTP logging |

### Changing the Release API URL

Edit `defaultConfig.buildConfigField` in `apps/android/app/build.gradle.kts`:

```kotlin
buildConfigField("String", "API_BASE_URL", "\"https://your-domain.com/api\"")
```

### ProGuard

The release build uses `proguard-android-optimize.txt` plus custom rules in `apps/android/app/proguard-rules.pro`. If you add new libraries that require ProGuard keep rules, add them to that file.

Key rules already needed:
- Retrofit and OkHttp (keep method signatures for reflection-based parsing)
- Gson (keep model classes and their fields)
- Room (keep entity and DAO classes)

### APK / AAB Generation

To build a release APK:

```
Build > Generate Signed Bundle/APK > APK > release
```

To build an Android App Bundle for the Play Store:

```
Build > Generate Signed Bundle/APK > Android App Bundle > release
```

### Signing

Configure signing credentials in `build.gradle.kts` under `android.signingConfigs`. Store keystore credentials in environment variables or a `keystore.properties` file that is not committed to version control.

### Version Bumping

Update `versionCode` and `versionName` in `defaultConfig` before each release:

```kotlin
versionCode = 2        // increment by 1 for every release
versionName = "1.1.0"  // semantic version shown to users
```
