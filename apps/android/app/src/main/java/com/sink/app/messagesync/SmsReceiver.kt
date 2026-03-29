package com.sink.app.messagesync

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import androidx.work.*
import com.sink.app.messagesync.db.SmsOutboxDao
import com.sink.app.messagesync.db.SmsOutboxEntity
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import javax.inject.Inject

@AndroidEntryPoint
class SmsReceiver : BroadcastReceiver() {

    @Inject
    lateinit var smsOutboxDao: SmsOutboxDao

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return

        val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
        if (messages.isNullOrEmpty()) return

        // Group message parts by sender (multi-part SMS)
        val grouped = messages.groupBy { it.originatingAddress ?: "unknown" }

        val subscriptionId = intent.getIntExtra("subscription", -1)
        val simSlotIndex = intent.getIntExtra("slot", -1)

        CoroutineScope(Dispatchers.IO).launch {
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

            WorkManager.getInstance(context)
                .enqueueUniqueWork(
                    "sms_relay",
                    ExistingWorkPolicy.REPLACE,
                    workRequest
                )
        }
    }
}
