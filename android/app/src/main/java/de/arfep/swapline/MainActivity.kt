package de.arfep.swapline

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import de.arfep.swapline.model.Chat
import de.arfep.swapline.model.HostState
import de.arfep.swapline.ui.ChatScreen
import de.arfep.swapline.ui.ChatSetupDialog
import de.arfep.swapline.ui.HomeScreen
import de.arfep.swapline.ui.HostsScreen
import de.arfep.swapline.ui.PairData
import de.arfep.swapline.ui.PairScreen
import de.arfep.swapline.ui.SwaplineTheme
import de.arfep.swapline.ui.SettingsScreen
import de.arfep.swapline.ui.QrScanner
import de.arfep.swapline.ui.tr
import de.arfep.swapline.net.PairLinks
import android.widget.Toast

sealed class Screen {
    data object Home : Screen()
    data object Hosts : Screen()
    data object Settings : Screen()
    data class Pair(val data: PairData? = null) : Screen()
    data class ChatView(val chatId: String) : Screen()
    data object Scan : Screen()
}

class MainActivity : ComponentActivity() {
    private val model get() = (application as SwaplineApp).model
    private val pendingChat = mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        pendingChat.value = intent?.getStringExtra(EXTRA_CHAT)
        setContent { SwaplineTheme { App() } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.getStringExtra(EXTRA_CHAT)?.let { pendingChat.value = it }
    }

    override fun onStart() {
        super.onStart()
        model.foreground = true
        model.reconnectAll()
        model.checkUpdate()
        ConnectionService.sync(this)
        model.refreshLive()
    }

    override fun onStop() {
        super.onStop()
        model.foreground = false
        model.refreshLive() // im Hintergrund: Live-Status für laufende Chats zeigen
    }

    @Composable
    private fun App() {
        val m = model
        var stack by remember { mutableStateOf(listOf<Screen>(Screen.Home)) }
        var hostId by remember { mutableStateOf(m.hosts.firstOrNull()?.id) }
        var setup by remember { mutableStateOf<Pair<HostState, Chat?>?>(null) }
        fun push(s: Screen) { stack = stack + s }
        fun pop() { if (stack.size > 1) stack = stack.dropLast(1) }

        val notifPerm = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
        // Android 17: Verbindungen ins Heimnetz brauchen die Berechtigung „Lokales Netzwerk“ (ohne sie laufen sie ins Leere)
        val startPerms = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { m.reconnectAll() }
        LaunchedEffect(Unit) {
            val want = buildList {
                if (Build.VERSION.SDK_INT >= 36) add(LOCAL_NETWORK)
                if (Build.VERSION.SDK_INT >= 33 && m.hosts.isNotEmpty()) add(Manifest.permission.POST_NOTIFICATIONS)
            }.filter { ContextCompat.checkSelfPermission(this@MainActivity, it) != PackageManager.PERMISSION_GRANTED }
            if (want.isNotEmpty()) startPerms.launch(want.toTypedArray())
        }

        val pc = pendingChat.value
        LaunchedEffect(pc) {
            if (pc != null) {
                m.chat(pc)?.let { c -> hostId = c.hostId; stack = listOf(Screen.Home, Screen.ChatView(c.id)) }
                pendingChat.value = null
            }
        }
        val top = stack.last()
        if (top !is Screen.ChatView) m.visibleChatId = null
        BackHandler(stack.size > 1) { pop() }
        when (top) {
            Screen.Home -> HomeScreen(m, hostId, onHost = { hostId = it }, onOpen = { push(Screen.ChatView(it.id)) }, onDevices = { push(Screen.Hosts) },
                onPair = { push(Screen.Pair()) }, onNewChat = { setup = it to null }, onSettings = { push(Screen.Settings) })
            Screen.Settings -> SettingsScreen(m, onBack = ::pop, onHosts = { push(Screen.Hosts) })
            Screen.Hosts -> HostsScreen(m, onBack = ::pop, onPair = { push(Screen.Pair()) }, onPicked = { hostId = it; stack = listOf(Screen.Home) })
            is Screen.Pair -> PairScreen(m, top.data, onBack = ::pop, onScan = { push(Screen.Scan) }, onPaired = { id ->
                hostId = id; stack = listOf(Screen.Home)
                ConnectionService.sync(this@MainActivity)
                if (Build.VERSION.SDK_INT >= 33) notifPerm.launch(Manifest.permission.POST_NOTIFICATIONS)
            })
            Screen.Scan -> QrScanner(onBack = ::pop) { text ->
                val link = PairLinks.parse(text)
                stack = stack.dropLast(1).filter { it !is Screen.Pair } + Screen.Pair(link?.let { PairData(it.addresses, it.port, it.code, it.name, it.relay) })
                if (link == null) Toast.makeText(this@MainActivity, tr("Kein Swapline-Kopplungscode", "Not a Swapline pairing code"), Toast.LENGTH_LONG).show()
            }
            is Screen.ChatView -> {
                val c = m.chat(top.chatId)
                if (c == null) LaunchedEffect(top) { pop() }
                else ChatScreen(m, c, onBack = ::pop, onSettings = { m.host(c.hostId)?.let { setup = it to c } })
            }
        }
        setup?.let { (h, c) ->
            ChatSetupDialog(m, h, c, onDismiss = { setup = null }, onCreated = { setup = null; push(Screen.ChatView(it.id)) })
        }
    }

    companion object {
        const val EXTRA_CHAT = "chat"
        const val LOCAL_NETWORK = "android.permission.ACCESS_LOCAL_NETWORK"
    }
}
