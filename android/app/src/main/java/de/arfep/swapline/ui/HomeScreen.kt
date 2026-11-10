@file:OptIn(ExperimentalMaterial3Api::class)

package de.arfep.swapline.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.outlined.Devices
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SecondaryTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import de.arfep.swapline.model.AppModel
import de.arfep.swapline.model.Chat
import de.arfep.swapline.model.HistoryEntry
import de.arfep.swapline.model.HostState
import de.arfep.swapline.model.OpenTab
import de.arfep.swapline.model.within
import de.arfep.swapline.net.LinkState

@Composable
fun StatusDot(state: LinkState, busy: Boolean = false) {
    val c = when (state) { LinkState.CONNECTED -> if (busy) Accent else Ok; LinkState.OFF -> Color.Gray; else -> Color(0xFFF5A524) }
    Box(Modifier.size(9.dp).background(c, CircleShape))
}

fun stateText(h: HostState) = when (h.state) {
    LinkState.CONNECTED -> if (h.parent != null) tr("SSH-Server über den Haupt-PC", "SSH server via the host PC") else if (h.link.via == "relay") tr("verbunden über Vermittler", "connected via relay") else tr("verbunden", "connected")
    LinkState.CONNECTING -> tr("verbinde …", "connecting …")
    LinkState.RECONNECTING -> tr("nicht erreichbar – neuer Versuch …", "unreachable – retrying …")
    LinkState.OFF -> tr("getrennt", "disconnected")
}

// Eine Zeile der Chatliste: eigener/beigetretener Chat oder offener Chat am Haupt-PC (noch nicht geöffnet)
private sealed class Row_ {
    data class Mine(val chat: Chat) : Row_()
    data class Open(val tab: OpenTab) : Row_()
}

