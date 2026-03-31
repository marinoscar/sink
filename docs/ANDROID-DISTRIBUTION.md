# Android APK Distribution

## Overview

The Sink Android app is distributed via a self-hosted system rather than the Google Play Store. This approach is appropriate because the app is a private tool intended for a known set of users, not a public release. Self-hosting avoids Play Store review requirements, publishing fees, and policy constraints while keeping distribution fully under our control.

Access is gated by the existing Sink authentication system. The APK download endpoint is public (no auth required) so users can install the app before they have a session, but API features within the app require a valid login.

---

## Architecture

```
Windows (Developer Machine)
  |
  | scripts/publish-android.ps1
  |   1. Bump version in build.gradle.kts
  |   2. Build prod release APK (Gradle)
  |   3. Upload APK + version.json to S3
  v
Amazon S3
  s3://<bucket>/app/android/sink-app.apk
  s3://<bucket>/app/android/version.json
  |
  | GET /api/app/android       → 302 to signed S3 URL (1-hour expiry)
  | GET /api/app/android/version → version manifest JSON
  v
Sink API (NestJS)
  |
  v
User's Phone
  https://sink.marin.cr/getapp  → Download APK → Install
```

---

## Prerequisites

The following must be present on the Windows machine used for building and publishing.

| Requirement | Notes |
|---|---|
| Android Studio | Provides the JDK, Android SDK, and Gradle. Open the project once to let it download all dependencies. |
| AWS CLI | Install with `winget install Amazon.AWSCLI` |
| Git repository | Cloned at `C:\git\sink` (or adjust paths accordingly) |
| S3 bucket | Configured in `infra/compose/.env` (see S3 configuration below) |

### S3 Configuration

The publish script reads credentials from `infra/compose/.env`. Ensure the following variables are set:

```bash
S3_BUCKET=your-bucket-name
S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key-id
AWS_SECRET_ACCESS_KEY=your-secret-access-key
```

---

## First-Time Setup

Before you can publish, you must generate a signing keystore. Android requires that every APK be signed with a consistent key. If the key changes between releases, existing users must uninstall before they can install the updated version.

### Generate the Keystore

From the repository root on Windows:

```powershell
.\scripts\publish-android.ps1 -GenerateKeystore
```

This creates two files:

| File | Purpose |
|---|---|
| `apps/android/keystore/release.jks` | The signing keystore (binary) |
| `apps/android/keystore/keystore.properties` | Key alias and passwords |

Both files are git-ignored and will never be committed to the repository.

**Back up the keystore immediately.** Store `release.jks` and `keystore.properties` somewhere secure (a password manager, encrypted drive, or secure cloud storage). If the keystore is lost:
- You cannot publish updates to existing installations.
- All existing users must uninstall the app and reinstall from scratch.

---

## Publishing a New Version

Run the publish script from the repository root on Windows.

### Version Bump Options

```powershell
# Bump patch version: 1.0.0 → 1.0.1 (default)
.\scripts\publish-android.ps1

# Bump minor version: 1.0.x → 1.1.0
.\scripts\publish-android.ps1 -Minor

# Bump major version: 1.x.y → 2.0.0
.\scripts\publish-android.ps1 -Major

# Retry upload without rebuilding (useful if upload failed)
.\scripts\publish-android.ps1 -SkipBuild
```

### What the Script Does

1. Reads S3 credentials from `infra/compose/.env`
2. Auto-increments `versionName` and `versionCode` in `apps/android/app/build.gradle.kts`
3. Runs `gradlew.bat assembleProdRelease` to build the production-flavor signed release APK
4. Uploads the APK to `s3://<bucket>/app/android/sink-app.apk`
5. Uploads a `version.json` manifest to `s3://<bucket>/app/android/version.json`
6. Commits the version bump to git

The **prod flavor** targets `sink.marin.cr` as the API base URL. A separate dev flavor (if used) would target a local or staging server.

---

## Version Management

Versions follow semantic versioning (`X.Y.Z`).

