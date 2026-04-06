package com.sink.app.messagesync

import android.os.Build
import com.sink.app.BuildConfig
import com.sink.app.api.ApiService
import com.sink.app.api.models.RegisterDeviceRequest
import com.sink.app.api.models.SyncSimsRequest
import com.sink.app.auth.TokenManager
import com.sink.app.logging.LogFeature
import com.sink.app.logging.LogRepository
import com.sink.app.preferences.AppPreferences
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class DeviceRegistrationManager @Inject constructor(
    private val apiService: ApiService,
    private val tokenManager: TokenManager,
    private val simCardReader: SimCardReader,
    private val logRepository: LogRepository,
    private val appPreferences: AppPreferences
) {
    @Volatile
    private var isRegistering = false

    suspend fun registerDeviceAndSyncSims(): Boolean {
        if (isRegistering) {
            logRepository.debug(LogFeature.MESSAGE_SYNC, "Registration already in progress, skipping")
            return false
        }
        isRegistering = true
        return try {
            val currentFingerprint = simCardReader.computeSimFingerprint()
            val wasRegistered = appPreferences.isDeviceRegistered()
            val storedFingerprint = appPreferences.getSimFingerprint()

            // Already registered and SIMs unchanged — skip entirely
            if (wasRegistered && currentFingerprint == storedFingerprint) {
                logRepository.debug(
                    LogFeature.MESSAGE_SYNC,
                    "Device already registered, SIMs unchanged — skipping registration"
                )
                return true
            }

            // Registered but SIMs changed — only sync SIMs
            if (wasRegistered && currentFingerprint != storedFingerprint) {
                val deviceId = tokenManager.getDeviceId()
                if (deviceId != null) {
                    logRepository.info(
                        LogFeature.MESSAGE_SYNC,
                        "SIM configuration changed, syncing SIMs only"
                    )
                    val sims = simCardReader.readSimCards()
                    if (sims.isNotEmpty()) {
                        apiService.syncSims(deviceId, SyncSimsRequest(sims))
                        logRepository.info(LogFeature.MESSAGE_SYNC, "Synced ${sims.size} SIM card(s)")
                    }
                    appPreferences.setSimFingerprint(currentFingerprint)
                    return true
                }
                // No device ID stored — fall through to full registration
            }

            // Full registration flow
            val deviceName = "${Build.MANUFACTURER} ${Build.MODEL}"
            val request = RegisterDeviceRequest(
                name = deviceName,
                platform = "android",
                manufacturer = Build.MANUFACTURER,
                model = Build.MODEL,
                osVersion = "Android ${Build.VERSION.RELEASE}",
                appVersion = BuildConfig.VERSION_NAME
            )

            val response = apiService.registerDevice(request)
            val deviceId = response.data.id
            tokenManager.saveDeviceId(deviceId)

            logRepository.info(LogFeature.MESSAGE_SYNC, "Device registered: $deviceName (ID: $deviceId)")

            // Sync SIMs
            val sims = simCardReader.readSimCards()
            if (sims.isNotEmpty()) {
                apiService.syncSims(deviceId, SyncSimsRequest(sims))
                logRepository.info(LogFeature.MESSAGE_SYNC, "Synced ${sims.size} SIM card(s)")
            }

            // Persist registration state
            appPreferences.setDeviceRegistered(true)
            appPreferences.setSimFingerprint(currentFingerprint)
            true
        } catch (e: Exception) {
            logRepository.error(
                LogFeature.MESSAGE_SYNC,
                "Device registration failed: ${e.javaClass.simpleName}: ${e.message}",
                details = e.stackTraceToString().take(500)
            )
            false
        } finally {
            isRegistering = false
        }
    }
}