@Composable
fun HomeScreen(model: AppModel, hostId: String?, onHost: (String) -> Unit, onOpen: (Chat) -> Unit, onDevices: () -> Unit, onPair: () -> Unit, onNewChat: (HostState) -> Unit, onSettings: () -> Unit) {
    val h = model.host(hostId ?: "") ?: model.hosts.firstOrNull()
    val all = model.hosts.flatMap { x -> listOf(x) + model.servers.filter { it.parent === x } }
    var tab by rememberSaveable { mutableStateOf(0) }
    // aus einem Chat mit /resume: gleich den Verlauf zeigen
    LaunchedEffect(model.wantHistory, h?.id) { if (model.wantHistory && h != null) { tab = 1; model.loadHistory(h); model.wantHistory = false } }
    var hostMenu by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    if (h == null) Text("Swapline")
                    else Box {
                        Row(Modifier.clickable { hostMenu = true }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                            Column {
                                Text(h.record.name, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.SemiBold)
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    StatusDot(h.state)
                                    Spacer(Modifier.width(6.dp))
                                    Text(stateText(h), fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                            }
                            if (all.size > 1) Icon(Icons.Default.ArrowDropDown, null)
                        }
                        DropdownMenu(hostMenu, { hostMenu = false }) {
                            for (x in all) DropdownMenuItem(
                                text = { Text(x.record.name) },
                                // SSH-Server eingerückt unter ihrem Haupt-PC
                                modifier = if (x.parent != null) Modifier.padding(start = 16.dp) else Modifier,
                                leadingIcon = { StatusDot(x.state, model.chats.any { it.hostId == x.id && it.running }) },
                                onClick = { hostMenu = false; onHost(x.id) })
                        }
                    }
                },
                actions = {
                    IconButton(onClick = onDevices) { Icon(Icons.Outlined.Devices, tr("Haupt-PCs", "Host PCs")) }
                    IconButton(onClick = onSettings) { Icon(Icons.Outlined.Settings, tr("Einstellungen", "Settings")) }
                },
            )
        },
        floatingActionButton = {
            if (h != null && h.connected && h.store?.newChats != false && h.store?.profiles?.isNotEmpty() == true)
                ExtendedFloatingActionButton(onClick = { onNewChat(h) }, icon = { Icon(Icons.Default.Add, null) }, text = { Text(tr("Neuer Chat", "New chat")) })
        },
    ) { pad ->
        if (h == null) {
            Column(Modifier.fillMaxSize().padding(pad).padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                Text(tr("Noch kein Haupt-PC gekoppelt", "No host PC paired yet"), style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(8.dp))
                Text(tr("Swapline auf dem Handy nutzt Claude Code auf deinem PC. Am PC in Swapline: Fernzugriff (Symbol in der Leiste links) → „Fernzugriff erlauben“ → „Gerät koppeln …“.",
                    "Swapline on the phone uses Claude Code on your PC. In Swapline on the PC: Remote access (icon in the left rail) → “Allow remote access” → “Pair device …”."),
                    color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
                Spacer(Modifier.height(20.dp))
                Button(onClick = onPair) { Text(tr("Haupt-PC koppeln", "Pair host PC")) }
            }
            return@Scaffold
        }
        Column(Modifier.fillMaxSize().padding(pad)) {
            UpdateBanner(model)
            Filters(model, h)
            SecondaryTabRow(selectedTabIndex = tab) {
                Tab(tab == 0, { tab = 0 }, text = { Text(tr("Chats", "Chats")) })
                Tab(tab == 1, { tab = 1; model.loadHistory(h) }, text = { Text(tr("Verlauf", "History")) })
            }
            if (!h.connected && h.store == null) {
                Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        if (h.state == LinkState.CONNECTING) CircularProgressIndicator()
                        else Text(tr("Haupt-PC nicht erreichbar. Läuft Swapline dort mit eingeschaltetem Fernzugriff, und ist das Handy im selben Netz (oder per Tailscale/VPN verbunden)?",
                            "Host PC unreachable. Is Swapline running there with remote access on, and is the phone on the same network (or connected via Tailscale/VPN)?"),
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                        h.error?.let { Spacer(Modifier.height(8.dp)); Text(it, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        Spacer(Modifier.height(12.dp))
                        TextButton(onClick = { model.connect(h) }) { Text(tr("Erneut verbinden", "Reconnect")) }
                    }
                }
            } else if (tab == 0) ChatList(model, h, onOpen) else HistoryList(model, h, onOpen)
        }
    }
}

@Composable
private fun Filters(model: AppModel, h: HostState) {
    val st = h.store ?: return
    var accMenu by remember { mutableStateOf(false) }
    LazyRow(Modifier.fillMaxWidth(), contentPadding = PaddingValues(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        if (st.profiles.size > 1) item {
            Box {
                val p = st.profiles.firstOrNull { it.id == h.profileId }
                FilterChip(true, { accMenu = true }, label = { Text(p?.name ?: "?") }, leadingIcon = { Avatar(p?.name ?: "?", p?.color ?: "#1581FF", 18.dp) })
                DropdownMenu(accMenu, { accMenu = false }) {
                    for (x in st.profiles) DropdownMenuItem(text = { Text(x.name) }, leadingIcon = { Avatar(x.name, x.color, 22.dp) },
                        onClick = { accMenu = false; h.profileId = x.id; model.loadHistory(h) })
                }
            }
        }
        if (st.projects.isNotEmpty()) {
            item { FilterChip(h.projectFilter == null, { h.projectFilter = null }, label = { Text(tr("Alle", "All")) }) }
            val grouped = st.groups.flatMap { g -> st.projects.filter { it.groupId == g.id } } + st.projects.filter { p -> st.groups.none { it.id == p.groupId } }
            items(grouped, key = { it.id }) { p ->
                FilterChip(h.projectFilter == p.id, { h.projectFilter = if (h.projectFilter == p.id) null else p.id },
                    label = { Text(p.name) }, leadingIcon = { Avatar(p.name, p.color, 18.dp) })
            }
        }
    }
}

private fun inFilter(h: HostState, cwd: String): Boolean {
    val pid = h.projectFilter ?: return true
    val p = h.store?.projects?.firstOrNull { it.id == pid } ?: return true
    return p.cwd.isNotEmpty() && within(cwd, p.cwd)
}

@Composable
private fun ChatList(model: AppModel, h: HostState, onOpen: (Chat) -> Unit) {
    val mine = model.chats.filter { it.hostId == h.id && inFilter(h, it.cwd) }
    val open = h.openTabs.filter { t -> mine.none { it.hostTab == t.id } && inFilter(h, t.cwd) }
    val rows = (mine.map { Row_.Mine(it) } + open.map { Row_.Open(it) }).sortedByDescending {
        when (it) { is Row_.Mine -> maxOf(it.chat.updated, if (it.chat.running || it.chat.tasksRunning) Long.MAX_VALUE / 2 else 0); is Row_.Open -> maxOf(it.tab.updated, if (it.tab.running) Long.MAX_VALUE / 2 else 0) }
    }
    PullToRefreshBox(isRefreshing = false, onRefresh = { model.refresh(h) }, modifier = Modifier.fillMaxSize()) {
        if (rows.isEmpty()) {
            Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
                Text(tr("Keine offenen Chats. Neuen Chat starten oder einen aus dem Verlauf fortsetzen.", "No open chats. Start a new chat or continue one from the history."),
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 96.dp)) {
            items(rows, key = { when (it) { is Row_.Mine -> "c" + it.chat.id; is Row_.Open -> "o" + it.tab.id } }) { r ->
                when (r) {
                    is Row_.Mine -> ChatRow(r.chat.title.ifBlank { tr("Neuer Chat", "New chat") }, r.chat.preview, r.chat.updated, r.chat.cwd, r.chat.running || r.chat.tasksRunning, r.chat.unread,
                        if (r.chat.mirror) tr("am PC offen", "open on PC") else null) { onOpen(r.chat) }
                    is Row_.Open -> ChatRow(r.tab.title.ifBlank { tr("Chat", "Chat") }, r.tab.preview, r.tab.updated, r.tab.cwd, r.tab.running, false, tr("am PC offen", "open on PC")) {
                        onOpen(model.openMirror(h, r.tab))
                    }
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, modifier = Modifier.padding(start = 16.dp))
            }
        }
    }
}

@Composable
private fun ChatRow(title: String, preview: String, updated: Long, cwd: String, running: Boolean, unread: Boolean, badge: String?, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(title, Modifier.weight(1f, false), maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = if (unread) FontWeight.Bold else FontWeight.Medium)
                if (badge != null) {
                    Spacer(Modifier.width(6.dp))
                    Text(badge, fontSize = 10.sp, color = MaterialTheme.colorScheme.onSecondaryContainer,
                        modifier = Modifier.background(MaterialTheme.colorScheme.secondaryContainer, CircleShape).padding(horizontal = 6.dp, vertical = 1.dp))
                }
            }
            val sub = listOf(folderName(cwd).takeIf { cwd.isNotEmpty() }, preview.takeIf { it.isNotBlank() }).filterNotNull().joinToString(" · ")
            if (sub.isNotEmpty()) Text(sub, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Spacer(Modifier.width(8.dp))
        Column(horizontalAlignment = Alignment.End) {
            Text(ago(updated), fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(4.dp))
            if (running) CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp)
            else if (unread) Box(Modifier.size(10.dp).background(Accent, CircleShape))
        }
    }
}

