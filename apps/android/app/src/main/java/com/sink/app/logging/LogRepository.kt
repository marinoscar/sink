package com.sink.app.logging

import com.sink.app.logging.db.LogDao
import com.sink.app.logging.db.LogEntity
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class LogRepository @Inject constructor(
    private val logDao: LogDao
) {
    fun getLogs(feature: LogFeature? = null): Flow<List<LogEntity>> {
        return if (feature != null) {
            logDao.getByFeature(feature.name)
        } else {
            logDao.getAll()
        }
    }

    suspend fun getLogsForExport(feature: LogFeature? = null): List<LogEntity> {
        return if (feature != null) {
            logDao.getByFeatureList(feature.name)
        } else {
            logDao.getAllList()
        }
    }

    suspend fun debug(feature: LogFeature, message: String, details: String? = null) {
        log("DEBUG", feature, message, details)
    }

    suspend fun info(feature: LogFeature, message: String, details: String? = null) {
        log("INFO", feature, message, details)
    }

    suspend fun warn(feature: LogFeature, message: String, details: String? = null) {
        log("WARN", feature, message, details)
    }

    suspend fun error(feature: LogFeature, message: String, details: String? = null) {
        log("ERROR", feature, message, details)
    }

    private suspend fun log(level: String, feature: LogFeature, message: String, details: String?) {
        logDao.insert(
            LogEntity(
                feature = feature.name,
                level = level,
                message = message,
                details = details
            )
        )
    }

    suspend fun cleanup(retentionDays: Int = 7) {
        val cutoff = System.currentTimeMillis() - (retentionDays * 24 * 60 * 60 * 1000L)
        logDao.deleteOlderThan(cutoff)
    }

    suspend fun clearAll() {
        logDao.deleteAll()
    }
}
