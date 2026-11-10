// Ein Chat auf einem Haupt-PC und die Verarbeitung der Claude-Code-Nachrichten (stream-json),
// wie ingest() in src/renderer/app.js. Claude läuft immer auf dem Haupt-PC; hier wird nur angezeigt.
package de.arfep.swapline.model

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import de.arfep.swapline.net.str
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import java.time.Instant

enum class AnswerKind { ALLOWED, ALWAYS, DENIED, PLAN_ACCEPTED, PLAN_REVISE, PLAN_REJECTED, ANSWERED, SKIPPED, ANSWERED_ELSEWHERE, DENIED_ELSEWHERE }
data class Answer(val kind: AnswerKind, val detail: String = "")

sealed class Item {
    data class Me(val text: String, val time: Long?, val from: String = "", val images: Int = 0, val files: List<String> = emptyList()) : Item()
    data class Ai(val text: String, val time: Long?, val streaming: Boolean = false) : Item()
    data class Tool(val id: String, val name: String, val input: JsonElement, val result: String? = null, val isError: Boolean = false, val images: List<String> = emptyList()) : Item()
    data class Perm(val requestId: String, val toolName: String, val input: JsonElement, val description: String, val suggestions: JsonElement?, val answer: Answer? = null) : Item()
    data class Question(val requestId: String, val input: JsonObject, val answer: Answer? = null) : Item()
    data class Plan(val requestId: String, val input: JsonObject, val answer: Answer? = null) : Item()
    data class Recap(val text: String) : Item()
    data class Sys(val text: String, val error: Boolean = false, val code: SysCode = SysCode.TEXT) : Item()
    data class Result(val ok: Boolean, val seconds: Double, val cost: Double?, val model: String) : Item()
    // „!befehl“: direkt am Haupt-PC ausgeführt (ohne Claude); Claude bekommt die Ausgabe mit der nächsten Nachricht
    data class Bash(val id: String, val command: String, val running: Boolean, val output: String = "", val code: Int = 0, val from: String = "", val time: Long? = null) : Item()
}

// Hintergrund-Aufgabe (z. B. Befehl mit run_in_background, Agent im Hintergrund) – gemeldet von Claude Code
data class BgTask(
    val id: String, val desc: String = "", val type: String = "", val status: String = "running",
    val start: Long = System.currentTimeMillis(), val end: Long? = null, val summary: String = "",
    val output: String? = null, val toolUseId: String? = null,
) { val running get() = status == "running" }

// Was Claude in einem Chat gerade tut (für den Live-Status in der Benachrichtigung)
enum class ActKind { NONE, THINKING, WRITING, TOOL, WAITING, BACKGROUND }
data class Activity(val kind: ActKind, val tool: String = "", val detail: String = "")

// Feste Hinweise, deren Text die Oberfläche übersetzt
enum class SysCode { TEXT, COMPACTED, HISTORY_ABOVE, EXITED }

// Was beim Eintreffen einer Nachricht gemeldet werden soll (Benachrichtigung, wenn der Chat nicht sichtbar ist)
enum class Notice { DONE, ERROR, PERMISSION, QUESTION, PLAN }

// Feste Texte, die Claude liest: immer Englisch (wie CLAUDE_TEXT in app.js)
object ClaudeText {
    const val DENIED = "The user declined this action."
    const val PLAN_REVISE = "Please revise the plan: "
    const val PLAN_REJECTED = "The user rejected the plan."
    const val QUESTION_SKIPPED = "The user does not want to answer the question."
    const val SEE_IMAGE = "See attached image."
    const val SEE_IMAGES = "See attached images."
    const val SEE_FILE = "See attached file."
    const val ATTACHED_FILES = "Attached files:"
    const val SUMMARY = "Summarize this conversation so far for me, in the language I have been writing in. Use Markdown with these sections: " +
        "Goal; What was done (key steps and decisions); Changed files (paths); Commands and tests run, with results; Open points and next steps. " +
        "Be concise. Do not use any tools and do not change anything for this."
}

// Verlauf in Seiten: beim Öffnen die letzten 3 eigenen Nachrichten samt Antworten, „Ältere Nachrichten laden“ je 5 weitere
const val HISTORY_TURNS = 3
const val OLDER_TURNS = 5

