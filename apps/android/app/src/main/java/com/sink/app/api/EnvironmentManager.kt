package com.sink.app.api

import com.sink.app.BuildConfig
import com.sink.app.preferences.AppPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.runBlocking
import javax.inject.Inject
import javax.inject.Singleton

enum class Environment(val key: String, val label: String, val baseUrl: String) {
    DEV("dev", "Development", "https://sink.dev.marin.cr/api"),
    PROD("prod", "Production", "https://sink.marin.cr/api");

    companion object {
        fun fromKey(key: String?): Environment = entries.find { it.key == key } ?: defaultFromBuildConfig()

        private fun defaultFromBuildConfig(): Environment {
            return when {
                BuildConfig.API_BASE_URL.contains("dev.marin.cr") -> DEV
                else -> PROD
            }
        }
    }
}

@Singleton
class EnvironmentManager @Inject constructor(
    private val appPreferences: AppPreferences
) {
    private val _currentEnvironment = MutableStateFlow(
        runBlocking { Environment.fromKey(appPreferences.getSelectedEnvironment()) }
    )
    val currentEnvironment: StateFlow<Environment> = _currentEnvironment.asStateFlow()

    fun getCurrentBaseUrl(): String = _currentEnvironment.value.baseUrl

    suspend fun switchEnvironment(env: Environment) {
        appPreferences.setSelectedEnvironment(env.key)
        _currentEnvironment.value = env
    }
}
