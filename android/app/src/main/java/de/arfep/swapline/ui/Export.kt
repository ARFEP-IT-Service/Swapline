// /export: ganzer Chat als Markdown (wie am PC): Nachrichten, Werkzeug-Aufrufe mit Eingabe und Ergebnis, Rückfragen mit
// Antwort, „!“-Befehle, Zeiten und Kosten.
package de.arfep.swapline.ui

import de.arfep.swapline.model.Chat
import de.arfep.swapline.model.Item
import de.arfep.swapline.model.SysCode
import de.arfep.swapline.model.toolSummary
import de.arfep.swapline.net.str
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import java.text.DateFormat
import java.util.Date

private val prettyJson = Json { prettyPrint = true }
private fun stamp(ms: Long?) = ms?.let { DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(it)) }.orEmpty()

// Code-Block, der auch mit ``` im Inhalt nicht bricht
fun fence(s: String): String {
    val n = maxOf(3, (Regex("`+").findAll(s).maxOfOrNull { it.value.length } ?: 0) + 1)
    return "`".repeat(n) + "\n" + s + "\n" + "`".repeat(n)
}

private fun input(name: String, i: JsonElement): String =
    if (name == "Bash" || name == "PowerShell") (i as? JsonObject)?.str("command").orEmpty() else prettyJson.encodeToString(JsonElement.serializer(), i)

fun chatMarkdown(c: Chat, hostName: String, version: String): String {
    val out = mutableListOf<String>()
    out += "# " + c.title.ifBlank { tr("Neuer Chat", "New chat") }
    out += ""
    out += "- " + tr("Haupt-PC", "Host PC") + ": " + hostName
    out += "- " + tr("Ordner", "Folder") + ": " + c.cwd.ifEmpty { "~" }
    out += "- " + tr("Modell", "Model") + ": " + c.modelName.ifEmpty { c.model.ifEmpty { tr("Standard", "Default") } }
    out += "- " + tr("Sitzung", "Session") + ": " + (c.sessionId ?: "–")
    out += "- " + tr("Exportiert", "Exported") + ": " + stamp(System.currentTimeMillis()) + " · Swapline für Android " + version
    out += listOf("", "---", "")
    val open = tr("(offen)", "(open)")
    for (it in c.items.toList()) when (it) {
        is Item.Me -> { out += "### " + tr("Du", "You") + (if (it.from.isNotEmpty()) " (${it.from})" else "") + (it.time?.let { t -> " · " + stamp(t) } ?: ""); out += listOf("", it.text, "") }
        is Item.Ai -> { out += "### Claude" + (it.time?.let { t -> " · " + stamp(t) } ?: ""); out += listOf("", it.text, "") }
        is Item.Tool -> {
            out += "<details><summary>🔧 ${it.name}: ${toolSummary(it.name, it.input).replace(Regex("[<>]"), "")}</summary>"
            out += listOf("", fence(input(it.name, it.input)))
            if (!it.result.isNullOrEmpty()) out += listOf("", (if (it.isError) tr("Fehler", "Error") else tr("Ergebnis", "Result")) + ":", "", fence(it.result))
            out += listOf("", "</details>", "")
        }
        is Item.Bash -> { out += "**! ${it.command}**" + (if (it.code != 0) " (" + tr("Beendet mit Code ", "Exited with code ") + it.code + ")" else ""); out += listOf("", fence(it.output), "") }
        is Item.Perm -> {
            out += "> ❓ " + tr("Darf Claude ${it.toolName} ausführen?", "Allow Claude to run ${it.toolName}?", "Claude ${it.toolName} çalıştırabilir mi?")
            out += ">"; out += fence(input(it.toolName, it.input)).lines().map { l -> "> $l" }
            out += "> " + (it.answer?.let { a -> answerText(a) } ?: open); out += ""
        }
        is Item.Question -> {
            val qs = (it.input["questions"] as? JsonArray).orEmpty().mapNotNull { q -> (q as? JsonObject)?.str("question") }
            out += "> ❓ " + qs.joinToString(" · "); out += "> " + (it.answer?.let { a -> answerText(a) } ?: open); out += ""
        }
        is Item.Plan -> {
            out += "> 📋 Plan"; out += ">"; out += it.input.str("plan").orEmpty().lines().map { l -> "> $l" }
            out += "> " + (it.answer?.let { a -> answerText(a) } ?: open); out += ""
        }
        is Item.Recap -> { out += "> ※ Recap: " + it.text; out += "" }
        is Item.Sys -> if (it.code == SysCode.TEXT && it.text.isNotBlank()) { out += "*${it.text}*"; out += "" }
        is Item.Result -> { out += "<sub>" + (if (it.ok) "✓ " else "✕ ") + String.format("%.1f s", it.seconds) + (it.cost?.let { c2 -> String.format(" · $%.3f", c2) } ?: "") + "</sub>"; out += "" }
    }
    return out.joinToString("\n").replace(Regex("\n{3,}"), "\n\n")
}
