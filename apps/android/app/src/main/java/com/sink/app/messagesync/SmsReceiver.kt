package com.sink.app.messagesync

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.util.Log
import androidx.work.*
import com.sink.app.SinkApplication
import com.sink.app.logging.LogFeature
import com.sink.app.logging.LogRepository
import com.sink.app.messagesync.db.SmsOutboxDao
import com.sink.app.messagesync.db.SmsOutboxDatabase
import com.sink.app.messagesync.db.SmsOutboxEntity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * BroadcastReceiver for incoming SMS.
 *
 * Does NOT use @AndroidEntryPoint — Hilt injection in BroadcastReceivers is
 * fragile and can silently fail, swallowing the intent. Instead, we obtain
 * dependencies directly from the Room database singleton and application-level
 * Hilt component.
 */
class SmsReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "SmsReceiver"
    }

    override fun onReceive(context: Context, intent: Intent) {
        Log.d(TAG, "onReceive called with action: ${intent.action}")

        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) {
            Log.d(TAG, "Ignoring non-SMS intent: ${intent.action}")
            return
        }

        val messages = try {
            Telephony.Sms.Intents.getMessagesFromIntent(intent)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse SMS from intent", e)
            return
        }

        if (messages.isNullOrEmpty()) {
            Log.w(TAG, "No messages in SMS intent")
            return
        }

        Log.d(TAG, "Received ${messages.size} SMS part(s)")

        // Group message parts by sender (multi-part SMS)
        val grouped = messages.groupBy { it.originatingAddress ?: "unknown" }

        val subscriptionId = intent.getIntExtra("subscription", -1)
        val simSlotIndex = intent.getIntExtra("slot", -1)

        // Use goAsync() to extend the BroadcastReceiver lifetime for the coroutine
        val pendingResult = goAsync()

        // Get dependencies without Hilt
        val db = SmsOutboxDatabase.getInstance(context.applicationContext)
        val smsOutboxDao = db.smsOutboxDao()
        val logRepository = getLogRepository(context)

        CoroutineScope(Dispatchers.IO).launch {
            try {
                grouped.forEach { (sender, parts) ->
                    val fullBody = parts.joinToString("") { it.messageBody ?: "" }
                    val timestamp = parts.first().timestampMillis

                    smsOutboxDao.insert(
                        SmsOutboxEntity(
                            sender = sender,
                            body = fullBody,
                            smsTimestamp = timestamp,
                            subscriptionId = subscriptionId,
                            simSlotIndex = simSlotIndex
                        )
                    )

                    Log.d(TAG, "Queued SMS from $sender (${fullBody.length} chars)")
                    logRepository?.info(
                        LogFeature.MESSAGE_SYNC,
                        "SMS received from $sender (${fullBody.length} chars), queued for sync"
                    )
                }

                // Enqueue relay worker
                val workRequest = OneTimeWorkRequestBuilder<SmsRelayWorker>()
                    .setConstraints(
                        Constraints.Builder()
                            .setRequiredNetworkType(NetworkType.CONNECTED)
                            .build()
                    )
                    .setBackoffCriteria(
                        BackoffPolicy.EXPONENTIAL,
                        WorkRequest.MIN_BACKOFF_MILLIS,
                        java.util.concurrent.TimeUnit.MILLISECONDS
                    )
                    .build()

                WorkManager.getInstance(context.applicationContext)
                    .enqueueUniqueWork(
                        "sms_relay",
                        ExistingWorkPolicy.REPLACE,
                        workRequest
                    )

                Log.d(TAG, "Relay worker enqueued")
            } catch (e: Exception) {
                Log.e(TAG, "Error processing SMS", e)
                logRepository?.error(
                    LogFeature.MESSAGE_SYNC,
                    "Error processing incoming SMS: ${e.message}"
                )
            } finally {
                pendingResult.finish()
            }
        }
    }

    private fun getLogRepository(context: Context): LogRepository? {
        return try {
            val app = context.applicationContext as? SinkApplication ?: return null
            // Access Hilt's entry point for the LogRepository
            dagger.hilt.android.EntryPointAccessors.fromApplication(
                app,
                SmsReceiverEntryPoint::class.java
            ).logRepository()
        } catch (e: Exception) {
            Log.e(TAG, "Could not get LogRepository", e)
            null
        }
    }
}

@dagger.hilt.EntryPoint
@dagger.hilt.InstallIn(dagger.hilt.components.SingletonComponent::class)
interface SmsReceiverEntryPoint {
    fun logRepository(): LogRepository
}
