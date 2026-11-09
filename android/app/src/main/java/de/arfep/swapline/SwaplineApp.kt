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
import de.arfep.swapline.model.Notifier
import de.arfep.swapline.ui.tr

class SwaplineApp : Application() {
    lateinit var model: AppModel
        private set

    override fun onCreate() {
        super.onCreate()
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, tr("Antworten und Rückfragen", "Replies and requests"), NotificationManager.IMPORTANCE_HIGH))
        model = AppModel(this, AndroidNotifier())
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
                .build()
            runCatching { NotificationManagerCompat.from(this@SwaplineApp).notify(chat.id.hashCode(), n) }
        }

        override fun clear(chat: Chat) = NotificationManagerCompat.from(this@SwaplineApp).cancel(chat.id.hashCode())
    }

    companion object { const val CHANNEL = "chats" }
}
