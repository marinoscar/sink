package com.sink.app.messagesync

import android.content.Context
import android.database.ContentObserver
import android.database.Cursor
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.Telephony
import android.util.Log
import androidx.work.*
import com.sink.app.messagesync.db.SmsOutboxDao
import com.sink.app.messagesync.db.SmsOutboxDatabase
import com.sink.app.messagesync.db.SmsOutboxEntity
import com.sink.app.logging.LogFeature
import com.sink.app.logging.LogRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Observes the SMS content provider for new incoming messages.
 *
 * On Android 16+ (SDK 36), the SMS_RECEIVED broadcast is no longer delivered
 * to non-default SMS apps. Instead, we monitor content://sms/inbox for new
 * entries using a ContentObserver. This approach works on all Android versions.
 */
class SmsContentObserver(
    private val context: Context,
    private val logRepository: LogRepository?,
    handler: Handler = Handler(Looper.getMainLooper())
) : ContentObserver(handler) {

    companion object {
        private const val TAG = "SmsContentObserver"
        private val SMS_INBOX_URI: Uri = Uri.parse("content://sms/inbox")
    }

    // Track the last SMS ID we've seen to avoid processing duplicates
    private var lastProcessedId: Long = -1L

    init {
        // Initialize with the current latest SMS ID so we don't process old messages
        lastProcessedId = getLatestSmsId()
        Log.d(TAG, "Initialized with lastProcessedId=$lastProcessedId")
    }

    override fun onChange(selfChange: Boolean) {
        onChange(selfChange, null)
    }

    override fun onChange(selfChange: Boolean, uri: Uri?) {
        Log.d(TAG, "SMS content changed, uri=$uri selfChange=$selfChange")
        processNewMessages()
    }

    private fun processNewMessages() {
        val db = SmsOutboxDatabase.getInstance(context)
        val smsOutboxDao = db.smsOutboxDao()

        CoroutineScope(Dispatchers.IO).launch {
            try {
                val newMessages = queryNewMessages()
                if (newMessages.isEmpty()) {
                    Log.d(TAG, "No new messages found")
                    return@launch
                }

                Log.d(TAG, "Found ${newMessages.size} new message(s)")

                for (msg in newMessages) {
                    smsOutboxDao.insert(msg)
                    Log.d(TAG, "Queued SMS from ${msg.sender} (${msg.body.length} chars)")
                    logRepository?.info(
                        LogFeature.MESSAGE_SYNC,
                        "SMS received from ${msg.sender} (${msg.body.length} chars), queued for sync"
                    )
                }

                // Update last processed ID
                lastProcessedId = newMessages.maxOf { it.smsTimestamp }

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

                Log.d(TAG, "Relay worker enqueued for ${newMessages.size} message(s)")
            } catch (e: Exception) {
                Log.e(TAG, "Error processing new messages", e)
                logRepository?.error(
                    LogFeature.MESSAGE_SYNC,
                    "Error processing incoming SMS: ${e.message}"
                )
            }
        }
    }

    private fun queryNewMessages(): List<SmsOutboxEntity> {
        val messages = mutableListOf<SmsOutboxEntity>()

        val cursor: Cursor? = try {
            context.contentResolver.query(
                SMS_INBOX_URI,
                arrayOf(
                    Telephony.Sms._ID,
                    Telephony.Sms.ADDRESS,
                    Telephony.Sms.BODY,
                    Telephony.Sms.DATE,
                    Telephony.Sms.SUBSCRIPTION_ID
                ),
                "${Telephony.Sms._ID} > ?",
                arrayOf(lastProcessedId.toString()),
                "${Telephony.Sms._ID} ASC"
            )
        } catch (e: SecurityException) {
            Log.e(TAG, "No permission to read SMS", e)
            logRepository?.let {
                CoroutineScope(Dispatchers.IO).launch {
                    it.error(LogFeature.MESSAGE_SYNC, "No permission to read SMS content provider")
                }
            }
            null
        }

        cursor?.use {
            val idIdx = it.getColumnIndexOrThrow(Telephony.Sms._ID)
            val addressIdx = it.getColumnIndexOrThrow(Telephony.Sms.ADDRESS)
            val bodyIdx = it.getColumnIndexOrThrow(Telephony.Sms.BODY)
            val dateIdx = it.getColumnIndexOrThrow(Telephony.Sms.DATE)
            val subIdIdx = it.getColumnIndexOrThrow(Telephony.Sms.SUBSCRIPTION_ID)

            while (it.moveToNext()) {
                val id = it.getLong(idIdx)
                val address = it.getString(addressIdx) ?: "unknown"
                val body = it.getString(bodyIdx) ?: ""
                val date = it.getLong(dateIdx)
                val subscriptionId = it.getInt(subIdIdx)

                messages.add(
                    SmsOutboxEntity(
                        sender = address,
                        body = body,
                        smsTimestamp = date,
                        subscriptionId = subscriptionId,
                        simSlotIndex = -1
                    )
                )

                // Update tracking ID
                if (id > lastProcessedId) {
                    lastProcessedId = id
                }
            }
        }

        return messages
    }

    private fun getLatestSmsId(): Long {
        val cursor: Cursor? = try {
            context.contentResolver.query(
                SMS_INBOX_URI,
                arrayOf(Telephony.Sms._ID),
                null,
                null,
                "${Telephony.Sms._ID} DESC LIMIT 1"
            )
        } catch (e: Exception) {
            Log.e(TAG, "Could not query latest SMS ID", e)
            null
        }

        return cursor?.use {
            if (it.moveToFirst()) it.getLong(0) else 0L
        } ?: 0L
    }

    fun register() {
        context.contentResolver.registerContentObserver(
            Uri.parse("content://sms"),
            true, // notifyForDescendants
            this
        )
        Log.d(TAG, "Content observer registered for content://sms")
    }

    fun unregister() {
        context.contentResolver.unregisterContentObserver(this)
        Log.d(TAG, "Content observer unregistered")
    }
}
