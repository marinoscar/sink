package com.sink.app.messagesync

import android.Manifest
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
import com.sink.app.R

/**
 * Foreground Service that registers the SmsReceiver at runtime.
 *
 * Manifest-declared BroadcastReceivers for SMS_RECEIVED are increasingly
 * blocked by OEMs (Samsung, Xiaomi, etc.) even with correct permissions.
 * A foreground service with a runtime-registered receiver is the most
 * reliable way to capture SMS on modern Android.
 */
class SmsListenerService : Service() {

    companion object {
        private const val TAG = "SmsListenerService"
        private const val CHANNEL_ID = "sms_listener_channel"
        private const val NOTIFICATION_ID = 1001
    }

    private var smsReceiver: SmsReceiver? = null

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "Service created")
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, buildNotification())
        registerSmsReceiver()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d(TAG, "Service started")
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        Log.d(TAG, "Service destroyed")
        unregisterSmsReceiver()
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

        // On Android 13+, we must use the overload with permission + flags
        // to receive system SMS broadcasts
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(
                smsReceiver,
                filter,
                Manifest.permission.BROADCAST_SMS,
                null, // handler — use main thread
                RECEIVER_EXPORTED
            )
        } else {
            registerReceiver(smsReceiver, filter)
        }

        Log.d(TAG, "SMS receiver registered at runtime (SDK ${Build.VERSION.SDK_INT})")
    }

    private fun unregisterSmsReceiver() {
        smsReceiver?.let {
            try {
                unregisterReceiver(it)
                Log.d(TAG, "SMS receiver unregistered")
            } catch (e: Exception) {
                Log.e(TAG, "Error unregistering receiver", e)
            }
        }
        smsReceiver = null
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