@Composable
private fun HistoryList(model: AppModel, h: HostState, onOpen: (Chat) -> Unit) {
    var q by rememberSaveable { mutableStateOf("") }
    val list = h.history.filter { inFilter(h, it.cwd) && (q.isBlank() || it.title.contains(q, true) || it.cwd.contains(q, true)) }
    Column(Modifier.fillMaxSize()) {
        OutlinedTextField(q, { q = it }, Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp), singleLine = true,
            leadingIcon = { Icon(Icons.Outlined.Search, null) }, placeholder = { Text(tr("Verlauf durchsuchen", "Search history")) })
        PullToRefreshBox(isRefreshing = h.historyLoading, onRefresh = { model.loadHistory(h) }, modifier = Modifier.fillMaxSize()) {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 96.dp)) {
                items(list, key = HistoryEntry::sessionId) { e ->
                    ChatRow(e.title.ifBlank { tr("Ohne Titel", "Untitled") }, "", e.mtime, e.cwd, h.openTabs.any { it.sessionId == e.sessionId && it.running }, false,
                        if (h.openTabs.any { it.sessionId == e.sessionId }) tr("am PC offen", "open on PC") else null) { onOpen(model.openHistory(h, e)) }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, modifier = Modifier.padding(start = 16.dp))
                }
            }
        }
    }
}

@Composable
fun UpdateBanner(model: AppModel) {
    val u = model.update ?: return
    val ctx = androidx.compose.ui.platform.LocalContext.current
    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp)
        .background(MaterialTheme.colorScheme.secondaryContainer, androidx.compose.foundation.shape.RoundedCornerShape(12.dp))
        .padding(start = 14.dp, end = 4.dp, top = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(tr("Swapline für Android ${u.version} ist verfügbar", "Swapline for Android ${u.version} is available", "Android için Swapline ${u.version} mevcut"), Modifier.weight(1f),
            fontSize = 13.sp, color = MaterialTheme.colorScheme.onSecondaryContainer)
        TextButton(onClick = { openUrl(ctx, u.apkUrl) }) { Text(tr("Herunterladen", "Download")) }
    }
}

// Links nur über https zu GitHub-Releases öffnen (Browser lädt die APK, Android fragt vor der Installation)
fun openUrl(ctx: android.content.Context, url: String) {
    if (!url.startsWith("https://github.com/ARFEP-IT-Service/Swapline/releases/")) return
    runCatching { ctx.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url)).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)) }
}