private val BASH_RE = Regex("^\\s*(?:<bash-input>([\\s\\S]*?)</bash-input>)?\\s*(?:<bash-stdout>([\\s\\S]*?)</bash-stdout>)?\\s*(?:<bash-stderr>([\\s\\S]*?)</bash-stderr>)?")
private fun unescTag(s: String) = s.replace(Regex("<\\\\/(bash-[a-z]+)>"), "</$1>")

private fun hiddenUserText(s: String) =
    s.isBlank() || Regex("^\\s*<(command-|local-command|system-reminder|bash-|user-memory|task-notification)").containsMatchIn(s) || s.startsWith("[Request interrupted")

fun textOf(content: JsonElement?): String = when (content) {
    is JsonPrimitive -> if (content.isString) content.content else ""
    is JsonArray -> content.joinToString("\n") { b ->
        val o = b as? JsonObject
        when (o?.str("type")) { "text" -> o.str("text") ?: ""; "image" -> "[image]"; else -> "" }
    }
    else -> ""
}

private fun JsonObject.obj(k: String) = this[k] as? JsonObject
private fun JsonObject.arr(k: String) = this[k] as? JsonArray
private fun JsonObject.bool(k: String) = (this[k] as? JsonPrimitive)?.booleanOrNull == true
private fun timeOf(m: JsonObject): Long? = m.str("timestamp")?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }

