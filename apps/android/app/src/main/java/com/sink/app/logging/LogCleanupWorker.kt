package com.sink.app.logging

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject

@HiltWorker
class LogCleanupWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val logRepository: LogRepository
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        return try {
            logRepository.cleanup(retentionDays = 7)
            logRepository.info(LogFeature.GENERAL, "Log cleanup completed")
            Result.success()
        } catch (e: Exception) {
            Result.retry()
        }
    }
}
