package com.sink.app.logging

import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.sink.app.logging.db.LogEntity
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import java.io.File
import java.text.SimpleDateFormat
import java.util.*
import javax.inject.Inject

data class LogsState(
    val logs: List<LogEntity> = emptyList(),
    val selectedFeature: LogFeature? = null,
    val selectedLevel: String? = null,
    val isExporting: Boolean = false
)

@HiltViewModel
class LogsViewModel @Inject constructor(
    private val logRepository: LogRepository,
    @ApplicationContext private val context: Context
) : ViewModel() {

    private val _state = MutableStateFlow(LogsState())
    val state: StateFlow<LogsState> = _state.asStateFlow()

    init {
        observeLogs()
    }

    private fun observeLogs() {
        viewModelScope.launch {
            combine(
                _state.map { it.selectedFeature }.distinctUntilChanged(),
                _state.map { it.selectedLevel }.distinctUntilChanged()
            ) { feature, level -> Pair(feature, level) }
                .flatMapLatest { (feature, level) ->
                    logRepository.getLogs(feature).map { logs ->
                        if (level != null) logs.filter { it.level == level } else logs
                    }
                }
                .collect { logs ->
                    _state.update { it.copy(logs = logs) }
                }
        }
    }

    fun setFeatureFilter(feature: LogFeature?) {
        _state.update { it.copy(selectedFeature = feature) }
    }

    fun setLevelFilter(level: String?) {
        _state.update { it.copy(selectedLevel = level) }
    }

    fun exportLogs(): Intent? {
        _state.update { it.copy(isExporting = true) }
        return try {
            val logs = _state.value.logs
            val dateFormat = SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US)
            val content = buildString {
                appendLine("Sink App Logs - Exported ${dateFormat.format(Date())}")
                appendLine("Feature filter: ${_state.value.selectedFeature?.displayName ?: "All"}")
                appendLine("Level filter: ${_state.value.selectedLevel ?: "All"}")
                appendLine("=".repeat(80))
                appendLine()
                logs.forEach { log ->
                    appendLine("[${dateFormat.format(Date(log.timestamp))}] [${log.level}] [${log.feature}] ${log.message}")
                    if (log.details != null) {
                        appendLine("  Details: ${log.details}")
                    }
                }
            }

            val fileName = "sink_logs_${SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())}.txt"
            val file = File(context.cacheDir, fileName)
            file.writeText(content)

            val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
            Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_STREAM, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }.also {
                _state.update { it.copy(isExporting = false) }
            }
        } catch (e: Exception) {
            _state.update { it.copy(isExporting = false) }
            null
        }
    }

    fun clearLogs() {
        viewModelScope.launch {
            logRepository.clearAll()
        }
    }
}