class Chat(
    val id: String,                 // ID dieses Chats auf dem Handy (6–23 Zeichen a-z0-9)
    val hostId: String,             // gekoppelter Haupt-PC
    val hostTab: String?,           // offener Chat am Haupt-PC, dem dieser Chat beitritt (sonst eigener Claude-Prozess)
    var profileId: String,
    var cwd: String,
    sessionId: String?,
    var model: String = "",
    var effort: String = "",
    var permissionMode: String = "default",
    title: String = "",
) {
    val items = mutableStateListOf<Item>()
    var sessionId by mutableStateOf(sessionId)
    var title by mutableStateOf(title)
    var preview by mutableStateOf("")
    var running by mutableStateOf(false)
    var unread by mutableStateOf(false)
    var updated by mutableStateOf(0L)
    var modelName by mutableStateOf("")
    var attached = false
    var loaded = false
    // Verbindung war unterbrochen: Ereignisse in der Zwischenzeit sind verloren – beim nächsten Öffnen neu laden
    var stale = false
    // Verlauf in Seiten: ab dieser Stelle der Sitzungsdatei gibt es ältere Nachrichten (null = alles geladen)
    var olderFrom by mutableStateOf<Int?>(null)
    var loadingOlder by mutableStateOf(false)
    // so viele eigene Nachrichten sind geladen (für das Neuladen nach einer Unterbrechung)
    var loadedTurns = HISTORY_TURNS
    // Hintergrund-Aufgaben dieses Chats (Leiste über dem Eingabefeld)
    val tasks = androidx.compose.runtime.mutableStateMapOf<String, BgTask>()
    val tasksRunning get() = tasks.values.any { it.running }

    // Live-Status: aktueller Schritt und seit wann Claude an dieser Antwort arbeitet
    var activity by mutableStateOf(Activity(ActKind.NONE))
        private set
    var activeSince = 0L
        private set
    private fun changeActivity(a: Activity) {
        if (activity.kind == ActKind.NONE && a.kind != ActKind.NONE) activeSince = System.currentTimeMillis()
        activity = a
    }
    private fun idleOrBackground() = changeActivity(if (tasksRunning) Activity(ActKind.BACKGROUND) else Activity(ActKind.NONE))

    private fun trackActivity(m: JsonObject) {
        when (m.str("type")) {
            "swapline_user" -> changeActivity(Activity(ActKind.THINKING))
            "swapline_answered" -> if (running) changeActivity(Activity(ActKind.THINKING))
            "stream_event" -> {
                if (m["parent_tool_use_id"].let { it != null && it !is JsonNull }) return
                val d = m.obj("event")?.obj("delta")
                if (d?.str("type") == "text_delta") changeActivity(Activity(ActKind.WRITING))
            }
            "assistant" -> {
                if (m["parent_tool_use_id"].let { it != null && it !is JsonNull }) return
                val last = m.obj("message")?.arr("content")?.lastOrNull { (it as? JsonObject)?.str("type") == "tool_use" } as? JsonObject
                val name = last?.str("name")
                if (name != null && name != "AskUserQuestion") changeActivity(Activity(ActKind.TOOL, name, toolSummary(name, last["input"] ?: JsonNull)))
            }
            "user" -> if (running && activity.kind == ActKind.TOOL) changeActivity(Activity(ActKind.THINKING))
            "control_request" -> {
                val r = m.obj("request")
                if (r?.str("subtype") == "can_use_tool") changeActivity(Activity(ActKind.WAITING, r.str("tool_name").orEmpty()))
            }
            "result", "app_error", "app_exit" -> idleOrBackground()
            "system" -> if (!running && (m.str("subtype")?.startsWith("task_") == true || m.str("subtype") == "background_tasks_changed")) idleOrBackground()
        }
    }

    private fun trackTask(m: JsonObject) {
        if (m.str("subtype") == "background_tasks_changed") {
            // Liste der laufenden Aufgaben: alles, was nicht mehr drin ist, gilt als beendet
            val list = (m["tasks"] as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }
            val ids = list.mapNotNull { it.str("task_id") }.toSet()
            for (x in list) { val id = x.str("task_id") ?: continue; if (id !in tasks) tasks[id] = BgTask(id, x.str("description").orEmpty(), x.str("task_type").orEmpty()) }
            for ((id, t) in tasks.toMap()) if (t.running && id !in ids) tasks[id] = t.copy(status = "completed", end = System.currentTimeMillis())
            return
        }
        val id = m.str("task_id") ?: return
        var t = tasks[id] ?: BgTask(id)
        m.str("description")?.let { t = t.copy(desc = it) }
        m.str("task_type")?.let { t = t.copy(type = it) }
        m.str("tool_use_id")?.let { t = t.copy(toolUseId = it) }
        when (m.str("subtype")) {
            "task_updated" -> (m["patch"] as? JsonObject)?.str("status")?.let { t = t.copy(status = it, end = if (it != "running") System.currentTimeMillis() else null) }
            "task_notification" -> t = t.copy(status = m.str("status") ?: t.status, summary = m.str("summary").orEmpty(),
                output = m.str("output_file") ?: t.output, end = t.end ?: System.currentTimeMillis())
        }
        tasks[id] = t
    }

    // Erfolgreich beendete Aufgaben nach ein paar Sekunden aus der Leiste nehmen – fehlgeschlagene bleiben
    fun pruneTasks(now: Long = System.currentTimeMillis()) {
        for ((id, t) in tasks.toMap()) if (t.status == "completed" && (t.end ?: now) + 4_000 <= now) tasks.remove(id)
    }
    fun clearFinishedTasks() { for ((id, t) in tasks.toMap()) if (!t.running) tasks.remove(id) }
    private var stream: Item.Ai? = null

    val mirror get() = hostTab != null

    private fun add(it: Item) { items.add(it) }

    // „!“-Befehle im Verlauf (von Swapline oder der Claude CLI): <bash-input>…</bash-input> und <bash-stdout>…</bash-stdout>
    // am Textanfang werden zu Befehls-Karten; zurück kommt der übrige Text
    private fun takeBash(text: String, time: Long?): String {
        var rest = text
        for (i in 0 until 20) {
            val m = BASH_RE.find(rest) ?: break
            if (m.value.isBlank()) break
            val cmd = m.groups[1]?.value
            val err = m.groups[3]?.value.orEmpty()
            val out = listOfNotNull(m.groups[2]?.value, m.groups[3]?.value).filter { it.isNotBlank() }.joinToString("\n") { unescTag(it) }
            val last = items.lastOrNull()
            if (cmd == null && last is Item.Bash && last.output.isEmpty()) replace(last, last.copy(output = out)) // CLI: Ausgabe als eigene Nachricht
            else add(Item.Bash("h$i-${time ?: 0}", unescTag(cmd.orEmpty()), false, out, Regex("exit code (\\d+)").find(err)?.groupValues?.get(1)?.toIntOrNull() ?: 0, "", time))
            rest = rest.substring(m.value.length)
        }
        return rest
    }
    // Elemente werden nur angehängt oder an ihrer Stelle ersetzt – die Position bleibt der Schlüssel für die Anzeige
    private fun replace(old: Item, new: Item) { val i = items.indexOfLast { it === old }; if (i >= 0) items[i] = new }

    fun loadHistory(msgs: JsonArray) {
        val live = items.toList()
        items.clear()
        for (m in msgs) (m as? JsonObject)?.let { ingest(it, fromHistory = true) }
        if (items.isNotEmpty()) add(Item.Sys("", code = SysCode.HISTORY_ABOVE))
        items.addAll(live)
        loaded = true
    }

    // Ältere Nachrichten vor die angezeigten setzen
    fun prependHistory(msgs: JsonArray) {
        val shown = items.toList()
        items.clear()
        for (m in msgs) (m as? JsonObject)?.let { ingest(it, fromHistory = true) }
        items.addAll(shown)
    }

    // Nach einer Unterbrechung: Verlauf vollständig aus der Sitzungsdatei des Haupt-PCs, dazu offene Rückfragen
    // (die stehen nicht in der Datei). Ersetzt die bisherige Anzeige, die Lücken haben kann.
    fun resync(msgs: JsonArray, pending: JsonArray?) {
        stream = null
        items.clear()
        for (m in msgs) (m as? JsonObject)?.let { ingest(it, fromHistory = true) }
        for (p in pending.orEmpty()) {
            val o = p as? JsonObject ?: continue
            if (items.none { requestIdOf(it) == o.str("request_id") }) ingest(o)
        }
        loaded = true
        stale = false
    }

    // Eigene Nachricht sofort anzeigen (der Haupt-PC schickt sie dem Absender nicht zurück)
    fun addOwn(text: String, images: Int = 0, files: List<String> = emptyList()) {
        val now = System.currentTimeMillis()
        changeActivity(Activity(ActKind.THINKING))
        add(Item.Me(text, now, images = images, files = files))
        running = true
        updated = now
        preview = text.replace(Regex("\\s+"), " ").take(90)
        if (title.isBlank()) title = text.replace(Regex("\\s+"), " ").take(60)
    }

    fun setAnswer(item: Item, answer: Answer) {
        if (activity.kind == ActKind.WAITING) changeActivity(Activity(ActKind.THINKING))
        val new = when (item) {
            is Item.Perm -> item.copy(answer = answer)
            is Item.Question -> item.copy(answer = answer)
            is Item.Plan -> item.copy(answer = answer)
            else -> return
        }
        replace(item, new)
    }

    fun ingest(m: JsonObject, fromHistory: Boolean = false): Notice? {
        val n = ingestMessage(m, fromHistory)
        if (!fromHistory) trackActivity(m)
        return n
    }

    private fun ingestMessage(m: JsonObject, fromHistory: Boolean): Notice? {
        when (m.str("type")) {
            "swapline_user" -> {
                val c = m.obj("content")
                val images = (c?.get("images") as? JsonPrimitive)?.longOrNull?.toInt() ?: 0
                val text = c?.str("text").orEmpty().ifEmpty { if (images > 0) "[image]" else "" }
                add(Item.Me(text, System.currentTimeMillis(), (m.str("from") ?: "").take(40), images))
                running = true
                updated = System.currentTimeMillis()
                preview = text.replace(Regex("\\s+"), " ").take(90)
                if (title.isBlank()) title = text.replace(Regex("\\s+"), " ").take(60)
            }
            "swapline_bash" -> {
                val id = m.str("id").orEmpty()
                val old = items.lastOrNull { it is Item.Bash && it.id == id } as? Item.Bash
                val n = Item.Bash(id, m.str("command").orEmpty().take(8000), m.str("state") != "done", m.str("output").orEmpty(),
                    (m["code"] as? JsonPrimitive)?.content?.toIntOrNull() ?: 0, (m.str("from") ?: "").take(40), old?.time ?: System.currentTimeMillis())
                if (old != null) replace(old, n) else add(n)
                updated = System.currentTimeMillis()
                preview = ("!" + n.command).replace(Regex("\\s+"), " ").take(90)
            }
            "swapline_answered" -> {
                val rid = m.str("requestId")
                val it = items.firstOrNull { x -> rid != null && requestIdOf(x) == rid && answerOf(x) == null }
                if (it != null) setAnswer(it, Answer(if (m.str("behavior") == "deny") AnswerKind.DENIED_ELSEWHERE else AnswerKind.ANSWERED_ELSEWHERE, (m.str("from") ?: "").take(40)))
            }
            "system" -> when (m.str("subtype")) {
                "init" -> { m.str("session_id")?.let { sessionId = it }; modelName = m.str("model") ?: modelName }
                "compact_boundary" -> add(Item.Sys("", code = SysCode.COMPACTED))
                "away_summary" -> m.str("content")?.let { add(Item.Recap(it)) }
                "task_started", "task_updated", "task_notification", "background_tasks_changed" -> if (!fromHistory) trackTask(m)
            }
            "stream_event" -> {
                if (m["parent_tool_use_id"].let { it != null && it !is JsonNull }) return null
                val ev = m.obj("event")
                val delta = ev?.obj("delta")
                if (ev?.str("type") == "content_block_delta" && delta?.str("type") == "text_delta") {
                    val add = delta.str("text").orEmpty()
                    val cur = stream
                    if (cur == null) { val n = Item.Ai(add, System.currentTimeMillis(), streaming = true); stream = n; this.add(n) }
                    else { val n = cur.copy(text = cur.text + add); replace(cur, n); stream = n }
                }
            }
            "assistant" -> {
                if (m["parent_tool_use_id"].let { it != null && it !is JsonNull }) return null
                for (b in m.obj("message")?.arr("content").orEmpty()) {
                    val block = b as? JsonObject ?: continue
                    when (block.str("type")) {
                        "text" -> {
                            val text = block.str("text").orEmpty()
                            if (text.isBlank()) continue
                            val cur = stream
                            if (cur != null) { replace(cur, cur.copy(text = text, streaming = false)); stream = null }
                            else add(Item.Ai(text, if (fromHistory) timeOf(m) else System.currentTimeMillis()))
                            preview = text.replace(Regex("\\s+"), " ").take(90)
                        }
                        "tool_use" -> {
                            val name = block.str("name").orEmpty()
                            if (name == "AskUserQuestion") continue
                            add(Item.Tool(block.str("id").orEmpty(), name, block["input"] ?: JsonNull, if (fromHistory) "" else null))
                        }
                    }
                }
            }
            "user" -> {
                val c = m.obj("message")?.get("content")
                if (c is JsonPrimitive) {
                    if (c.isString) { val rest = takeBash(c.content, timeOf(m)); if (!hiddenUserText(rest)) add(Item.Me(rest, timeOf(m))) }
                    return null
                }
                val arr = (c as? JsonArray).orEmpty()
                for (b in arr) {
                    val block = b as? JsonObject ?: continue
                    when (block.str("type")) {
                        "tool_result" -> {
                            val id = block.str("tool_use_id")
                            // Hintergrund-Befehl: Pfad der Ausgabedatei steht im Ergebnis des Aufrufs
                            Regex("Output is being written to: (.+?\\.output)").find(textOf(block["content"]))?.groupValues?.get(1)?.let { out ->
                                tasks.values.firstOrNull { it.toolUseId == id }?.let { t -> tasks[t.id] = t.copy(output = out) }
                            }
                            val tool = items.lastOrNull { it is Item.Tool && it.id == id } as? Item.Tool ?: continue
                            // Bilder im Ergebnis (z. B. Claude liest einen Screenshot): base64, höchstens 4
                            val imgs = (block["content"] as? JsonArray).orEmpty().mapNotNull { b ->
                                val src = ((b as? JsonObject)?.takeIf { it.str("type") == "image" }?.get("source") as? JsonObject) ?: return@mapNotNull null
                                src.str("data")?.takeIf { it.isNotEmpty() && src.str("type") == "base64" && src.str("media_type") in setOf("image/png", "image/jpeg", "image/gif", "image/webp") }
                            }.take(4)
                            replace(tool, tool.copy(result = textOf(block["content"]).ifEmpty { "" }, isError = block.bool("is_error"), images = imgs))
                        }
                        "text" -> if (fromHistory) {
                            val text = takeBash(block.str("text").orEmpty(), timeOf(m))
                            if (!hiddenUserText(text)) add(Item.Me(text, timeOf(m), images = arr.count { (it as? JsonObject)?.str("type") == "image" }))
                        }
                    }
                }
            }
            "control_request" -> {
                val r = m.obj("request") ?: return null
                if (r.str("subtype") != "can_use_tool") return null
                val rid = m.str("request_id") ?: return null
                val input = r["input"] ?: JsonNull
                return when (r.str("tool_name")) {
                    "AskUserQuestion" -> { add(Item.Question(rid, input as? JsonObject ?: JsonObject(emptyMap()))); Notice.QUESTION }
                    "ExitPlanMode" -> { add(Item.Plan(rid, input as? JsonObject ?: JsonObject(emptyMap()))); Notice.PLAN }
                    else -> {
                        add(Item.Perm(rid, r.str("tool_name").orEmpty(), input, r.str("description").orEmpty(), r["permission_suggestions"]?.takeIf { it !is JsonNull }))
                        Notice.PERMISSION
                    }
                }
            }
            "result" -> {
                running = false
                stream?.let { replace(it, it.copy(streaming = false)) }
                stream = null
                val isError = m.bool("is_error") || (m.str("subtype")?.let { it != "success" } ?: false)
                if (isError) add(Item.Sys(m.str("result") ?: m.str("subtype") ?: "error", error = true))
                val secs = ((m["duration_ms"] as? JsonPrimitive)?.doubleOrNull ?: 0.0) / 1000.0
                val cost = (m["swapline_cost_delta"] as? JsonPrimitive)?.doubleOrNull
                add(Item.Result(!m.bool("is_error"), secs, cost, modelName))
                updated = System.currentTimeMillis()
                for (i in items.indices) { val x = items[i]; if (x is Item.Tool && x.result == null) replace(x, x.copy(result = "")) }
                return if (m.bool("is_error")) Notice.ERROR else Notice.DONE
            }
            "app_error" -> {
                running = false
                add(Item.Sys(m.str("message").orEmpty(), error = true))
                return Notice.ERROR
            }
            "app_exit" -> if (running) {
                running = false
                val tail = m.str("stderr").orEmpty().trim().lines().takeLast(6).joinToString("\n")
                val code = m["code"]?.let { (it as? JsonPrimitive)?.content } ?: "?"
                add(Item.Sys(code + if (tail.isNotEmpty()) "\n" + tail else "", error = true, code = SysCode.EXITED))
                return Notice.ERROR
            }
        }
        return null
    }
}

