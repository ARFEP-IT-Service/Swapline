@file:OptIn(ExperimentalMaterial3Api::class)

package de.arfep.swapline.ui

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import de.arfep.swapline.model.AppModel

private fun granted(ctx: Context, p: String) = ContextCompat.checkSelfPermission(ctx, p) == PackageManager.PERMISSION_GRANTED

// Berechtigungen ändert nur Android selbst: Sprung in die App-Einstellungen
private fun openAppSettings(ctx: Context) = runCatching {
    ctx.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + ctx.packageName)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
}
private fun openVoiceInputSettings(ctx: Context) = runCatching {
    ctx.startActivity(Intent(Settings.ACTION_VOICE_INPUT_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
}.recoverCatching { ctx.startActivity(Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }

@Composable
fun SettingsScreen(model: AppModel, onBack: () -> Unit, onHosts: () -> Unit) {
    val ctx = LocalContext.current
    // Status neu lesen, wenn man aus den Android-Einstellungen zurückkommt
    var tick by remember { mutableIntStateOf(0) }
    val owner = LocalLifecycleOwner.current
    LaunchedEffect(owner) {
        owner.lifecycle.addObserver(LifecycleEventObserver { _, e -> if (e == Lifecycle.Event.ON_RESUME) tick++ })
    }
    Scaffold(topBar = {
        TopAppBar(title = { Text(tr("Einstellungen", "Settings")) },
            navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, tr("Zurück", "Back")) } })
    }) { pad ->
        @Suppress("UNUSED_EXPRESSION") tick
        val speech = speechStatus(ctx)
        Column(Modifier.fillMaxSize().padding(pad).verticalScroll(rememberScrollState())) {
            Section(tr("Diktieren", "Dictation"))
            SwitchRow(tr("Mikrofon im Eingabefeld", "Microphone in the input field"), tr("Knopf neben „Senden“ im Chat", "Button next to “Send” in the chat"), model.micEnabled, model::changeMic)
            SwitchRow(tr("Nur auf dem Gerät erkennen", "Recognize on device only"),
                tr("Sprache verlässt das Handy nicht (wenn das Handy es unterstützt)", "Speech never leaves the phone (if the phone supports it)"), model.onDeviceOnly, model::changeOnDeviceOnly)
            InfoRow(tr("Spracherkennung", "Speech recognition"), when (speech) {
                SpeechStatus.ON_DEVICE -> tr("auf dem Gerät verfügbar ✓", "available on device ✓")
                SpeechStatus.SERVICE -> tr("über den Sprachdienst des Handys (z. B. Google/Samsung)", "via the phone's speech service (e.g. Google/Samsung)")
                SpeechStatus.NONE -> tr("nicht eingerichtet – antippen zum Einrichten", "not set up – tap to set up")
            }, warn = speech == SpeechStatus.NONE) { openVoiceInputSettings(ctx) }

            Section(tr("Berechtigungen", "Permissions"))
            val perms = buildList {
                add(Triple(tr("Mikrofon", "Microphone"), tr("zum Diktieren", "for dictation"), Manifest.permission.RECORD_AUDIO))
                add(Triple(tr("Kamera", "Camera"), tr("zum Scannen des QR-Codes", "to scan the QR code"), Manifest.permission.CAMERA))
                if (Build.VERSION.SDK_INT >= 36) add(Triple(tr("Lokales Netzwerk", "Local network"), tr("Verbindung zum Haupt-PC im Heimnetz", "connection to the host PC on the home network"), "android.permission.ACCESS_LOCAL_NETWORK"))
                if (Build.VERSION.SDK_INT >= 33) add(Triple(tr("Benachrichtigungen", "Notifications"), tr("fertige Antworten und Rückfragen", "finished replies and requests"), Manifest.permission.POST_NOTIFICATIONS))
            }
            for ((name, why, p) in perms) {
                val ok = granted(ctx, p)
                InfoRow(name, why + " · " + if (ok) tr("erlaubt ✓", "allowed ✓") else tr("nicht erlaubt – antippen", "not allowed – tap"), warn = !ok) { openAppSettings(ctx) }
            }

            Section(tr("Benachrichtigungen", "Notifications"))
            SwitchRow(tr("Live-Status, während Claude arbeitet", "Live status while Claude is working"),
                tr("Benachrichtigung mit dem aktuellen Schritt (z. B. „Befehl: npm test“, „Wartet auf dich“) und Laufzeit; auf Android 16+ auch oben in der Statusleiste",
                    "Notification with the current step (e.g. “Command: npm test”, “Waiting for you”) and elapsed time; on Android 16+ also at the top of the status bar"),
                model.liveEnabled, model::changeLive)

            Section(tr("Verbindung", "Connection"))
            SwitchRow(tr("Im Hintergrund verbunden bleiben", "Stay connected in the background"),
                tr("Antworten und Rückfragen melden sich auch bei geschlossener App (dauerhafte, stille Benachrichtigung; etwas mehr Akku)",
                    "Replies and requests also arrive while the app is closed (permanent silent notification; uses a little more battery)"),
                model.backgroundEnabled) { on -> model.changeBackground(on); de.arfep.swapline.ConnectionService.sync(ctx) }
            if (model.backgroundEnabled) {
                val pm = ctx.getSystemService(android.os.PowerManager::class.java)
                val free = pm?.isIgnoringBatteryOptimizations(ctx.packageName) == true
                InfoRow(tr("Akku-Optimierung", "Battery optimization"),
                    if (free) tr("für Swapline aus ✓ – die Verbindung bleibt auch im Standby", "off for Swapline ✓ – the connection stays up in standby")
                    else tr("an – Android kann die Verbindung im Standby trennen. Antippen und Swapline auf „Nicht optimieren“ bzw. „Nicht eingeschränkt“ stellen.",
                        "on – Android may drop the connection in standby. Tap and set Swapline to “Don't optimize” / “Unrestricted”."), warn = !free) {
                    runCatching { ctx.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                        .onFailure { openAppSettings(ctx) }
                }
            }
            InfoRow(tr("Haupt-PCs", "Host PCs"), tr("${model.hosts.size} gekoppelt – koppeln, Adressen ändern, entfernen", "${model.hosts.size} paired – pair, change addresses, remove", "${model.hosts.size} eşleştirildi – eşleştir, adresleri değiştir, kaldır"), arrow = true, onClick = onHosts)

            Section(tr("Über", "About"))
            AboutRow(model)
        }
    }
}

@Composable
private fun Section(title: String) {
    Text(title, Modifier.padding(start = 16.dp, top = 20.dp, bottom = 4.dp), color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
}

@Composable
private fun SwitchRow(title: String, sub: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().clickable { onChange(!checked) }.padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title)
            Text(sub, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Spacer(Modifier.width(12.dp))
        Switch(checked, onChange)
    }
    HorizontalDivider(Modifier.padding(start = 16.dp), color = MaterialTheme.colorScheme.outlineVariant)
}

@Composable
private fun InfoRow(title: String, sub: String, warn: Boolean = false, arrow: Boolean = false, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title)
            Text(sub, fontSize = 12.sp, color = if (warn) Danger else MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (arrow) Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    HorizontalDivider(Modifier.padding(start = 16.dp), color = MaterialTheme.colorScheme.outlineVariant)
}
