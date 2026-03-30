package com.sink.app.messagesync

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.IBinder
import android.provider.Telephony
import android.util.Log
import androidx.core.app.NotificationCompat
import com.sink.app.logging.LogFeature
import com.sink.app.logging.LogRepository
import com.sink.app.messagesync.db.SmsOutboxDatabase
import dagger.hilt.android.EntryPointAccessors
import com.sink.app.SinkApplication

/**
 * Foreground Service that captures incoming SMS using two strategies:
 *
 * 1. BroadcastReceiver (SMS_RECEIVED) — works on Android < 16 and some OEMs
 * 2. ContentObserver (content://sms) — works on Android 16+ (SDK 36) where
 *    SMS_RECEIVED broadcasts are no longer delivered to non-default SMS apps
 *
 * Both are registered simultaneously; the outbox deduplication ensures no
 * double-processing.
 */
class SmsListenerService : Service() {

    companion object {
        private const val TAG = "SmsListenerService"
        private const val CHANNEL_ID = "sms_listener_channel"
        private const val NOTIFICATION_ID = 1001
    }

    private var smsReceiver: SmsReceiver? = null
    private var smsContentObserver: SmsContentObserver? = null

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "Service created (SDK ${Build.VERSION.SDK_INT})")
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, buildNotification())

        val logRepository = getLogRepository()

        // Strategy 1: BroadcastReceiver (may not work on Android 16+)
        registerSmsReceiver()

        // Strategy 2: ContentObserver (reliable on all versions)
        registerContentObserver(logRepository)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d(TAG, "Service started")
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        Log.d(TAG, "Service destroyed")
        unregisterSmsReceiver()
        unregisterContentObserver()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun registerSmsReceiver() {
        if (smsReceiver != null) return

        smsReceiver = SmsReceiver()
        val filter = IntentFilter().apply {
            addAction(Telephony.Sms.Intents.SMS_RECEIVED_ACTION)
            addAction("android.provider.Telephony.SMS_RECEIVED")
            priority = 999
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(smsReceiver, filter, RECEIVER_EXPORTED)
        } else {
            registerReceiver(smsReceiver, filter)
        }

        Log.d(TAG, "SMS broadcast receiver registered")
    }

    private fun registerContentObserver(logRepository: LogRepository?) {
        if (smsContentObserver != null) return

        val db = SmsOutboxDatabase.getInstance(applicationContext)
        smsContentObserver = SmsContentObserver(
            context = applicationContext,
            logRepository = logRepository,
            blockedSenderDao = db.blockedSenderDao(),
            knownSenderDao = db.knownSenderDao()
        )
        smsContentObserver?.register()
        Log.d(TAG, "SMS content observer registered")
    }

    private fun unregisterSmsReceiver() {
        smsReceiver?.let {
            try {
                unregisterReceiver(it)
                Log.d(TAG, "SMS broadcast receiver unregistered")
            } catch (e: Exception) {
                Log.e(TAG, "Error unregistering receiver", e)
            }
        }
        smsReceiver = null
    }

    private fun unregisterContentObserver() {
        smsContentObserver?.unregister()
        smsContentObserver = null
        Log.d(TAG, "SMS content observer unregistered")
    }

    private fun getLogRepository(): LogRepository? {
        return try {
            val app = applicationContext as? SinkApplication ?: return null
            EntryPointAccessors.fromApplication(
                app,
                SmsReceiverEntryPoint::class.java
            ).logRepository()
        } catch (e: Exception) {
            Log.e(TAG, "Could not get LogRepository", e)
            null
        }
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Message Sync",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Keeps SMS sync running in the background"
            setShowBadge(false)
        }

        val notificationManager = getSystemService(NotificationManager::class.java)
        notificationManager.createNotificationChannel(channel)
    }

    private fun buildNotification(): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Message Sync")
            .setContentText("Listening for incoming SMS")
            .setSmallIcon(android.R.drawable.ic_dialog_email)
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }
}
