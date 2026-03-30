package com.sink.app.messagesync

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.work.*
import com.sink.app.messagesync.db.SmsOutboxDatabase
import com.sink.app.messagesync.db.SmsOutboxEntity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.util.concurrent.TimeUnit

/**
 * Captures RCS messages by listening to notifications from Google Messages.
 *
 * This service runs independently from the existing SMS capture pipeline
 * (SmsReceiver + SmsContentObserver). It implements a 3-layer deduplication
 * strategy to prevent double-counting messages that arrive via both SMS and
 * notification:
 *
 * Layer 1: Check if the sender recently sent an SMS (phone number match in sms_outbox)
 * Layer 2: Track processed notification IDs in memory to skip re-posted notifications
 * Layer 3: Server-side hash-based dedup with messageType in the hash (final safety net)
 *
 * Users must grant Notification Access in Settings > Apps > Special app access >
 * Notification access for this service to receive callbacks.
 */
class RcsNotificationListener : NotificationListenerService() {

    companion object {
        private const val TAG = "RcsNotifListener"
        private const val GOOGLE_MESSAGES_PACKAGE = "com.google.android.apps.messaging"
        private const val DEDUP_WINDOW_MS = 120_000L // ±120 seconds
        private const val MAX_PROCESSED_IDS = 5_000
    }

    private val serviceScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val processedNotificationKeys = mutableSetOf<String>()

    // Lazy-init database access (no Hilt in NotificationListenerService)
    private val database: SmsOutboxDatabase by lazy {
        SmsOutboxDatabase.getInstance(applicationContext)
    }
    private val smsOutboxDao by lazy { database.smsOutboxDao() }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        // 1. Filter: only Google Messages
        if (sbn.packageName != GOOGLE_MESSAGES_PACKAGE) return

        // 2. Skip group summary notifications
        if (sbn.notification.flags and Notification.FLAG_GROUP_SUMMARY != 0) return

        // 3. Layer 2 dedup: skip already-processed notification IDs
        val notifKey = "${sbn.id}:${sbn.postTime}"
        synchronized(processedNotificationKeys) {
            if (!processedNotificationKeys.add(notifKey)) return
            // Prune if too large
            if (processedNotificationKeys.size > MAX_PROCESSED_IDS) {
                processedNotificationKeys.clear()
            }
        }

        // 4. Extract message content from notification
        val messageContent = extractMessageContent(sbn)
        if (messageContent == null) {
            Log.d(TAG, "Could not extract message content from notification ${sbn.id}")
            return
        }
        val (sender, body) = messageContent

        // 5. Process asynchronously (DB access required for dedup)
        serviceScope.launch {
            try {
                processMessage(sender, body, sbn.postTime)
            } catch (e: Exception) {
                Log.e(TAG, "Error processing notification from $sender", e)
            }
        }
    }

    private suspend fun processMessage(sender: String, body: String, postTime: Long) {
        // Layer 1 dedup: check if this sender recently sent an SMS
        val normalizedSender = PhoneNumberNormalizer.normalize(sender)

        if (PhoneNumberNormalizer.isPhoneNumber(sender)) {
            val windowStart = postTime - DEDUP_WINDOW_MS
            val windowEnd = postTime + DEDUP_WINDOW_MS
            val existingSms = smsOutboxDao.findSmsBySenderInWindow(
                normalizedSender, windowStart, windowEnd
            )
            if (existingSms != null) {
                Log.d(TAG, "Skipping notification from $sender — SMS already captured")
                return
            }
        }

        // Queue as RCS message
        smsOutboxDao.insert(
            SmsOutboxEntity(
                sender = sender,
                body = body,
                smsTimestamp = postTime,
                messageType = "rcs",
                subscriptionId = -1,
                simSlotIndex = -1
            )
        )

        Log.d(TAG, "Queued RCS message from $sender (${body.length} chars)")

        // Trigger relay worker
        enqueueRelayWorker()
    }

    /**
     * Extract sender and message body from a Google Messages notification.
     * Tries MessagingStyle first (most structured), then falls back to extras.
     */
    private fun extractMessageContent(sbn: StatusBarNotification): Pair<String, String>? {
        val notification = sbn.notification
        val extras = notification.extras

        // Try MessagingStyle first (structured conversation data)
        try {
            val messagingStyle = NotificationCompat.MessagingStyle
                .extractMessagingStyleFromNotification(notification)
            if (messagingStyle != null) {
                val lastMessage = messagingStyle.messages.lastOrNull()
                if (lastMessage != null) {
                    val sender = lastMessage.person?.name?.toString()
                        ?: extras.getString(Notification.EXTRA_TITLE)
                        ?: return null
                    val body = lastMessage.text?.toString() ?: return null
                    if (body.isNotBlank()) return sender to body
                }
            }
        } catch (e: Exception) {
            Log.d(TAG, "MessagingStyle extraction failed, trying extras", e)
        }

        // Fallback: extract from notification extras
        val sender = extras.getString(Notification.EXTRA_TITLE) ?: return null
        val body = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()
            ?: extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()
            ?: return null

        if (body.isBlank()) return null
        return sender to body
    }

    private fun enqueueRelayWorker() {
        val workRequest = OneTimeWorkRequestBuilder<SmsRelayWorker>()
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build()
            )
            .setBackoffCriteria(
                BackoffPolicy.EXPONENTIAL,
                WorkRequest.MIN_BACKOFF_MILLIS,
                TimeUnit.MILLISECONDS
            )
            .build()

        WorkManager.getInstance(applicationContext)
            .enqueueUniqueWork(
                "sms_relay",
                ExistingWorkPolicy.REPLACE,
                workRequest
            )
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification) {
        // Required override — no action needed
    }
}
