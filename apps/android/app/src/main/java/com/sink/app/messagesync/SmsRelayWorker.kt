package com.sink.app.messagesync

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.sink.app.api.ApiService
import com.sink.app.api.models.RelaySmsRequest
import com.sink.app.api.models.SmsItem
import com.sink.app.auth.TokenManager
import com.sink.app.logging.LogFeature
import com.sink.app.logging.LogRepository
import com.sink.app.messagesync.db.OutboxStatus
import com.sink.app.messagesync.db.SmsOutboxDao
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import java.text.SimpleDateFormat
import java.util.*

@HiltWorker
class SmsRelayWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val apiService: ApiService,
    private val tokenManager: TokenManager,
    private val smsOutboxDao: SmsOutboxDao,
    private val logRepository: LogRepository
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val deviceId = tokenManager.getDeviceId() ?: run {
            logRepository.error(LogFeature.MESSAGE_SYNC, "No device ID found, cannot relay")
            return Result.failure()
        }

        val pending = smsOutboxDao.getPending(100)
        if (pending.isEmpty()) return Result.success()

        logRepository.info(LogFeature.MESSAGE_SYNC, "Relaying ${pending.size} message(s)...")

        val dateFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }

        val smsItems = pending.map { msg ->
            SmsItem(
                sender = msg.sender,
                body = msg.body,
                smsTimestamp = dateFormat.format(Date(msg.smsTimestamp)),
                simSubscriptionId = if (msg.subscriptionId >= 0) msg.subscriptionId else null,
                simSlotIndex = if (msg.simSlotIndex >= 0) msg.simSlotIndex else null
            )
        }

        return try {
            val response = apiService.relaySms(RelaySmsRequest(deviceId, smsItems))
            val result = response.data

            // Mark all as synced
            smsOutboxDao.updateStatus(pending.map { it.id }, OutboxStatus.SYNCED.name)

            logRepository.info(
                LogFeature.MESSAGE_SYNC,
                "Relay complete: ${result.stored} stored, ${result.duplicates} duplicates"
            )
            Result.success()
        } catch (e: Exception) {
            logRepository.error(LogFeature.MESSAGE_SYNC, "Relay failed: ${e.message}")
            Result.retry()
        }
    }
}
