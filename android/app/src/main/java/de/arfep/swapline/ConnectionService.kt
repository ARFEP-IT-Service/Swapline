// Verbindung im Hintergrund halten: Vordergrund-Dienst mit dauerhafter, stiller Benachrichtigung („Mit … verbunden“).
// Solange er läuft, bleibt die App-Prozess samt Verbindungen erhalten – Antworten und Rückfragen melden sich auch bei
// geschlossener App. An/aus in den Einstellungen („Im Hintergrund verbunden bleiben“).
package de.arfep.swapline

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import de.arfep.swapline.net.LinkState
import de.arfep.swapline.ui.tr

class ConnectionService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() { running = false; super.onDestroy() }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val app = application as SwaplineApp
        if (intent?.action == ACTION_STOP || !app.model.backgroundEnabled || app.model.hosts.isEmpty()) {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
            running = false
            stopSelf()
            return START_NOT_STICKY
        }
        val type = if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
        runCatching { ServiceCompat.startForeground(this, NOTIFY_ID, notification(this), type) }
            .onFailure { stopSelf(); return START_NOT_STICKY }
        running = true
        app.model.reconnectAll()
        return START_STICKY
    }

    companion object {
        const val CHANNEL = "connection"
        @Volatile var running = false
            private set
        const val NOTIFY_ID = 1
        private const val ACTION_STOP = "stop"

        fun createChannel(ctx: Context) {
            ctx.getSystemService(NotificationManager::class.java).createNotificationChannel(
                NotificationChannel(CHANNEL, tr("Verbindung im Hintergrund", "Background connection"), NotificationManager.IMPORTANCE_MIN).apply {
                    setShowBadge(false)
                    description = tr("Hält die Verbindung zum Haupt-PC, damit Antworten auch bei geschlossener App ankommen.", "Keeps the connection to the host PC so replies arrive while the app is closed.")
                })
        }

        fun notification(ctx: Context): Notification {
            val app = ctx.applicationContext as SwaplineApp
            val hosts = app.model.hosts
            val on = hosts.filter { it.state == LinkState.CONNECTED }
            val text = when {
                on.isNotEmpty() -> tr("Verbunden mit ", "Connected to ") + on.joinToString(", ") { it.record.name }
                else -> tr("Verbinde mit ", "Connecting to ") + hosts.joinToString(", ") { it.record.name }
            }
            val open = PendingIntent.getActivity(ctx, 0, Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE)
            return NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle("Swapline")
                .setContentText(text)
                .setOngoing(true)
                .setSilent(true)
                .setPriority(NotificationCompat.PRIORITY_MIN)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC) // enthält keine Chat-Inhalte
                .setContentIntent(open)
                .build()
        }

        // Dienst passend zur Einstellung starten oder beenden (nur aus der sichtbaren App aufrufen)
        fun sync(ctx: Context) {
            val app = ctx.applicationContext as SwaplineApp
            val i = Intent(ctx, ConnectionService::class.java)
            if (app.model.backgroundEnabled && app.model.hosts.isNotEmpty()) runCatching { ContextCompat.startForegroundService(ctx, i) }
            else runCatching { ctx.startService(i.setAction(ACTION_STOP)) }
        }

        // Text der dauerhaften Benachrichtigung aktualisieren (Verbindungsstatus)
        fun refresh(ctx: Context) {
            val app = ctx.applicationContext as SwaplineApp
            if (!running || !app.model.backgroundEnabled || app.model.hosts.isEmpty()) return
            runCatching { ctx.getSystemService(NotificationManager::class.java).notify(NOTIFY_ID, notification(ctx)) }
        }
    }
}
