package de.arfep.swapline

import android.Manifest
import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import de.arfep.swapline.model.AppModel
import de.arfep.swapline.model.Chat
import de.arfep.swapline.model.HostState
import de.arfep.swapline.model.Notice
import de.arfep.swapline.model.ActKind
import de.arfep.swapline.model.Activity
import de.arfep.swapline.model.Notifier
import de.arfep.swapline.ui.tr

class SwaplineApp : Application() {
    lateinit var model: AppModel
        private set

    override fun onCreate() {
        super.onCreate()
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, tr("Antworten und Rückfragen", "Replies and requests"), NotificationManager.IMPORTANCE_HIGH))
        ConnectionService.createChannel(this)
        nm.createNotificationChannel(NotificationChannel(LIVE_CHANNEL, tr("Live-Status (Claude arbeitet)", "Live status (Claude working)"), NotificationManager.IMPORTANCE_LOW).apply {
            setShowBadge(false)
            description = tr("Zeigt, was Claude gerade tut, solange eine Antwort läuft.", "Shows what Claude is doing while a reply is in progress.")
        })
        model = AppModel(this, AndroidNotifier())
        watchNetwork()
    }

    // Netzwechsel: Verbindungen sofort über das neue Netz aufbauen (statt auf Zeitüberschreitung zu warten)
    private fun watchNetwork() {
        val cm = getSystemService(android.net.ConnectivityManager::class.java) ?: return
        var last: android.net.Network? = null
        runCatching {
            cm.registerDefaultNetworkCallback(object : android.net.ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: android.net.Network) {
                    val switched = last != null && last != network
                    last = network
                    if (switched) android.os.Handler(mainLooper).post { model.networkChanged() }
                }
            })
        }
    }

    // Benachrichtigung bei fertiger Antwort oder Rückfrage, wenn der Chat gerade nicht sichtbar ist
    private inner class AndroidNotifier : Notifier {
        override fun notify(chat: Chat, host: HostState, notice: Notice) {
            if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this@SwaplineApp, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
            val text = when (notice) {
                Notice.DONE -> chat.preview.ifBlank { tr("Antwort ist fertig", "Reply is ready") }
                Notice.ERROR -> tr("Fehler im Chat", "Error in chat")
                Notice.PERMISSION -> tr("Claude braucht deine Erlaubnis", "Claude needs your permission")
                Notice.QUESTION -> tr("Claude hat eine Frage", "Claude has a question")
                Notice.PLAN -> tr("Claude hat einen Plan vorgelegt", "Claude presented a plan")
            }
            val open = Intent(this@SwaplineApp, MainActivity::class.java).putExtra(MainActivity.EXTRA_CHAT, chat.id)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            val pi = PendingIntent.getActivity(this@SwaplineApp, chat.id.hashCode(), open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val n = NotificationCompat.Builder(this@SwaplineApp, CHANNEL)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(chat.title.ifBlank { host.record.name })
                .setContentText(text)
                .setSubText(host.record.name)
                .setStyle(NotificationCompat.BigTextStyle().bigText(text))
                .setContentIntent(pi)
                .setAutoCancel(true)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                // Sperrbildschirm: ohne Chat-Inhalt
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setPublicVersion(NotificationCompat.Builder(this@SwaplineApp, CHANNEL).setSmallIcon(R.drawable.ic_notification)
                    .setContentTitle("Swapline").setContentText(tr("Neue Nachricht von Claude", "New message from Claude")).build())
                .build()
            runCatching { NotificationManagerCompat.from(this@SwaplineApp).notify(chat.id.hashCode(), n) }
        }

        override fun status() = ConnectionService.refresh(this@SwaplineApp)

        // Live-Status je Chat: was Claude gerade tut, still, mit Laufzeit; als „Live Update“ angefragt (Android 16+:
        // Feld in der Statusleiste). Höchstens ein Update pro Sekunde je Chat, der jeweils letzte Stand kommt immer an.
        private val liveShown = HashMap<String, String>()
        private val liveAt = HashMap<String, Long>()
        private val livePending = HashSet<String>()
        private val handler = android.os.Handler(android.os.Looper.getMainLooper())

        override fun live(chat: Chat, host: HostState, show: Boolean) {
            val nm = NotificationManagerCompat.from(this@SwaplineApp)
            val id = ("live:" + chat.id).hashCode()
            if (!show) { if (liveShown.remove(chat.id) != null) nm.cancel(id); return }
            if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this@SwaplineApp, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
            val a = chat.activity
            val text = liveText(a)
            if (liveShown[chat.id] == text) return
            val now = android.os.SystemClock.elapsedRealtime()
            val wait = 1000 - (now - (liveAt[chat.id] ?: 0L))
            if (wait > 0 && a.kind != ActKind.WAITING) {
                if (livePending.add(chat.id)) handler.postDelayed({ livePending.remove(chat.id); model.updateLive(chat) }, wait)
                return
            }
            liveAt[chat.id] = now
            liveShown[chat.id] = text
            val waiting = a.kind == ActKind.WAITING
            val open = Intent(this@SwaplineApp, MainActivity::class.java).putExtra(MainActivity.EXTRA_CHAT, chat.id)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            val pi = PendingIntent.getActivity(this@SwaplineApp, id, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val n = NotificationCompat.Builder(this@SwaplineApp, LIVE_CHANNEL)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(chat.title.ifBlank { tr("Chat", "Chat") })
                .setContentText(text)
                .setSubText(host.record.name)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setSilent(true)
                .setWhen(chat.activeSince.takeIf { it > 0 } ?: System.currentTimeMillis()) // Laufzeit seit Beginn der Antwort
                .setUsesChronometer(true)
                .setShowWhen(true)
                .setProgress(0, 0, !waiting)
                .setCategory(if (waiting) NotificationCompat.CATEGORY_REMINDER else NotificationCompat.CATEGORY_PROGRESS)
                .setContentIntent(pi)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setPublicVersion(NotificationCompat.Builder(this@SwaplineApp, LIVE_CHANNEL).setSmallIcon(R.drawable.ic_notification)
                    .setContentTitle("Swapline").setContentText(if (waiting) tr("Claude wartet auf dich", "Claude is waiting for you") else tr("Claude arbeitet …", "Claude is working …")).build())
                .setRequestPromotedOngoing(true)
                .setShortCriticalText(if (waiting) tr("Wartet", "Waiting") else "Claude")
                .build()
            runCatching { nm.notify(id, n) }
        }

        override fun clear(chat: Chat) = NotificationManagerCompat.from(this@SwaplineApp).cancel(chat.id.hashCode())
    }

    companion object {
        const val CHANNEL = "chats"
        const val LIVE_CHANNEL = "live"

        // Text des Live-Status (auch für Tests)
        fun liveText(a: Activity): String = when (a.kind) {
            ActKind.THINKING -> tr("Denkt nach …", "Thinking …")
            ActKind.WRITING -> tr("Schreibt die Antwort …", "Writing the reply …")
            ActKind.TOOL -> toolText(a.tool, a.detail)
            ActKind.WAITING -> when (a.tool) {
                "AskUserQuestion" -> tr("Wartet auf dich: Frage", "Waiting for you: question")
                "ExitPlanMode" -> tr("Wartet auf dich: Plan", "Waiting for you: plan")
                else -> tr("Wartet auf dich: Erlaubnis für ", "Waiting for you: permission for ") + a.tool
            }
            ActKind.BACKGROUND -> tr("Hintergrund-Aufgabe läuft", "Background task running")
            ActKind.NONE -> ""
        }

        private fun toolText(name: String, detail: String): String {
            val file = detail.replace('\\', '/').substringAfterLast('/').ifBlank { detail }
            return when (name) {
                "Bash", "PowerShell" -> tr("Befehl: ", "Command: ") + detail
                "Read" -> tr("Liest ", "Reading ") + file
                "Edit", "MultiEdit", "NotebookEdit" -> tr("Bearbeitet ", "Editing ") + file
                "Write" -> tr("Schreibt ", "Writing ") + file
                "Grep", "Glob" -> tr("Durchsucht: ", "Searching: ") + detail
                "WebFetch", "WebSearch" -> tr("Im Web: ", "On the web: ") + detail
                "Task", "Agent" -> tr("Agent: ", "Agent: ") + detail
                "TodoWrite" -> tr("Plant die nächsten Schritte", "Planning next steps")
                else -> if (detail.isBlank()) name else "$name: $detail"
            }.take(120)
        }
    }
}
