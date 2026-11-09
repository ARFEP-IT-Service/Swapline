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
}

class AppModel(context: Context, private val notifier: Notifier) {
    private val prefs = context.getSharedPreferences("swapline", Context.MODE_PRIVATE)
    // Fehler in einzelnen Aufgaben (Verbindung, Anfragen) beenden nie die App
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate + CoroutineExceptionHandler { _, e -> android.util.Log.w("Swapline", "Fehler im Hintergrund", e) })

    val hosts = mutableStateListOf<HostState>()
    val chats = mutableStateListOf<Chat>()
    var visibleChatId by mutableStateOf<String?>(null)
    var foreground = false
    var update by mutableStateOf<Update?>(null)

    // Einstellungen (nur auf dem Handy)
    var micEnabled by mutableStateOf(prefs.getBoolean("micEnabled", true))
        private set
    var onDeviceOnly by mutableStateOf(prefs.getBoolean("onDeviceOnly", false))
        private set
    fun changeMic(on: Boolean) { micEnabled = on; prefs.edit().putBoolean("micEnabled", on).apply() }
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

    fun host(id: String) = hosts.firstOrNull { it.id == id }
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
        h.link.use(Target(h.record.address, h.record.port, h.record.deviceId, key))
    }

    // Mehrere Adressen (aus dem QR-Code): der Reihe nach probieren; nicht erreichbare kosten den Einmal-Code nicht
    suspend fun pairHost(addresses: List<String>, port: Int, code: String): HostState {
        var last: Exception? = null
        for (address in addresses.map { it.trim() }.filter { it.isNotEmpty() }) {
            val p = try { pair(address, port, code, deviceName, if (addresses.size > 1) 4_000 else 15_000) }
            catch (e: LinkException) { if (e.reason == "unreachable") { last = e; continue } else throw e }
            // alle Adressen merken (die erreichbare zuerst) – unterwegs z. B. die öffentliche IP
            val all = (listOf(address) + addresses.map { it.trim() }.filter { it.isNotEmpty() && it != address }).take(8)
            val rec = HostRecord(newId(8), p.hostName.ifBlank { address }, all.joinToString(","), port, p.deviceId, Vault.encrypt(p.key), p.hostName)
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
        chats.removeAll { it.hostId == h.id }
        hosts.remove(h)
        saveHosts(); saveChats()
    }

    private fun onState(h: HostState, s: LinkState, detail: String?) {
        h.state = s
        if (s == LinkState.CONNECTED) { h.error = null; refresh(h) }
        else if (detail != null) h.error = detail
    }

    private fun onEvent(h: HostState, kind: String, data: JsonElement) {
        when (kind) {
            "claude" -> {
                val o = data as? JsonObject ?: return
                val chat = chats.firstOrNull { it.hostId == h.id && it.id == o.str("tabId") } ?: return
                val msg = o["msg"] as? JsonObject ?: return
                val notice = chat.ingest(msg)
                if (notice != null) {
                    if (msg.str("type") == "result" || notice != Notice.DONE) saveChats()
                    if (visibleChatId != chat.id || !foreground) { chat.unread = true; notifier.notify(chat, h, notice) }
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

    fun refresh(h: HostState) = scope.launch {
        for (c in chats) if (c.hostId == h.id && c.mirror) c.attached = false // nach (Wieder-)Verbindung neu beitreten
        runCatching { setOpenTabs(h, Parse.openTabs(h.link.call("tabs:list"))) }
        refreshStore(h).join()
        loadHistory(h)
        chat(visibleChatId ?: "")?.takeIf { it.hostId == h.id }?.let { open(it) }
    }

    private fun refreshStore(h: HostState) = scope.launch {
        val st = runCatching { Parse.store(h.link.call("store:get")) }.getOrNull() ?: return@launch
        h.store = st
        // Adressen vom Haupt-PC (Heimnetz, öffentliche IP …) übernehmen; selbst eingetragene bleiben dahinter erhalten
        if (st.reach.isNotEmpty()) {
            val own = h.record.address.split(',').map { it.trim() }.filter { it.isNotEmpty() }
            val merged = (st.reach + own.filter { it !in st.reach }).distinct().take(8).joinToString(",")
            if (merged != h.record.address) { h.record = h.record.copy(address = merged); saveHosts() }
        }
        if (h.profileId == null || st.profiles.none { it.id == h.profileId }) h.profileId = st.activeProfileId ?: st.profiles.firstOrNull()?.id
        if (h.projectFilter != null && st.projects.none { it.id == h.projectFilter }) h.projectFilter = null
    }

    fun loadHistory(h: HostState) = scope.launch {
        val pid = h.profileId ?: return@launch
        h.historyLoading = true
        h.history = runCatching { Parse.history(h.link.call("history:list", JsonPrimitive(pid))) }.getOrDefault(h.history)
        h.historyLoading = false
    }

    suspend fun models(h: HostState, profileId: String): List<ModelOpt> =
        h.models[profileId] ?: runCatching { Parse.models(h.link.call("profiles:models", buildJsonObject { put("id", profileId) })) }.getOrDefault(emptyList())
            .also { if (it.isNotEmpty()) h.models[profileId] = it }

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
        c.unread = false
        notifier.clear(c)
        val h = host(c.hostId) ?: return@launch
        if (!h.connected) return@launch
        if (c.mirror && !c.attached) {
            val r = runCatching { h.link.call("session:attach", buildJsonObject { put("tabId", c.id); put("hostTab", c.hostTab) }) }.getOrNull()
            if (r is JsonObject) { c.attached = true; c.running = (r["running"] as? JsonPrimitive)?.booleanOrNull == true }
        }
        if (!c.loaded && c.sessionId != null) {
            c.loaded = true
            val msgs = runCatching { h.link.call("history:loadSession", buildJsonObject { put("profileId", c.profileId); put("sessionId", c.sessionId); put("cwd", c.cwd) }) }.getOrNull()
            (msgs as? JsonArray)?.let { c.loadHistory(it) }
        }
    }

    private fun tabJson(c: Chat) = buildJsonObject {
        put("id", c.id)
        if (c.mirror) put("hostTab", c.hostTab)
        else {
            put("profileId", c.profileId); put("cwd", c.cwd); put("sessionId", c.sessionId)
            put("model", c.model); put("effort", c.effort); put("permissionMode", c.permissionMode)
        }
    }

    suspend fun send(c: Chat, text: String): Boolean {
        val h = host(c.hostId) ?: return false
        c.addOwn(text)
        val ok = runCatching { h.link.call("session:send", buildJsonObject { put("tab", tabJson(c)); put("content", text) }) }
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
        val r = runCatching { h.link.call("session:respond", buildJsonObject { put("tabId", c.id); put("requestId", rid); put("response", response) }) }.getOrNull()
        if (r is JsonPrimitive && r.booleanOrNull == true) c.setAnswer(item, answer)
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

    fun interrupt(c: Chat) = scope.launch { runCatching { host(c.hostId)?.link?.call("session:interrupt", JsonPrimitive(c.id)) } }

    // Eigener Chat: Claude-Prozess am Haupt-PC beenden. Beigetretener Chat: nur austreten, er läuft am Haupt-PC weiter.
    fun close(c: Chat) = scope.launch {
        runCatching { host(c.hostId)?.link?.call("session:close", JsonPrimitive(c.id)) }
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
        runCatching { host(c.hostId)?.link?.call("session:restart", JsonPrimitive(c.id)) }
    }

    fun reconnectAll() { for (h in hosts) if (h.state == LinkState.RECONNECTING || h.state == LinkState.OFF) connect(h) }
}
