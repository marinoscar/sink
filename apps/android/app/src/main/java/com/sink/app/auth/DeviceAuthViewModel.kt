package com.sink.app.auth

import android.os.Build
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.sink.app.BuildConfig
import com.sink.app.api.ApiService
import com.sink.app.api.models.*
import com.sink.app.logging.LogRepository
import com.sink.app.logging.LogFeature
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

data class DeviceAuthState(
    val isLoading: Boolean = false,
    val userCode: String? = null,
    val verificationUri: String? = null,
    val verificationUriComplete: String? = null,
    val error: String? = null,
    val isAuthenticated: Boolean = false,
    val pollInterval: Long = 5000L
)

@HiltViewModel
class DeviceAuthViewModel @Inject constructor(
    private val apiService: ApiService,
    private val tokenManager: TokenManager,
    private val logRepository: LogRepository
) : ViewModel() {

    private val _state = MutableStateFlow(DeviceAuthState())
    val state: StateFlow<DeviceAuthState> = _state.asStateFlow()

    init {
        checkExistingAuth()
    }

    private fun checkExistingAuth() {
        viewModelScope.launch {
            tokenManager.isLoggedIn.collect { loggedIn ->
                if (loggedIn) {
                    _state.update { it.copy(isAuthenticated = true) }
                }
            }
        }
    }

    fun requestDeviceCode() {
        viewModelScope.launch {
            _state.update { it.copy(isLoading = true, error = null) }
            try {
                val clientInfo = ClientInfo(
                    deviceName = "${Build.MANUFACTURER} ${Build.MODEL}",
                    manufacturer = Build.MANUFACTURER,
                    model = Build.MODEL,
                    osVersion = "Android ${Build.VERSION.RELEASE}",
                    appVersion = BuildConfig.VERSION_NAME
                )
                val response = apiService.requestDeviceCode(DeviceCodeRequest(clientInfo))
                val data = response.data

                logRepository.info(LogFeature.DEVICE_AUTH, "Device code requested: ${data.userCode}")

                _state.update {
                    it.copy(
                        isLoading = false,
                        userCode = data.userCode,
                        verificationUri = data.verificationUri,
                        verificationUriComplete = data.verificationUriComplete,
                        pollInterval = data.interval * 1000L
                    )
                }

                startPolling(data.deviceCode, data.interval * 1000L)
            } catch (e: Exception) {
                logRepository.error(LogFeature.DEVICE_AUTH, "Failed to request device code: ${e.message}")
                _state.update {
                    it.copy(isLoading = false, error = "Failed to connect. Check your network.")
                }
            }
        }
    }

    private fun startPolling(deviceCode: String, intervalMs: Long) {
        viewModelScope.launch {
            var currentInterval = intervalMs
            while (true) {
                delay(currentInterval)
                try {
                    val response = apiService.pollDeviceToken(DeviceTokenRequest(deviceCode))
                    if (response.isSuccessful) {
                        val data = response.body()?.data ?: continue
                        tokenManager.saveTokens(data.accessToken, data.refreshToken)
                        logRepository.info(LogFeature.DEVICE_AUTH, "Device authenticated successfully")
                        _state.update { it.copy(isAuthenticated = true) }
                        return@launch
                    }

                    val errorBody = response.errorBody()?.string() ?: ""
                    logRepository.debug(LogFeature.DEVICE_AUTH, "Poll response ${response.code()}: $errorBody")

                    // Only stop polling on terminal errors
                    when {
                        // Keep polling - user hasn't acted yet
                        errorBody.contains("authorization_pending") -> { /* continue */ }

                        // Slow down - increase interval by 5s per RFC 8628
                        errorBody.contains("slow_down") -> {
                            currentInterval += 5000L
                            logRepository.info(LogFeature.DEVICE_AUTH, "Slowing down, interval now ${currentInterval}ms")
                        }

                        // Terminal: user denied
                        errorBody.contains("access_denied") -> {
                            logRepository.error(LogFeature.DEVICE_AUTH, "User denied authorization")
                            _state.update { it.copy(error = "Authorization was denied. Please try again.") }
                            return@launch
                        }

                        // Terminal: code expired
                        errorBody.contains("expired_token") -> {
                            logRepository.error(LogFeature.DEVICE_AUTH, "Device code expired")
                            _state.update { it.copy(
                                userCode = null,
                                verificationUri = null,
                                verificationUriComplete = null,
                                error = "Code expired. Please try again."
                            ) }
                            return@launch
                        }

                        // Non-terminal: any other error (possibly server issue, keep trying)
                        else -> {
                            logRepository.warn(LogFeature.DEVICE_AUTH, "Unexpected poll response: $errorBody")
                            // Keep polling - server may be temporarily returning unexpected format
                        }
                    }
                } catch (e: Exception) {
                    logRepository.error(LogFeature.DEVICE_AUTH, "Polling error: ${e.message}")
                    // Continue polling on network errors
                }
            }
        }
    }

    fun logout() {
        viewModelScope.launch {
            tokenManager.clearTokens()
            _state.update { DeviceAuthState() }
            logRepository.info(LogFeature.DEVICE_AUTH, "User logged out")
        }
    }
}
