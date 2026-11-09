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
    data class Me(val text: String, val time: Long?, val from: String = "", val images: Int = 0) : Item()
    data class Ai(val text: String, val time: Long?, val streaming: Boolean = false) : Item()
    data class Tool(val id: String, val name: String, val input: JsonElement, val result: String? = null, val isError: Boolean = false) : Item()
    data class Perm(val requestId: String, val toolName: String, val input: JsonElement, val description: String, val suggestions: JsonElement?, val answer: Answer? = null) : Item()
    data class Question(val requestId: String, val input: JsonObject, val answer: Answer? = null) : Item()
    data class Plan(val requestId: String, val input: JsonObject, val answer: Answer? = null) : Item()
    data class Recap(val text: String) : Item()
    data class Sys(val text: String, val error: Boolean = false, val code: SysCode = SysCode.TEXT) : Item()
    data class Result(val ok: Boolean, val seconds: Double, val cost: Double?, val model: String) : Item()
}

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
}

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
    private var stream: Item.Ai? = null

    val mirror get() = hostTab != null

    private fun add(it: Item) { items.add(it) }
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

    // Eigene Nachricht sofort anzeigen (der Haupt-PC schickt sie dem Absender nicht zurück)
    fun addOwn(text: String) {
        val now = System.currentTimeMillis()
        add(Item.Me(text, now))
        running = true
        updated = now
        preview = text.replace(Regex("\\s+"), " ").take(90)
        if (title.isBlank()) title = text.replace(Regex("\\s+"), " ").take(60)
    }

    fun setAnswer(item: Item, answer: Answer) {
        val new = when (item) {
            is Item.Perm -> item.copy(answer = answer)
            is Item.Question -> item.copy(answer = answer)
            is Item.Plan -> item.copy(answer = answer)
            else -> return
        }
        replace(item, new)
    }

    fun ingest(m: JsonObject, fromHistory: Boolean = false): Notice? {
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
            "swapline_answered" -> {
                val rid = m.str("requestId")
                val it = items.firstOrNull { x -> rid != null && requestIdOf(x) == rid && answerOf(x) == null }
                if (it != null) setAnswer(it, Answer(if (m.str("behavior") == "deny") AnswerKind.DENIED_ELSEWHERE else AnswerKind.ANSWERED_ELSEWHERE, (m.str("from") ?: "").take(40)))
            }
            "system" -> when (m.str("subtype")) {
                "init" -> { m.str("session_id")?.let { sessionId = it }; modelName = m.str("model") ?: modelName }
                "compact_boundary" -> add(Item.Sys("", code = SysCode.COMPACTED))
                "away_summary" -> m.str("content")?.let { add(Item.Recap(it)) }
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
                if (c is JsonPrimitive) { if (c.isString && !hiddenUserText(c.content)) add(Item.Me(c.content, timeOf(m))); return null }
                val arr = (c as? JsonArray).orEmpty()
                for (b in arr) {
                    val block = b as? JsonObject ?: continue
                    when (block.str("type")) {
                        "tool_result" -> {
                            val id = block.str("tool_use_id")
                            val tool = items.lastOrNull { it is Item.Tool && it.id == id } as? Item.Tool ?: continue
                            replace(tool, tool.copy(result = textOf(block["content"]).ifEmpty { "" }, isError = block.bool("is_error")))
                        }
                        "text" -> if (fromHistory) {
                            val text = block.str("text").orEmpty()
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