// Inhalt für session:send: nur Text als Zeichenkette, mit Bildern als Liste aus Bild-Blöcken (JPEG, base64) und Text
fun messageContent(text: String, images: List<String>, files: List<String> = emptyList()): JsonElement {
    // wie in Swapline am PC: Text, darunter „Attached files:“ mit den Pfaden auf dem Haupt-PC
    val base = text.ifBlank { if (images.size > 1) ClaudeText.SEE_IMAGES else if (images.size == 1) ClaudeText.SEE_IMAGE else if (files.isNotEmpty()) ClaudeText.SEE_FILE else text }
    val full = if (files.isEmpty()) base else base + "\n\n" + ClaudeText.ATTACHED_FILES + "\n" + files.joinToString("\n") { "- $it" }
    return if (images.isEmpty()) JsonPrimitive(full) else imageContent(full, images)
}

private fun imageContent(text: String, images: List<String>): JsonElement = JsonArray(
    images.map { data ->
        kotlinx.serialization.json.buildJsonObject {
            put("type", JsonPrimitive("image"))
            put("source", kotlinx.serialization.json.buildJsonObject {
                put("type", JsonPrimitive("base64")); put("media_type", JsonPrimitive("image/jpeg")); put("data", JsonPrimitive(data))
            })
        }
    } + kotlinx.serialization.json.buildJsonObject {
        put("type", JsonPrimitive("text"))
        put("text", JsonPrimitive(text))
    })

fun requestIdOf(it: Item): String? = when (it) { is Item.Perm -> it.requestId; is Item.Question -> it.requestId; is Item.Plan -> it.requestId; else -> null }
fun answerOf(it: Item): Answer? = when (it) { is Item.Perm -> it.answer; is Item.Question -> it.answer; is Item.Plan -> it.answer; else -> null }

// Zusammenfassung eines Werkzeug-Aufrufs für die kompakte Zeile
fun toolSummary(name: String, input: JsonElement): String {
    val o = input as? JsonObject ?: return ""
    val s = o.str("command") ?: o.str("file_path") ?: o.str("pattern") ?: o.str("path") ?: o.str("url") ?: o.str("query") ?: o.str("description") ?: o.str("prompt") ?: ""
    return s.lineSequence().firstOrNull().orEmpty().take(160)
}

fun JsonElement?.prim(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.content
fun JsonElement.asLong(): Long? = runCatching { jsonPrimitive.longOrNull }.getOrNull()
