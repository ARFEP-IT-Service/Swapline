// Gekoppelte Haupt-PCs und was das Handy von ihnen sieht (Antwort von store:get, offene Chats, Verlauf).
// Alle Angaben kommen vom Haupt-PC und werden hier nur gelesen und gekürzt, nie ausgeführt.
package de.arfep.swapline.model

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import de.arfep.swapline.net.HostLink
import de.arfep.swapline.net.LinkState
import de.arfep.swapline.net.str
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

data class HostRecord(
    val id: String,
    val name: String,
    val address: String,
    val port: Int,
    val deviceId: String,
    val keyEnc: String,      // Geräteschlüssel, mit dem Android Keystore verschlüsselt
    val hostName: String,
    val color: String = "#1581FF",
    val relay: String = "",        // Vermittler: Adresse|Port|hostId (leer = keiner)
    val relayKeyEnc: String = "",  // dialKey, mit dem Android Keystore verschlüsselt
) {
    fun toJson() = buildJsonObject {
        put("id", id); put("name", name); put("address", address); put("port", port)
        put("deviceId", deviceId); put("keyEnc", keyEnc); put("hostName", hostName); put("color", color); put("relay", relay); put("relayKeyEnc", relayKeyEnc)
    }

    companion object {
        fun from(o: JsonObject): HostRecord? = runCatching {
            HostRecord(o.str("id")!!, o.str("name")!!, o.str("address")!!, o.getValue("port").jsonPrimitive.int, o.str("deviceId")!!, o.str("keyEnc")!!, o.str("hostName").orEmpty(), o.str("color") ?: "#1581FF", o.str("relay").orEmpty(), o.str("relayKeyEnc").orEmpty())
        }.getOrNull()
    }
}

data class Profile(val id: String, val name: String, val color: String, val isDefault: Boolean)
data class Project(val id: String, val name: String, val color: String, val cwd: String, val groupId: String?)
data class Group(val id: String, val name: String, val color: String)
// projectId: Projekt des Chats am Haupt-PC (auch per Ziehen zugeordnet), sonst null
data class OpenTab(val id: String, val title: String, val profileId: String, val cwd: String, val sessionId: String?, val model: String, val effort: String, val permissionMode: String, val running: Boolean, val updated: Long, val preview: String, val projectId: String? = null)
data class HistoryEntry(val sessionId: String, val title: String, val cwd: String, val mtime: Long)
data class ModelOpt(val value: String, val name: String, val description: String)
// /-Befehle und Skills eines Kontos (vom Haupt-PC, wie die Auswahl im Eingabefeld am PC)
data class CmdOpt(val name: String, val description: String, val hint: String)
// SSH-Server des Haupt-PCs (nur mit Freigabe „SSH-Server“ am PC) – Chats laufen über den Haupt-PC
data class ServerRef(val id: String, val name: String, val color: String)

data class HostStore(
    val profiles: List<Profile>,
    val activeProfileId: String?,
    val projects: List<Project>,
    val groups: List<Group>,
    val model: String,
    val effort: String,
    val permissionMode: String,
    val allowedFolders: List<String>,
    val hostName: String,
    val hostVersion: String,
    val allowBypass: Boolean,
    val newChats: Boolean,
    val reach: List<String> = emptyList(),   // Adressen, unter denen der Haupt-PC erreichbar ist (geprüft)
    val relay: de.arfep.swapline.net.RelayRoute? = null, // Vermittler (falls am PC eingerichtet)
    val servers: List<ServerRef> = emptyList(),
)

private fun JsonObject.s(k: String, max: Int = 500) = (str(k) ?: "").take(max)
private fun JsonObject.b(k: String) = (this[k] as? JsonPrimitive)?.booleanOrNull == true
private fun JsonObject.n(k: String) = (this[k] as? JsonPrimitive)?.doubleOrNull?.toLong() ?: 0L
private fun JsonElement?.objects(): List<JsonObject> = (this as? JsonArray)?.mapNotNull { it as? JsonObject }.orEmpty()
private val COLOR = Regex("^#[0-9a-fA-F]{6}$")
private fun color(v: String) = if (COLOR.matches(v)) v else "#1581FF"
private val UUID = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", RegexOption.IGNORE_CASE)
private val PROJECT_ID = Regex("^[A-Za-z0-9_-]{1,80}$")

