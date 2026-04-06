package com.sink.app.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.sink.app.BuildConfig
import com.sink.app.api.Environment
import com.sink.app.api.EnvironmentManager
import com.sink.app.auth.TokenManager
import com.sink.app.logging.db.LogDatabase
import com.sink.app.messagesync.db.SmsOutboxDatabase
import com.sink.app.preferences.AppPreferences
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import javax.inject.Inject

data class SettingsState(
    val serverUrl: String = BuildConfig.API_BASE_URL,
    val appVersion: String = BuildConfig.VERSION_NAME,
    val deviceId: String? = null,
    val currentEnvironment: Environment = Environment.PROD
)

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val tokenManager: TokenManager,
    private val smsOutboxDatabase: SmsOutboxDatabase,
    private val logDatabase: LogDatabase,
    private val appPreferences: AppPreferences,
    private val environmentManager: EnvironmentManager
) : ViewModel() {

    private val _state = MutableStateFlow(SettingsState())
    val state: StateFlow<SettingsState> = _state.asStateFlow()

    init {
        loadSettings()
    }

    private fun loadSettings() {
        viewModelScope.launch {
            val deviceId = tokenManager.getDeviceId()
            val env = environmentManager.currentEnvironment.value
            _state.value = SettingsState(
                serverUrl = env.baseUrl,
                deviceId = deviceId,
                currentEnvironment = env
            )
        }
    }

    fun switchEnvironment(env: Environment) {
        viewModelScope.launch {
            environmentManager.switchEnvironment(env)
            appPreferences.clearDeviceRegistration()
            _state.update { it.copy(currentEnvironment = env, serverUrl = env.baseUrl) }
            tokenManager.clearTokens()
        }
    }

    fun logout() {
        viewModelScope.launch {
            withContext(Dispatchers.IO) {
                smsOutboxDatabase.clearAllTables()
                logDatabase.clearAllTables()
                appPreferences.clearAll()
            }
            tokenManager.clearTokens()
        }
    }
}