| Field | Type | Purpose |
|---|---|---|
| `versionName` | String (`X.Y.Z`) | Displayed to users |
| `versionCode` | Integer | Used by Android to determine if an update is available. Must be strictly increasing. |

Both values are stored in `apps/android/app/build.gradle.kts`, which is the single source of truth. The publish script increments them automatically and commits the change, so version history is tracked in git.

---

## S3 Layout

```
s3://<S3_BUCKET>/
  app/
    android/
      sink-app.apk      # Current release APK
      version.json      # Version manifest
```

### version.json Format

```json
{
  "versionCode": 2,
  "versionName": "1.0.1",
  "downloadUrl": "/getapp",
  "updatedAt": "2026-03-31T12:00:00Z"
}
```

S3 objects are not publicly accessible. The API generates time-limited signed URLs for all downloads.

---

## API Endpoints

Both endpoints are public (no authentication required).

### GET /api/app/android

Returns a `302` redirect to a signed S3 URL with a 1-hour expiry. The phone browser follows the redirect and downloads the APK directly from S3.

**Response:**
```
HTTP/1.1 302 Found
Location: https://s3.amazonaws.com/<bucket>/app/android/sink-app.apk?X-Amz-...
```

If no APK has been uploaded yet, the endpoint returns `404`.

### GET /api/app/android/version

Returns the version manifest as JSON.

**Response:**
```json
{
  "versionCode": 2,
  "versionName": "1.0.1",
  "downloadUrl": "/getapp",
  "updatedAt": "2026-03-31T12:00:00Z"
}
```

---

## Installing on a Phone

### First Install

1. Open `https://sink.marin.cr/getapp` in your phone's browser (Chrome recommended).
2. Tap **Download APK**.
3. When prompted, allow installation from unknown sources:
   - Chrome will prompt automatically, or navigate to **Settings → Apps → Special app access → Install unknown apps → Chrome**.
4. Open the downloaded `.apk` file to install.
5. Grant requested permissions (SMS, Notifications, etc.) when prompted.
6. Open the app and log in with your Sink account.

### Updating the App

Follow the same flow — visit `/getapp`, download, and install. Android detects that the new APK has a higher `versionCode` and the same signing key, and performs an in-place update that preserves app data.

---

## Troubleshooting

| Issue | Solution |
|---|---|
| "No APK available" on `/getapp` | No APK has been uploaded yet. Run `.\scripts\publish-android.ps1` to build and upload. |
| Keystore not found during build | Run `.\scripts\publish-android.ps1 -GenerateKeystore` to create the keystore first. |
| AWS CLI not configured | Install with `winget install Amazon.AWSCLI`. Verify credentials in `infra/compose/.env`. |
| Gradle build fails | Open the Android project in Android Studio at least once to download the SDK and all dependencies, then retry. |
| Phone blocks installation | Go to **Settings → Apps → Special app access → Install unknown apps** and allow Chrome (or your browser). |
| "App not installed" error on phone | The signing key has changed. Uninstall the existing app, then install the new APK. |
| Upload fails after successful build | Check AWS credentials in `infra/compose/.env`. Retry with `.\scripts\publish-android.ps1 -SkipBuild` to upload without rebuilding. |
| Signed URL expired | The 1-hour download window passed. Tap the download button again to get a fresh link. |

---

## Security Notes

- `apps/android/keystore/release.jks` and `apps/android/keystore/keystore.properties` are git-ignored and must never be committed.
- Back up the keystore to a secure location outside the repository. Loss of the keystore is irreversible.
- S3 objects are private. The API generates signed URLs with a 1-hour expiry; there is no permanent public download link.
- The `/getapp` landing page and `GET /api/app/android` endpoint are intentionally public so users can install the app before they have a session. No sensitive data is exposed by these endpoints.
- AWS credentials (access key, secret) must only be stored in `infra/compose/.env`, which is git-ignored.

---

## Related Documentation

- [Android App](./ANDROID-APP.md) — App architecture, SMS/RCS capture, background service, permissions
- [SMS Relay API](./SMS-RELAY-API.md) — Server-side message relay and query API