object Parse {
    fun store(e: JsonElement?): HostStore? {
        val o = e as? JsonObject ?: return null
        val settings = o["settings"] as? JsonObject
        return HostStore(
            profiles = o["profiles"].objects().map { Profile(it.s("id", 80), it.s("name", 60).ifBlank { "?" }, color(it.s("color", 7)), it.b("isDefault")) }.filter { it.id.isNotEmpty() },
            activeProfileId = o.str("activeProfileId"),
            projects = o["projects"].objects().map { Project(it.s("id", 80), it.s("name", 60).ifBlank { "?" }, color(it.s("color", 7)), it.s("cwd"), it.str("groupId")) }.filter { it.id.isNotEmpty() },
            groups = o["projectGroups"].objects().map { Group(it.s("id", 80), it.s("name", 60), color(it.s("color", 7))) },
            model = settings?.s("model", 80).orEmpty(),
            effort = settings?.s("effort", 20).orEmpty(),
            permissionMode = settings?.str("permissionMode") ?: "default",
            allowedFolders = (o["allowedFolders"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content?.take(500) }.orEmpty(),
            hostName = o.s("hostName", 40),
            hostVersion = o.s("hostVersion", 20),
            allowBypass = o.b("allowBypass"),
            newChats = (o["scope"] as? JsonObject)?.let { (it["newChats"] as? JsonPrimitive)?.booleanOrNull } ?: true,
            reach = ((o["reach"] as? JsonObject)?.get("addresses") as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content }
                ?.filter { de.arfep.swapline.net.PairLinks.validAddress(it) }?.take(6).orEmpty(),
            relay = ((o["reach"] as? JsonObject)?.get("relay") as? JsonObject)?.let { r ->
                val a = r.str("address"); val p = (r["port"] as? JsonPrimitive)?.content?.toIntOrNull(); val h = r.str("hostId"); val k = r.str("dialKey")
                if (a != null && de.arfep.swapline.net.PairLinks.validAddress(a) && p != null && p in 1..65535 && h != null && Regex("^[0-9a-f]{16}$").matches(h) && k != null && Regex("^[0-9a-f]{64}$").matches(k))
                    de.arfep.swapline.net.RelayRoute(a, p, h, k) else null
            },
            servers = o["servers"].objects().mapNotNull {
                val id = it.str("id")?.takeIf { s -> Regex("^[A-Za-z0-9_-]{1,40}$").matches(s) } ?: return@mapNotNull null
                ServerRef(id, it.s("name", 40).ifBlank { "Server" }, color(it.s("color", 7)))
            }.take(20),
        )
    }

    fun openTabs(e: JsonElement?): List<OpenTab> = e.objects().take(200).mapNotNull {
        val id = it.s("id", 40)
        if (id.isEmpty()) null else OpenTab(id, it.s("title", 200), it.s("profileId", 80), it.s("cwd"), it.str("sessionId")?.takeIf { s -> UUID.matches(s) },
            it.s("model", 80), it.s("effort", 20), it.str("permissionMode") ?: "default", it.b("running"), it.n("updated"), it.s("preview", 200),
            it.str("projectId")?.takeIf { p -> PROJECT_ID.matches(p) })
    }

    fun history(e: JsonElement?): List<HistoryEntry> = e.objects().mapNotNull {
        val sid = it.str("sessionId")?.takeIf { s -> UUID.matches(s) } ?: return@mapNotNull null
        HistoryEntry(sid, it.s("title", 200), it.s("cwd"), it.n("mtime"))
    }

    fun commands(e: JsonElement?): List<CmdOpt> = ((e as? JsonObject)?.get("commands")).objects().mapNotNull {
        val n = it.str("name")?.takeIf { s -> Regex("^[A-Za-z0-9:_.-]{1,80}$").matches(s) } ?: return@mapNotNull null
        CmdOpt(n, it.s("description", 200), it.s("argumentHint", 80))
    }.take(300)

    fun models(e: JsonElement?): List<ModelOpt> = ((e as? JsonObject)?.get("models")).objects().mapNotNull {
        val v = it.str("value") ?: return@mapNotNull null
        ModelOpt(v.take(80), (it.str("displayName") ?: v).take(80), it.s("description", 200))
    }
}

// parent/serverId: SSH-Server eines Haupt-PCs – eigener Eintrag in der App, alle Aufrufe gehen als „server:call“ über
// die Verbindung des Haupt-PCs
class HostState(record: HostRecord, val parent: HostState? = null, val serverId: String? = null) {
    var record by mutableStateOf(record)
    var state by mutableStateOf(LinkState.OFF)
    var error by mutableStateOf<String?>(null)
    var store by mutableStateOf<HostStore?>(null)
    var openTabs by mutableStateOf<List<OpenTab>>(emptyList())
    var history by mutableStateOf<List<HistoryEntry>>(emptyList())
    var historyLoading by mutableStateOf(false)
    var profileId by mutableStateOf<String?>(null)      // gewähltes Konto für Verlauf und neue Chats (nur auf dem Handy)
    var projectFilter by mutableStateOf<String?>(null)  // Projekt-ID oder null = alle
    val models = HashMap<String, List<ModelOpt>>()
    val commands = HashMap<String, List<CmdOpt>>()
    lateinit var link: HostLink

    val connected get() = (parent?.state ?: state) == LinkState.CONNECTED
    val id get() = record.id

    suspend fun call(ch: String, vararg args: JsonElement): JsonElement =
        if (serverId == null) link.call(ch, *args) else link.call("server:call", serverArgs(ch, args))
    suspend fun callWithin(timeout: Long, ch: String, vararg args: JsonElement): JsonElement =
        if (serverId == null) link.callWithin(timeout, ch, *args) else link.callWithin(timeout, "server:call", serverArgs(ch, args))
    private fun serverArgs(ch: String, args: Array<out JsonElement>) = buildJsonObject {
        put("server", serverId); put("ch", ch); put("args", JsonArray(args.toList()))
    }
}

// Liegt ein Ordner im Projektordner (auch Unterordner)? Windows-Pfade ohne Groß-/Kleinschreibung
fun within(cwd: String, folder: String): Boolean {
    if (folder.isEmpty() || cwd.isEmpty()) return false
    val a = cwd.replace('\\', '/').trimEnd('/').lowercase()
    val b = folder.replace('\\', '/').trimEnd('/').lowercase()
    return a == b || a.startsWith("$b/")
}

fun JsonElement.objOrNull(): JsonObject? = runCatching { jsonObject }.getOrNull()
