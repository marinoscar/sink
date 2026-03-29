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
            while (true) {
                delay(intervalMs)
                try {
                    val response = apiService.pollDeviceToken(DeviceTokenRequest(deviceCode))
                    if (response.isSuccessful) {
                        val data = response.body()?.data ?: continue
                        tokenManager.saveTokens(data.accessToken, data.refreshToken)
                        logRepository.info(LogFeature.DEVICE_AUTH, "Device authenticated successfully")
                        _state.update { it.copy(isAuthenticated = true) }
                        return@launch
                    }
                    // If error is not authorization_pending, stop polling
                    val errorBody = response.errorBody()?.string() ?: ""
                    if (!errorBody.contains("authorization_pending") && !errorBody.contains("slow_down")) {
                        logRepository.error(LogFeature.DEVICE_AUTH, "Polling failed: $errorBody")
                        _state.update { it.copy(error = "Authorization failed. Please try again.") }
                        return@launch
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
