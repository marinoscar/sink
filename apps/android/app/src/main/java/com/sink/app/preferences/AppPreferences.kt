package com.sink.app.preferences

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

private val Context.dataStore by preferencesDataStore(name = "app_preferences")

@Singleton
class AppPreferences @Inject constructor(
    @ApplicationContext private val context: Context
) {
    companion object {
        private val SELECTED_ENVIRONMENT = stringPreferencesKey("selected_environment")
        private val DEVICE_REGISTERED = booleanPreferencesKey("device_registered")
        private val SIM_FINGERPRINT = stringPreferencesKey("registered_sim_fingerprint")
        private val RELAY_PAUSED = booleanPreferencesKey("relay_paused")
    }

    // --- Environment ---

    val selectedEnvironment: Flow<String?> = context.dataStore.data.map { it[SELECTED_ENVIRONMENT] }

    suspend fun getSelectedEnvironment(): String? =
        context.dataStore.data.first()[SELECTED_ENVIRONMENT]

    suspend fun setSelectedEnvironment(env: String) {
        context.dataStore.edit { it[SELECTED_ENVIRONMENT] = env }
    }

    // --- Device Registration ---

    suspend fun isDeviceRegistered(): Boolean =
        context.dataStore.data.first()[DEVICE_REGISTERED] ?: false

    suspend fun setDeviceRegistered(registered: Boolean) {
        context.dataStore.edit { it[DEVICE_REGISTERED] = registered }
    }

    suspend fun getSimFingerprint(): String? =
        context.dataStore.data.first()[SIM_FINGERPRINT]

    suspend fun setSimFingerprint(fingerprint: String) {
        context.dataStore.edit { it[SIM_FINGERPRINT] = fingerprint }
    }

    suspend fun clearDeviceRegistration() {
        context.dataStore.edit {
            it.remove(DEVICE_REGISTERED)
            it.remove(SIM_FINGERPRINT)
        }
    }

    // --- Relay Pause ---

    val relayPaused: Flow<Boolean> = context.dataStore.data.map { it[RELAY_PAUSED] ?: false }

    suspend fun isRelayPaused(): Boolean =
        context.dataStore.data.first()[RELAY_PAUSED] ?: false

    suspend fun setRelayPaused(paused: Boolean) {
        context.dataStore.edit { it[RELAY_PAUSED] = paused }
    }

    // --- Reset ---

    suspend fun clearAll() {
        context.dataStore.edit { it.clear() }
    }
}
