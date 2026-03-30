package com.sink.app.messagesync

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.sink.app.logging.LogFeature
import com.sink.app.logging.LogRepository
import com.sink.app.messagesync.db.SmsOutboxDao
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class MessageSyncState(
    val isEnabled: Boolean = true,
    val pendingCount: Int = 0,
    val syncedCount: Int = 0,
    val isLoading: Boolean = true,
    val deviceRegistered: Boolean = false,
    val registrationError: String? = null
)

@HiltViewModel
class MessageSyncViewModel @Inject constructor(
    private val smsOutboxDao: SmsOutboxDao,
    private val deviceRegistrationManager: DeviceRegistrationManager,
    private val logRepository: LogRepository
) : ViewModel() {

    private val _state = MutableStateFlow(MessageSyncState())
    val state: StateFlow<MessageSyncState> = _state.asStateFlow()

    init {
        loadStats()
    }

    private fun loadStats() {
        viewModelScope.launch {
            _state.update { it.copy(isLoading = true) }
            try {
                val pending = smsOutboxDao.pendingCount()
                val synced = smsOutboxDao.syncedCount()
                _state.update {
                    it.copy(pendingCount = pending, syncedCount = synced, isLoading = false)
                }
            } catch (e: Exception) {
                _state.update { it.copy(isLoading = false) }
            }
        }
    }

    private fun registerDevice() {
        viewModelScope.launch {
            _state.update { it.copy(registrationError = null) }
            try {
                val success = deviceRegistrationManager.registerDeviceAndSyncSims()
                _state.update { it.copy(deviceRegistered = success, registrationError = if (!success) "Registration failed. Tap Retry." else null) }
            } catch (e: Exception) {
                logRepository.error(LogFeature.MESSAGE_SYNC, "Registration exception: ${e.message}")
                _state.update { it.copy(deviceRegistered = false, registrationError = "Registration failed: ${e.message}") }
            }
        }
    }

    fun onPermissionsGranted() {
        registerDevice()
    }

    fun refreshStats() {
        loadStats()
        // Retry device registration if it hasn't succeeded yet
        if (!_state.value.deviceRegistered) {
            registerDevice()
        }
    }
}
