// Zustand der App: gekoppelte Haupt-PCs (je einer eine Verbindung), Chats und Aktionen.
// Jede Aktion ist eine Anfrage an den Haupt-PC; der prüft Freigaben, Konten und Ordner selbst.
package de.arfep.swapline.model

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import de.arfep.swapline.data.Vault
import de.arfep.swapline.net.HostLink
import de.arfep.swapline.net.LinkException
import de.arfep.swapline.net.LinkState
import de.arfep.swapline.net.Target
import de.arfep.swapline.net.json
import de.arfep.swapline.net.pair
import de.arfep.swapline.net.str
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.security.SecureRandom

private val rnd = SecureRandom()
private const val ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789"
fun newId(len: Int = 12) = String(CharArray(len) { ID_CHARS[rnd.nextInt(ID_CHARS.length)] })

interface Notifier {
    fun notify(chat: Chat, host: HostState, notice: Notice)
    fun clear(chat: Chat)
    fun status() {}   // Verbindungsstatus geändert (dauerhafte Benachrichtigung aktualisieren)
    fun live(chat: Chat, host: HostState, show: Boolean) {}   // Live-Status eines Chats (show = false: entfernen)
}

class AppModel(context: Context, private val notifier: Notifier) {
    private val prefs = context.getSharedPreferences("swapline", Context.MODE_PRIVATE)
    // Fehler in einzelnen Aufgaben (Verbindung, Anfragen) beenden nie die App
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate + CoroutineExceptionHandler { _, e -> android.util.Log.w("Swapline", "Fehler im Hintergrund", e) })

    val hosts = mutableStateListOf<HostState>()
    val chats = mutableStateListOf<Chat>()
    private var visibleState by mutableStateOf<String?>(null)
    var visibleChatId: String?
        get() = visibleState
        set(v) { if (visibleState != v) { val old = visibleState; visibleState = v; old?.let { chat(it) }?.let(::updateLive) } }
    var foreground = false
    var update by mutableStateOf<Update?>(null)

    // Einstellungen (nur auf dem Handy)
    var micEnabled by mutableStateOf(prefs.getBoolean("micEnabled", true))
        private set
    var onDeviceOnly by mutableStateOf(prefs.getBoolean("onDeviceOnly", false))
        private set
    fun changeMic(on: Boolean) { micEnabled = on; prefs.edit().putBoolean("micEnabled", on).apply() }
    var liveEnabled by mutableStateOf(prefs.getBoolean("liveStatus", true))
        private set
    fun changeLive(on: Boolean) { liveEnabled = on; prefs.edit().putBoolean("liveStatus", on).apply(); refreshLive() }

    // Live-Status zeigen, solange Claude arbeitet – nicht für den Chat, den man gerade offen vor sich hat
    fun updateLive(c: Chat) {
        val h = host(c.hostId) ?: return
        val visible = foreground && visibleChatId == c.id
        notifier.live(c, h, liveEnabled && !visible && c.activity.kind != ActKind.NONE)
    }
    fun refreshLive() { for (c in chats) updateLive(c) }

    var backgroundEnabled by mutableStateOf(prefs.getBoolean("background", true))
        private set
    fun changeBackground(on: Boolean) { backgroundEnabled = on; prefs.edit().putBoolean("background", on).apply() }
    fun changeOnDeviceOnly(on: Boolean) { onDeviceOnly = on; prefs.edit().putBoolean("onDeviceOnly", on).apply() }

    fun checkUpdate(force: Boolean = false) = scope.launch {
        val current = de.arfep.swapline.BuildConfig.VERSION_NAME
        val cached = prefs.getString("updateVersion", null)?.let { Update(it, prefs.getString("updateApk", "")!!, prefs.getString("updatePage", "")!!) }
        if (!force && System.currentTimeMillis() - prefs.getLong("updateCheck", 0) < 6 * 3600_000L) {
            update = cached?.takeIf { Updates.compare(it.version, current) > 0 && it.apkUrl.isNotEmpty() }
            return@launch
        }
        val u = Updates.check(current)
        prefs.edit().putLong("updateCheck", System.currentTimeMillis())
            .putString("updateVersion", u?.version).putString("updateApk", u?.apkUrl).putString("updatePage", u?.pageUrl).apply()
        update = u
    }
    var deviceName: String = android.os.Build.MODEL.take(40)

    init {
        loadHosts().forEach { addHost(it, save = false) }
        loadChats()
    }

    // SSH-Server der Haupt-PCs (eigene Einträge, ID „<Haupt-PC>~<Server>“)
    val servers = mutableStateListOf<HostState>()
    fun host(id: String) = hosts.firstOrNull { it.id == id } ?: servers.firstOrNull { it.id == id }
    // Haupt-PC und seine SSH-Server: Chats, deren Ereignisse über diese Verbindung kommen
    private fun viaHost(c: Chat, h: HostState) = c.hostId == h.id || servers.any { it.id == c.hostId && it.parent === h }
    fun chat(id: String) = chats.firstOrNull { it.id == id }

    // ---------- Speicher ----------
    private fun loadHosts(): List<HostRecord> = runCatching {
        (json.parseToJsonElement(prefs.getString("hosts", "[]")!!) as JsonArray).mapNotNull { (it as? JsonObject)?.let(HostRecord::from) }
    }.getOrDefault(emptyList())

    private fun saveHosts() = prefs.edit().putString("hosts", JsonArray(hosts.map { it.record.toJson() }).toString()).apply()

    private fun loadChats() = runCatching {
        for (e in json.parseToJsonElement(prefs.getString("chats", "[]")!!) as JsonArray) {
            val o = e as? JsonObject ?: continue
            val c = Chat(o.str("id") ?: continue, o.str("hostId") ?: continue, o.str("hostTab"), o.str("profileId").orEmpty(), o.str("cwd").orEmpty(), o.str("sessionId"),
                o.str("model").orEmpty(), o.str("effort").orEmpty(), o.str("permissionMode") ?: "default", o.str("title").orEmpty())
            c.preview = o.str("preview").orEmpty()
            c.updated = (o["updated"] as? JsonPrimitive)?.content?.toLongOrNull() ?: 0L
            if (host(c.hostId) != null && !c.mirror) chats.add(c)
        }
    }

    fun saveChats() = prefs.edit().putString("chats", JsonArray(chats.filter { !it.mirror }.map { c ->
        buildJsonObject {
            put("id", c.id); put("hostId", c.hostId); put("profileId", c.profileId); put("cwd", c.cwd); put("sessionId", c.sessionId)
            put("model", c.model); put("effort", c.effort); put("permissionMode", c.permissionMode); put("title", c.title); put("preview", c.preview); put("updated", c.updated)
        }
    }).toString()).apply()

    // ---------- Haupt-PCs ----------
    private fun addHost(rec: HostRecord, save: Boolean = true): HostState {
        val h = HostState(rec)
        h.link = HostLink(scope,
            onEvent = { kind, data -> scope.launch { onEvent(h, kind, data) } },
            onState = { s, detail -> scope.launch { onState(h, s, detail) } })
        hosts.add(h)
        if (save) saveHosts()
        connect(h)
        return h
    }

    fun connect(h: HostState) {
        val key = runCatching { Vault.decrypt(h.record.keyEnc) }.getOrNull()
        if (key == null) { h.error = "key"; return }
        h.link.use(Target(h.record.address, h.record.port, h.record.deviceId, key, relayOf(h.record)))
    }

    private fun relayOf(r: HostRecord): de.arfep.swapline.net.RelayRoute? {
        val parts = r.relay.split('|')
        if (parts.size != 3 || r.relayKeyEnc.isEmpty()) return null
        val k = runCatching { String(Vault.decrypt(r.relayKeyEnc), Charsets.UTF_8) }.getOrNull() ?: return null
        return de.arfep.swapline.net.RelayRoute(parts[0], parts[1].toIntOrNull() ?: return null, parts[2], k)
    }
    private fun withRelay(r: HostRecord, relay: de.arfep.swapline.net.RelayRoute?): HostRecord =
        if (relay == null) r.copy(relay = "", relayKeyEnc = "")
        else r.copy(relay = "${relay.address}|${relay.port}|${relay.hostId}", relayKeyEnc = Vault.encrypt(relay.dialKey.toByteArray(Charsets.UTF_8)))

    // Mehrere Adressen (aus dem QR-Code): der Reihe nach probieren; nicht erreichbare kosten den Einmal-Code nicht
    suspend fun pairHost(addresses: List<String>, port: Int, code: String, relay: de.arfep.swapline.net.RelayRoute? = null): HostState {
        var last: Exception? = null
        for (address in addresses.map { it.trim() }.filter { it.isNotEmpty() }) {
            val p = try { pair(address, port, code, deviceName, if (addresses.size > 1) 4_000 else 15_000) }
            catch (e: LinkException) { if (e.reason == "unreachable") { last = e; continue } else throw e }
            // alle Adressen merken (die erreichbare zuerst) – unterwegs z. B. die öffentliche IP
            val all = (listOf(address) + addresses.map { it.trim() }.filter { it.isNotEmpty() && it != address }).take(8)
            val rec = withRelay(HostRecord(newId(8), p.hostName.ifBlank { address }, all.joinToString(","), port, p.deviceId, Vault.encrypt(p.key), p.hostName), relay)
            p.key.fill(0)
            return addHost(rec)
        }
        // von unterwegs: über den Vermittler koppeln
        if (relay != null) {
            val p = pair("", port, code, deviceName, relay = relay)
            val rec = withRelay(HostRecord(newId(8), p.hostName.ifBlank { relay.address }, addresses.map { it.trim() }.filter { it.isNotEmpty() }.take(8).joinToString(","), port, p.deviceId, Vault.encrypt(p.key), p.hostName), relay)
            p.key.fill(0)
            return addHost(rec)
        }
        throw last ?: LinkException("unreachable", "keine Adresse")
    }

    fun updateHost(h: HostState, name: String, address: String, port: Int) {
        val list = address.split(',').map { it.trim() }.filter { de.arfep.swapline.net.PairLinks.validAddress(it) }.distinct().take(8)
        if (list.isEmpty()) return
        val rec = h.record.copy(name = name.trim().take(40).ifBlank { h.record.name }, address = list.joinToString(","), port = port)
        val moved = rec.address != h.record.address || rec.port != h.record.port
        h.record = rec
        saveHosts()
        if (moved) connect(h)
    }

    // Nur auf dem Handy entfernen; am Haupt-PC bleibt das Gerät in der Geräteliste, bis es dort entfernt wird
    fun removeHost(h: HostState) {
        h.link.close()
        chats.removeAll { viaHost(it, h) }
        servers.removeAll { it.parent === h }
        hosts.remove(h)
        saveHosts(); saveChats()
    }

    private fun onState(h: HostState, s: LinkState, detail: String?) {
        val changed = h.state != s
        // Verbindung weg: was jetzt passiert, kommt nicht an – alle Chats dieses Haupt-PCs später neu laden
        if (h.state == LinkState.CONNECTED && s != LinkState.CONNECTED) for (c in chats) if (viaHost(c, h)) { c.stale = true; c.attached = false }
        h.state = s
        for (x in servers) if (x.parent === h) x.state = s
        if (changed) notifier.status()
        if (s == LinkState.CONNECTED) { h.error = null; refresh(h) }
        else if (detail != null) h.error = detail
    }

    private fun onEvent(h: HostState, kind: String, data: JsonElement) {
        when (kind) {
            "claude" -> {
                val o = data as? JsonObject ?: return
                val chat = chats.firstOrNull { viaHost(it, h) && it.id == o.str("tabId") } ?: return
                val msg = o["msg"] as? JsonObject ?: return
                val notice = chat.ingest(msg)
                updateLive(chat)
                if (notice != null) {
                    if (msg.str("type") == "result" || notice != Notice.DONE) saveChats()
                    if (visibleChatId != chat.id || !foreground) { chat.unread = true; notifier.notify(chat, host(chat.hostId) ?: h, notice) }
                }
            }
            "tabs" -> setOpenTabs(h, Parse.openTabs(data))
            "store-changed" -> refreshStore(h)
        }
    }

    private fun setOpenTabs(h: HostState, list: List<OpenTab>) {
        h.openTabs = list
        val ids = list.map { it.id }.toSet()
        // Am Haupt-PC geschlossene Chats verschwinden (außer dem gerade offenen)
        chats.removeAll { it.hostId == h.id && it.mirror && it.hostTab !in ids && it.id != visibleChatId }
        for (t in list) chats.firstOrNull { it.hostId == h.id && it.hostTab == t.id }?.let { c ->
            if (t.title.isNotBlank()) c.title = t.title
            if (!c.attached) c.running = t.running
            c.updated = maxOf(c.updated, t.updated)
        }
    }

    fun refresh(h: HostState): kotlinx.coroutines.Job = scope.launch {
        for (c in chats) if (c.hostId == h.id && c.mirror) c.attached = false // nach (Wieder-)Verbindung neu beitreten
        runCatching { setOpenTabs(h, Parse.openTabs(h.call("tabs:list"))) }
        refreshStore(h).join()
        loadHistory(h)
        // allen offenen Chats wieder beitreten (nicht nur dem sichtbaren), sonst fehlen deren Ereignisse und Hinweise
        for (c in chats.toList()) if (c.hostId == h.id && c.mirror && !c.attached && c.id != visibleChatId) attach(h, c)
        chat(visibleChatId ?: "")?.takeIf { it.hostId == h.id }?.let { open(it) }
        if (h.parent == null) for (x in servers.toList()) if (x.parent === h) refresh(x)
    }

    private suspend fun attach(h: HostState, c: Chat) {
        val r = runCatching { h.call("session:attach", buildJsonObject { put("tabId", c.id); put("hostTab", c.hostTab) }) }.getOrNull()
        if (r is JsonObject) { c.attached = true; c.running = (r["running"] as? JsonPrimitive)?.booleanOrNull == true }
    }

    private fun refreshStore(h: HostState) = scope.launch {
        val st = runCatching { Parse.store(h.call("store:get")) }.getOrNull() ?: return@launch
        h.store = st
        if (h.parent == null) syncServers(h, st.servers)
        // Adressen vom Haupt-PC (Heimnetz, öffentliche IP …) übernehmen; selbst eingetragene bleiben dahinter erhalten
        // Vermittler vom PC übernehmen (eingerichtet, geändert oder entfernt)
        val curRelay = relayOf(h.record)
        if (curRelay != st.relay) { h.record = withRelay(h.record, st.relay); saveHosts() }
        if (st.reach.isNotEmpty()) {
            val own = h.record.address.split(',').map { it.trim() }.filter { it.isNotEmpty() }
            val merged = (st.reach + own.filter { it !in st.reach }).distinct().take(8).joinToString(",")
            if (merged != h.record.address) { h.record = h.record.copy(address = merged); saveHosts() }
        }
        if (h.profileId == null || st.profiles.none { it.id == h.profileId }) h.profileId = st.activeProfileId ?: st.profiles.firstOrNull()?.id
        if (h.projectFilter != null && st.projects.none { it.id == h.projectFilter }) h.projectFilter = null
    }

    // SSH-Server eines Haupt-PCs als eigene Einträge: neue anlegen, umbenannte nachführen, entfernte (Freigabe weg) löschen
    private fun syncServers(h: HostState, list: List<ServerRef>) {
        val ids = list.map { "${h.id}~${it.id}" }.toSet()
        servers.filter { it.parent === h && it.id !in ids }.forEach { gone -> servers.remove(gone) }
        for (r in list) {
            val id = "${h.id}~${r.id}"
            val name = r.name + " · " + h.record.name
            val x = servers.firstOrNull { it.id == id }
            if (x != null) { if (x.record.name != name) x.record = x.record.copy(name = name); continue }
            val s = HostState(h.record.copy(id = id, name = name, color = r.color), parent = h, serverId = r.id)
            s.link = h.link
            s.state = h.state
            servers.add(s)
            if (h.connected) refresh(s)
        }
    }

    fun loadHistory(h: HostState) = scope.launch {
        val pid = h.profileId ?: return@launch
        h.historyLoading = true
        h.history = runCatching { Parse.history(h.call("history:list", JsonPrimitive(pid))) }.getOrDefault(h.history)
        h.historyLoading = false
    }

    suspend fun models(h: HostState, profileId: String): List<ModelOpt> = h.models[profileId] ?: fetchModels(h, profileId)

    // /-Befehle des Kontos (kommen mit den Modellen vom Haupt-PC)
    suspend fun commands(h: HostState, profileId: String): List<CmdOpt> {
        h.commands[profileId]?.let { return it }
        fetchModels(h, profileId)
        return h.commands[profileId].orEmpty()
    }

    private suspend fun fetchModels(h: HostState, profileId: String): List<ModelOpt> {
        val r = runCatching { h.call("profiles:models", buildJsonObject { put("id", profileId) }) }.getOrNull()
        val cmds = Parse.commands(r)
        if (cmds.isNotEmpty()) h.commands[profileId] = cmds
        return Parse.models(r).also { if (it.isNotEmpty()) h.models[profileId] = it }
    }

    // ---------- Chats ----------
    fun openMirror(h: HostState, t: OpenTab): Chat =
        chats.firstOrNull { it.hostId == h.id && it.hostTab == t.id } ?: Chat(newId(), h.id, t.id, t.profileId, t.cwd, t.sessionId, t.model, t.effort, t.permissionMode, t.title)
            .also { it.running = t.running; it.updated = t.updated; it.preview = t.preview; if (t.sessionId == null) it.loaded = true; chats.add(it) }

    fun openHistory(h: HostState, e: HistoryEntry): Chat =
        chats.firstOrNull { it.hostId == h.id && !it.mirror && it.sessionId == e.sessionId }
            ?: h.openTabs.firstOrNull { it.sessionId == e.sessionId }?.let { openMirror(h, it) } // läuft gerade am Haupt-PC: beitreten
            ?: Chat(newId(), h.id, null, h.profileId ?: "", e.cwd, e.sessionId, title = e.title).also { it.updated = e.mtime; chats.add(it); saveChats() }

    fun newChat(h: HostState, profileId: String, cwd: String, model: String, effort: String, mode: String): Chat =
        Chat(newId(), h.id, null, profileId, cwd, null, model, effort, mode).also { it.loaded = true; it.updated = System.currentTimeMillis(); chats.add(it); saveChats() }

    fun open(c: Chat) = scope.launch {
        visibleChatId = c.id
        updateLive(c)
        c.unread = false
        notifier.clear(c)
        val h = host(c.hostId) ?: return@launch
        if (!h.connected) return@launch
        if (c.mirror && !c.attached) attach(h, c)
        if (c.sessionId != null && (!c.loaded || c.stale)) {
            val wasStale = c.stale
            c.loaded = true
            // nur die letzten Nachrichten (große Chats brauchten über Mobilfunk sonst Minuten); ältere per loadOlder()
            val r = runCatching { h.call("history:loadSession", buildJsonObject {
                put("profileId", c.profileId); put("sessionId", c.sessionId); put("cwd", c.cwd); put("turns", c.loadedTurns)
            }) }.getOrNull()
            val msgs = (r as? JsonArray) ?: ((r as? JsonObject)?.get("msgs") as? JsonArray) // ältere Haupt-PCs: ganze Liste
            c.olderFrom = ((r as? JsonObject)?.get("start") as? JsonPrimitive)?.content?.toIntOrNull()?.takeIf { it > 0 }
            // offene Rückfragen (ältere Haupt-PCs ohne diese Abfrage: einfach ohne)
            val pend = runCatching { h.call("session:pending", buildJsonObject { put("tabId", c.id) }) }.getOrNull() as? JsonObject
            pend?.get("running")?.let { r -> (r as? JsonPrimitive)?.booleanOrNull?.let { c.running = it } }
            val requests = pend?.get("requests") as? JsonArray
            if (msgs != null) {
                if (wasStale) c.resync(msgs, requests)  // Lücken möglich: Anzeige komplett ersetzen
                else {
                    c.loadHistory(msgs)                 // erstes Laden: live Angekommenes bleibt dahinter erhalten
                    for (p in requests.orEmpty()) (p as? JsonObject)?.let { o -> if (c.items.none { requestIdOf(it) == o.str("request_id") }) c.ingest(o) }
                }
            }
            c.stale = false
        } else c.stale = false
    }

    private fun tabJson(c: Chat) = buildJsonObject {
        put("id", c.id)
        if (c.mirror) put("hostTab", c.hostTab)
        else {
            put("profileId", c.profileId); put("cwd", c.cwd); put("sessionId", c.sessionId)
            put("model", c.model); put("effort", c.effort); put("permissionMode", c.permissionMode)
        }
    }

    // Nachricht an Claude: Text, optional mit Bildern (base64-JPEG). Ohne Text steht ein fester englischer Hinweis
    // im Inhalt, den Claude liest (wie in Swapline am PC).
    suspend fun send(c: Chat, text: String, images: List<String> = emptyList(), docs: List<Pair<String, String>> = emptyList()): Boolean {
        val h = host(c.hostId) ?: return false
        c.addOwn(text, images.size, docs.map { it.first })
        updateLive(c)
        // Dokumente zuerst auf den Haupt-PC (je bis 25 MB, über Mobilfunk evtl. langsam) – Claude bekommt die Pfade
        val paths = mutableListOf<String>()
        for ((name, data) in docs) {
            val r = runCatching { h.callWithin(10 * 60_000L, "files:upload", buildJsonObject { put("name", name); put("data", data) }) }
            val p = (r.getOrNull() as? JsonObject)?.str("path")
            if (p == null) {
                c.running = false
                val why = r.exceptionOrNull()?.message.orEmpty()
                c.ingest(buildJsonObject { put("type", "app_error"); put("message", de.arfep.swapline.ui.tr("„$name“ konnte nicht übertragen werden", "“$name” could not be transferred", "“$name” aktarılamadı") + (if (why.isNotEmpty()) ": $why" else "") +
                    de.arfep.swapline.ui.tr(" (Dokumente brauchen Swapline am PC ab 0.10.0)", " (documents need Swapline on the PC 0.10.0 or later)")) })
                saveChats()
                return false
            }
            paths += p
        }
        val content = messageContent(text, images, paths)
        val ok = runCatching { h.call("session:send", buildJsonObject { put("tab", tabJson(c)); put("content", content) }) }
        val sent = ok.getOrNull().let { it is JsonPrimitive && it.booleanOrNull == true }
        if (!sent) {
            c.running = false
            c.ingest(buildJsonObject { put("type", "app_error"); put("message", ok.exceptionOrNull()?.message ?: "") })
        } else if (c.mirror) c.attached = true
        saveChats()
        return sent
    }

    fun respond(c: Chat, item: Item, response: JsonObject, answer: Answer) = scope.launch {
        val h = host(c.hostId) ?: return@launch
        val rid = requestIdOf(item) ?: return@launch
        val r = runCatching { h.call("session:respond", buildJsonObject { put("tabId", c.id); put("requestId", rid); put("response", response) }) }.getOrNull()
        if (r is JsonPrimitive && r.booleanOrNull == true) { c.setAnswer(item, answer); updateLive(c) }
    }

    fun allow(c: Chat, p: Item.Perm, always: Boolean) = respond(c, p, buildJsonObject {
        put("behavior", "allow"); put("updatedInput", p.input)
        if (always && p.suggestions != null) put("updatedPermissions", p.suggestions)
    }, Answer(if (always) AnswerKind.ALWAYS else AnswerKind.ALLOWED))

    fun deny(c: Chat, item: Item, message: String, answer: Answer) = respond(c, item, buildJsonObject { put("behavior", "deny"); put("message", message) }, answer)

    fun answerQuestion(c: Chat, q: Item.Question, answers: Map<String, String>) = respond(c, q, buildJsonObject {
        put("behavior", "allow")
        put("updatedInput", JsonObject(q.input + ("answers" to JsonObject(answers.mapValues { JsonPrimitive(it.value) }))))
    }, Answer(AnswerKind.ANSWERED, answers.entries.joinToString("\n") { "${it.key} → ${it.value}" }))

    fun acceptPlan(c: Chat, p: Item.Plan) = scope.launch {
        respond(c, p, buildJsonObject { put("behavior", "allow"); put("updatedInput", p.input) }, Answer(AnswerKind.PLAN_ACCEPTED)).join()
        if (!c.mirror) { c.permissionMode = "default"; saveChats() }
    }

    // Ausgabe einer Hintergrund-Aufgabe (letzte 64 KB, vom Haupt-PC geprüft: nur von Claude gemeldete Ausgabedateien)
    suspend fun taskOutput(c: Chat, file: String): String {
        val h = host(c.hostId) ?: return ""
        val r = runCatching { h.call("task:readOutput", JsonPrimitive(file)) }
        val o = r.getOrNull() as? JsonObject ?: return r.exceptionOrNull()?.message ?: ""
        return o.str("error") ?: (o.str("text").orEmpty().ifEmpty { de.arfep.swapline.ui.tr("(noch keine Ausgabe)", "(no output yet)") } +
            if ((o["truncated"] as? JsonPrimitive)?.booleanOrNull == true) de.arfep.swapline.ui.tr("\n… (gekürzt, letzte 64 KB)", "\n… (truncated, last 64 KB)") else "")
    }

    // „!befehl“: am Haupt-PC im Ordner des Chats ausführen (Haupt-PC erlaubt das nur mit der Freigabe „Alles erlauben“)
    suspend fun runBang(c: Chat, command: String): Boolean {
        val h = host(c.hostId) ?: return false
        if (command.isBlank()) return false
        if (c.title.isBlank()) c.title = ("!" + command).replace(Regex("\\s+"), " ").take(60)
        val r = runCatching { h.call("session:bash", buildJsonObject { put("tab", tabJson(c)); put("command", command) }) }
        val v = r.getOrNull()
        val ok = v is JsonPrimitive && v.booleanOrNull == true
        if (!ok) c.ingest(buildJsonObject { put("type", "app_error"); put("message", r.exceptionOrNull()?.message ?: (v as? JsonObject)?.str("error")
            ?: de.arfep.swapline.ui.tr("Befehl nicht ausgeführt", "Command not run")) })
        else if (c.mirror) c.attached = true
        saveChats()
        return ok
    }

    fun bashStop(c: Chat) = scope.launch { runCatching { host(c.hostId)?.call("session:bashStop", JsonPrimitive(c.id)) } }

    // Ältere Nachrichten des Chats vom Haupt-PC nachladen (vor die angezeigten)
    fun loadOlder(c: Chat) = scope.launch {
        val from = c.olderFrom ?: return@launch
        if (c.loadingOlder) return@launch
        val h = host(c.hostId) ?: return@launch
        c.loadingOlder = true
        val r = runCatching { h.call("history:loadSession", buildJsonObject {
            put("profileId", c.profileId); put("sessionId", c.sessionId); put("cwd", c.cwd); put("turns", OLDER_TURNS); put("before", from)
        }) }.getOrNull() as? JsonObject
        val msgs = r?.get("msgs") as? JsonArray
        if (msgs != null) {
            c.prependHistory(msgs)
            c.olderFrom = (r["start"] as? JsonPrimitive)?.content?.toIntOrNull()?.takeIf { it > 0 }
            c.loadedTurns += OLDER_TURNS
        }
        c.loadingOlder = false
    }

    // Bild für die Anzeige im Chat: Datei vom Haupt-PC (relativ zum Ordner des Chats) oder aus dem Internet (nur auf Tippen)
    private val imageCache = object : LinkedHashMap<String, androidx.compose.ui.graphics.ImageBitmap>(32, 0.75f, true) {
        override fun removeEldestEntry(e: MutableMap.MutableEntry<String, androidx.compose.ui.graphics.ImageBitmap>?) = size > 30
    }
    suspend fun loadImage(c: Chat, src: String, web: Boolean): Pair<androidx.compose.ui.graphics.ImageBitmap?, String?> {
        val key = c.hostId + "|" + c.cwd + "|" + src
        synchronized(imageCache) { imageCache[key] }?.let { return it to null }
        val h = host(c.hostId) ?: return null to de.arfep.swapline.ui.tr("nicht verbunden", "not connected")
        val r = runCatching {
            if (web) h.callWithin(60_000L, "web:image", JsonPrimitive(src))
            else h.call("files:image", buildJsonObject { put("cwd", c.cwd); put("path", src) })
        }
        val o = r.getOrNull() as? JsonObject ?: return null to (r.exceptionOrNull()?.message ?: de.arfep.swapline.ui.tr("nicht verfügbar", "not available"))
        val data = o.str("data") ?: return null to o.str("error")
        val bmp = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Default) { de.arfep.swapline.ui.decodeImage(data) } ?: return null to null
        synchronized(imageCache) { imageCache[key] = bmp }
        return bmp to null
    }

    fun interrupt(c: Chat) = scope.launch { runCatching { host(c.hostId)?.call("session:interrupt", JsonPrimitive(c.id)) } }

    // Eigener Chat: Claude-Prozess am Haupt-PC beenden. Beigetretener Chat: nur austreten, er läuft am Haupt-PC weiter.
    fun close(c: Chat) = scope.launch {
        runCatching { host(c.hostId)?.call("session:close", JsonPrimitive(c.id)) }
        chats.remove(c)
        if (visibleChatId == c.id) visibleChatId = null
        notifier.clear(c)
        saveChats()
    }

    // Einstellungen eines eigenen Chats ändern: Prozess am Haupt-PC beenden, nächste Nachricht startet mit --resume neu
    fun changeSettings(c: Chat, model: String, effort: String, mode: String) = scope.launch {
        if (c.mirror) return@launch
        c.model = model; c.effort = effort; c.permissionMode = mode
        saveChats()
        runCatching { host(c.hostId)?.call("session:restart", JsonPrimitive(c.id)) }
    }

    // Netz gewechselt (z. B. WLAN → Mobilfunk): bestehende Verbindungen laufen über das alte Netz ins Leere – neu verbinden
    fun networkChanged() { for (h in hosts) connect(h) }

    fun reconnectAll() { for (h in hosts) if (h.state == LinkState.RECONNECTING || h.state == LinkState.OFF) connect(h) }
}
