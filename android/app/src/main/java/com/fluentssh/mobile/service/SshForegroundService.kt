package com.fluentssh.mobile.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.fluentssh.mobile.MainActivity
import com.fluentssh.mobile.R

/**
 * Keeps SSH sessions and tunnels alive while the UI is backgrounded. The
 * notification is informational only (no clickable actions) and is removed as
 * soon as the last session/tunnel stops.
 */
class SshForegroundService : Service() {

    override fun onCreate() {
        super.onCreate()
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val sessions = intent?.getIntExtra(EXTRA_SESSIONS, 0) ?: 0
        val tunnels = intent?.getIntExtra(EXTRA_TUNNELS, 0) ?: 0
        startForeground(NOTIFICATION_ID, buildNotification(sessions, tunnels))
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createChannel() {
        val manager = getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL_ID) == null) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, getString(R.string.notification_channel_sessions), NotificationManager.IMPORTANCE_LOW)
                    .apply { setShowBadge(false) },
            )
        }
    }

    private fun buildNotification(sessions: Int, tunnels: Int): Notification {
        val intent = Intent(this, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        val pending = PendingIntent.getActivity(
            this,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_ssh)
            .setContentTitle(getString(R.string.notification_running_title))
            .setContentText(getString(R.string.notification_running_text, sessions, tunnels))
            .setContentIntent(pending)
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
    }

    companion object {
        private const val CHANNEL_ID = "ssh_sessions"
        private const val NOTIFICATION_ID = 4102
        private const val EXTRA_SESSIONS = "sessions"
        private const val EXTRA_TUNNELS = "tunnels"

        fun update(context: Context, sessions: Int, tunnels: Int) {
            val total = sessions + tunnels
            val intent = Intent(context, SshForegroundService::class.java)
                .putExtra(EXTRA_SESSIONS, sessions)
                .putExtra(EXTRA_TUNNELS, tunnels)
            if (total > 0) {
                runCatching { ContextCompat.startForegroundService(context, intent) }
            } else {
                runCatching { context.stopService(Intent(context, SshForegroundService::class.java)) }
            }
        }
    }
}
