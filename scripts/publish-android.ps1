<#
.SYNOPSIS
    Build and publish the Android APK to S3.

.DESCRIPTION
    Builds a signed release APK using Gradle, bumps the version in build.gradle.kts,
    uploads the APK and a version.json manifest to S3, and commits the version bump.

.PARAMETER GenerateKeystore
    Generate a release keystore (first-time setup). Exits after generation.

.PARAMETER Major
    Bump major version instead of patch (e.g. 1.x.y -> 2.0.0)

.PARAMETER Minor
    Bump minor version instead of patch (e.g. 1.0.x -> 1.1.0)

.PARAMETER SkipBuild
    Skip Gradle build, just upload the existing APK (useful for retrying failed uploads)

.EXAMPLE
    .\scripts\publish-android.ps1
    Build + upload (auto-increments patch version)

.EXAMPLE
    .\scripts\publish-android.ps1 -GenerateKeystore
    First-time: create signing keystore

.EXAMPLE
    .\scripts\publish-android.ps1 -Minor
    Bump minor version (1.0.x -> 1.1.0)

.EXAMPLE
    .\scripts\publish-android.ps1 -Major
    Bump major version (1.x.y -> 2.0.0)
#>

param(
    [switch]$GenerateKeystore,
    [switch]$Major,
    [switch]$Minor,
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Colors for output
# ---------------------------------------------------------------------------
function Write-Info { Write-Host $args -ForegroundColor Cyan }
function Write-Success { Write-Host $args -ForegroundColor Green }
function Write-Warn { Write-Host $args -ForegroundColor Yellow }
function Write-Err { Write-Host $args -ForegroundColor Red }

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
$RepoRoot = Split-Path -Parent $PSScriptRoot
$AndroidProject = Join-Path $RepoRoot "apps\android"
$BuildGradle = Join-Path $AndroidProject "app\build.gradle.kts"
$KeystoreDir = Join-Path $AndroidProject "keystore"
$KeystoreFile = Join-Path $KeystoreDir "release.jks"
$KeystoreProps = Join-Path $KeystoreDir "keystore.properties"
$ApkOutput = Join-Path $AndroidProject "app\build\outputs\apk\prod\release\app-prod-release.apk"
$EnvFile = Join-Path $RepoRoot "infra\compose\.env"

# ---------------------------------------------------------------------------
# Banner
# ---------------------------------------------------------------------------
Write-Host ""
Write-Info "Sink Android Publish Script"
Write-Host "============================"
Write-Host ""

# ---------------------------------------------------------------------------
# Helper: Parse .env file into a hashtable
# ---------------------------------------------------------------------------
function Read-EnvFile {
    param([string]$Path)

    $result = @{}
    if (-not (Test-Path $Path)) {
        return $result
    }

    foreach ($line in Get-Content $Path) {
        $trimmed = $line.Trim()
        if ($trimmed -eq "" -or $trimmed.StartsWith("#")) { continue }
        $eqIdx = $trimmed.IndexOf("=")
        if ($eqIdx -gt 0) {
            $key = $trimmed.Substring(0, $eqIdx).Trim()
            $val = $trimmed.Substring($eqIdx + 1).Trim()
            # Strip surrounding quotes
            if (($val.StartsWith('"') -and $val.EndsWith('"')) -or
                ($val.StartsWith("'") -and $val.EndsWith("'"))) {
                $val = $val.Substring(1, $val.Length - 2)
            }
            $result[$key] = $val
        }
    }
    return $result
}

# ---------------------------------------------------------------------------
# Helper: Generate random password
# ---------------------------------------------------------------------------
function New-RandomPassword {
    param([int]$Length = 20)
    $chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#%&"
    $bytes = New-Object byte[] $Length
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    $password = ""
    foreach ($b in $bytes) {
        $password += $chars[$b % $chars.Length]
    }
    return $password
}

# ---------------------------------------------------------------------------
# Helper: Find keytool
# ---------------------------------------------------------------------------
function Find-Keytool {
    # Try PATH first
    $kt = Get-Command "keytool" -ErrorAction SilentlyContinue
    if ($kt) { return $kt.Source }

    # Try JAVA_HOME
    if ($env:JAVA_HOME) {
        $candidate = Join-Path $env:JAVA_HOME "bin\keytool.exe"
        if (Test-Path $candidate) { return $candidate }
    }

    # Try Android Studio bundled JBR
    if ($env:ANDROID_HOME) {
        $jbrPath = Join-Path (Split-Path -Parent $env:ANDROID_HOME) "jbr\bin\keytool.exe"
        if (Test-Path $jbrPath) { return $jbrPath }
    }

    # Common Windows paths
    $commonPaths = @(
        "$env:ProgramFiles\Android\Android Studio\jbr\bin\keytool.exe",
        "$env:LOCALAPPDATA\Android\Sdk\..\jbr\bin\keytool.exe"
    )
    foreach ($p in $commonPaths) {
        if (Test-Path $p) { return $p }
    }

    return $null
}

# ===========================================================================
# Step 1: Generate keystore (if -GenerateKeystore)
# ===========================================================================
if ($GenerateKeystore) {
    Write-Info "Step 1: Generating release keystore..."
    Write-Host ""

    if (Test-Path $KeystoreFile) {
        Write-Err "ERROR: Keystore already exists at $KeystoreFile"
        Write-Err "Delete it manually if you want to regenerate."
        exit 1
    }

    $keytool = Find-Keytool
    if (-not $keytool) {
        Write-Err "ERROR: keytool not found."
        Write-Err "Install JDK or set JAVA_HOME / ANDROID_HOME environment variable."
        exit 1
    }
    Write-Info "Using keytool: $keytool"

    # Create keystore directory
    if (-not (Test-Path $KeystoreDir)) {
        New-Item -ItemType Directory -Path $KeystoreDir -Force | Out-Null
    }

    $pass = New-RandomPassword -Length 20
    Write-Info "Generating keystore with RSA 2048-bit key..."

    & $keytool -genkeypair -v `
        -keystore $KeystoreFile `
        -keyalg RSA `
        -keysize 2048 `
        -validity 10000 `
        -alias sink `
        -storepass $pass `
        -keypass $pass `
        -dname "CN=Sink App, O=Sink, L=Unknown, ST=Unknown, C=US"

    if ($LASTEXITCODE -ne 0) {
        Write-Err "ERROR: keytool failed with exit code $LASTEXITCODE"
        exit 1
    }

    # Write keystore.properties
    $propsContent = @"
storeFile=../keystore/release.jks
storePassword=$pass
keyAlias=sink
keyPassword=$pass
"@
    Set-Content -Path $KeystoreProps -Value $propsContent -Encoding UTF8

    Write-Host ""
    Write-Success "Keystore generated successfully!"
    Write-Host ""
    Write-Info "Keystore:   $KeystoreFile"
    Write-Info "Properties: $KeystoreProps"
    Write-Host ""
    Write-Warn "IMPORTANT: Add these to .gitignore if not already present:"
    Write-Warn "  apps/android/keystore/release.jks"
    Write-Warn "  apps/android/keystore/keystore.properties"
    Write-Host ""

    exit 0
}

# ===========================================================================
# Step 0: Read S3 config from .env
# ===========================================================================
Write-Info "Step 0: Reading S3 configuration from .env..."

if (-not (Test-Path $EnvFile)) {
    Write-Err "ERROR: .env file not found at $EnvFile"
    Write-Err "Copy from .env.example and configure S3 settings."
    exit 1
}

$envVars = Read-EnvFile -Path $EnvFile

$S3Bucket = $envVars["S3_BUCKET"]
$S3Region = $envVars["S3_REGION"]
$AwsAccessKey = $envVars["AWS_ACCESS_KEY_ID"]
$AwsSecretKey = $envVars["AWS_SECRET_ACCESS_KEY"]

if (-not $S3Bucket) {
    Write-Err "ERROR: S3_BUCKET not found in $EnvFile"
    exit 1
}

# Set AWS env vars for CLI
if ($AwsAccessKey) { $env:AWS_ACCESS_KEY_ID = $AwsAccessKey }
if ($AwsSecretKey) { $env:AWS_SECRET_ACCESS_KEY = $AwsSecretKey }
if ($S3Region) { $env:AWS_DEFAULT_REGION = $S3Region }

Write-Info "S3 Bucket: $S3Bucket"
Write-Info "S3 Region: $S3Region"
Write-Host ""

# ===========================================================================
# Step 2: Verify prerequisites
# ===========================================================================
Write-Info "Step 2: Verifying prerequisites..."

if (-not (Test-Path $KeystoreFile)) {
    Write-Err "ERROR: Release keystore not found at $KeystoreFile"
    Write-Err "Run with -GenerateKeystore to create one first."
    exit 1
}

$GradlewBat = Join-Path $AndroidProject "gradlew.bat"
if (-not (Test-Path $GradlewBat)) {
    Write-Err "ERROR: gradlew.bat not found at $GradlewBat"
    exit 1
}

$awsCli = Get-Command "aws" -ErrorAction SilentlyContinue
if (-not $awsCli) {
    Write-Err "ERROR: AWS CLI not found. Install it from https://aws.amazon.com/cli/"
    exit 1
}

Write-Success "All prerequisites verified."
Write-Host ""

# ===========================================================================
# Step 3: Version bump
# ===========================================================================
Write-Info "Step 3: Bumping version..."

if (-not (Test-Path $BuildGradle)) {
    Write-Err "ERROR: build.gradle.kts not found at $BuildGradle"
    exit 1
}

$gradleContent = Get-Content $BuildGradle -Raw

# Parse versionCode
if ($gradleContent -match 'versionCode\s*=\s*(\d+)') {
    $oldVersionCode = [int]$Matches[1]
} else {
    Write-Err "ERROR: Could not parse versionCode from $BuildGradle"
    exit 1
}

# Parse versionName
if ($gradleContent -match 'versionName\s*=\s*"(\d+)\.(\d+)\.(\d+)"') {
    $vMajor = [int]$Matches[1]
    $vMinor = [int]$Matches[2]
    $vPatch = [int]$Matches[3]
} else {
    Write-Err "ERROR: Could not parse versionName from $BuildGradle"
    exit 1
}

$oldVersionName = "$vMajor.$vMinor.$vPatch"

# Bump version
if ($Major) {
    $vMajor++
    $vMinor = 0
    $vPatch = 0
} elseif ($Minor) {
    $vMinor++
    $vPatch = 0
} else {
    $vPatch++
}

$newVersionCode = $oldVersionCode + 1
$newVersionName = "$vMajor.$vMinor.$vPatch"

# Write back to build.gradle.kts
$gradleContent = $gradleContent -replace 'versionCode\s*=\s*\d+', "versionCode = $newVersionCode"
$gradleContent = $gradleContent -replace 'versionName\s*=\s*"[\d.]+"', "versionName = `"$newVersionName`""
Set-Content -Path $BuildGradle -Value $gradleContent -NoNewline -Encoding UTF8

Write-Success "Version bumped: $oldVersionName ($oldVersionCode) -> $newVersionName ($newVersionCode)"
Write-Host ""

# ===========================================================================
# Step 4: Build APK (unless -SkipBuild)
# ===========================================================================
if ($SkipBuild) {
    Write-Warn "Step 4: Skipping build (-SkipBuild flag set)"
    Write-Host ""
} else {
    Write-Info "Step 4: Building release APK..."

    Push-Location $AndroidProject
    try {
        & .\gradlew.bat assembleProdRelease
        if ($LASTEXITCODE -ne 0) {
            Write-Err "ERROR: Gradle build failed with exit code $LASTEXITCODE"
            exit 1
        }
    } finally {
        Pop-Location
    }

    if (-not (Test-Path $ApkOutput)) {
        Write-Err "ERROR: APK not found at expected path: $ApkOutput"
        exit 1
    }

    $apkSize = (Get-Item $ApkOutput).Length / 1MB
    Write-Success ("APK built successfully ({0:N1} MB)" -f $apkSize)
    Write-Host ""
}

# ===========================================================================
# Step 5: Upload to S3
# ===========================================================================
Write-Info "Step 5: Uploading to S3..."

if (-not (Test-Path $ApkOutput)) {
    Write-Err "ERROR: APK not found at $ApkOutput"
    Write-Err "Run without -SkipBuild to build first."
    exit 1
}

# Upload APK
Write-Info "Uploading APK..."
aws s3 cp $ApkOutput "s3://$S3Bucket/app/android/sink-app.apk" `
    --content-type "application/vnd.android.package-archive"

if ($LASTEXITCODE -ne 0) {
    Write-Err "ERROR: APK upload failed."
    exit 1
}

# Create and upload version.json
$timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$versionJson = @{
    versionCode = $newVersionCode
    versionName = $newVersionName
    downloadUrl = "/getapp"
    updatedAt   = $timestamp
} | ConvertTo-Json -Compress

$tempFile = [System.IO.Path]::GetTempFileName()
Set-Content -Path $tempFile -Value $versionJson -Encoding UTF8

Write-Info "Uploading version.json..."
aws s3 cp $tempFile "s3://$S3Bucket/app/android/version.json" `
    --content-type "application/json"

if ($LASTEXITCODE -ne 0) {
    Remove-Item $tempFile -ErrorAction SilentlyContinue
    Write-Err "ERROR: version.json upload failed."
    exit 1
}

Remove-Item $tempFile -ErrorAction SilentlyContinue
Write-Success "Upload complete!"
Write-Host ""

# ===========================================================================
# Step 6: Git commit the version bump
# ===========================================================================
Write-Info "Step 6: Committing version bump..."

Push-Location $RepoRoot
try {
    git add "apps/android/app/build.gradle.kts"
    git commit -m "chore(android): bump version to $newVersionName (versionCode $newVersionCode)"

    if ($LASTEXITCODE -ne 0) {
        Write-Warn "WARNING: Git commit failed. You may need to commit manually."
    } else {
        Write-Success "Version bump committed."
    }
} finally {
    Pop-Location
}

Write-Host ""

# ===========================================================================
# Step 7: Summary
# ===========================================================================
Write-Host ""
Write-Info "Publish Complete!"
Write-Host "============================="
Write-Host ""
Write-Host "  Version:   $newVersionName ($newVersionCode)"
Write-Host "  APK:       s3://$S3Bucket/app/android/sink-app.apk"
Write-Host "  Manifest:  s3://$S3Bucket/app/android/version.json"
Write-Host ""
Write-Success "Visit https://sink.marin.cr/getapp to install"
Write-Host ""
