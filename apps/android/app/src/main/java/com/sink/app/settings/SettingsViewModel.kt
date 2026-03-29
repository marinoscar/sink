package com.sink.app.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.sink.app.BuildConfig
import com.sink.app.auth.TokenManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class SettingsState(
    val serverUrl: String = BuildConfig.API_BASE_URL,
    val appVersion: String = BuildConfig.VERSION_NAME,
    val deviceId: String? = null
)

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val tokenManager: TokenManager
) : ViewModel() {

    private val _state = MutableStateFlow(SettingsState())
    val state: StateFlow<SettingsState> = _state.asStateFlow()

    init {
        loadSettings()
    }

    private fun loadSettings() {
        viewModelScope.launch {
            val deviceId = tokenManager.getDeviceId()
            _state.value = SettingsState(deviceId = deviceId)
        }
    }

    fun logout() {
        viewModelScope.launch {
            tokenManager.clearTokens()
        }
    }
}
