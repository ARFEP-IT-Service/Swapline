// Smileys im eigenen Text werden zu Emojis (wie am PC, src/renderer/emoji.js): „:D“ → 😄, sobald danach ein Leerzeichen
// getippt oder gesendet wird. Nur einzeln stehende Smileys, nie in `Code` oder ```Blöcken```. tests/emoji-cases.json prüft beide.
package de.arfep.swapline.ui

val EMOTICONS: Map<String, String> = linkedMapOf(
    ":-)" to "🙂", ":)" to "🙂", ":-D" to "😄", ":D" to "😄", ";-)" to "😉", ";)" to "😉", ";D" to "😜",
    ":-(" to "🙁", ":(" to "🙁", ":'(" to "😢", ":-P" to "😛", ":P" to "😛", ":p" to "😛", ";P" to "😜", ";p" to "😜",
    ":-O" to "😮", ":O" to "😮", ":o" to "😮", ":*" to "😘", ":-*" to "😘", "XD" to "😆", "xD" to "😆",
    ":/" to "😕", ":-/" to "😕", ":|" to "😐", "^^" to "😊", "<3" to "❤️", "</3" to "💔", ":+1:" to "👍", ":-1:" to "👎",
)

private val TOKEN = Regex("(^|\\s)(\\S+)(?=\\s|$)")

fun inCode(text: String, pos: Int): Boolean {
    val before = text.substring(0, pos)
    if (Regex("```").findAll(before).count() % 2 == 1) return true
    val line = before.substring(before.lastIndexOf('\n') + 1).replace("```", "")
    return line.count { it == '`' } % 2 == 1
}

fun emojify(text: String): String = TOKEN.replace(text) { m ->
    val pre = m.groupValues[1]; val tok = m.groupValues[2]
    val e = EMOTICONS[tok]
    if (e != null && !inCode(text, m.range.first + pre.length)) pre + e else m.value
}

// Beim Tippen am Ende: wurde gerade ein Leerzeichen/Zeilenumbruch hinter einem Smiley getippt? → umgewandelter Text oder null
fun emojifyTyped(text: String): String? {
    if (text.length < 2 || !text.last().isWhitespace()) return null
    val head = text.dropLast(1)
    val m = Regex("(^|\\s)(\\S+)$").find(head) ?: return null
    val e = EMOTICONS[m.groupValues[2]] ?: return null
    val start = head.length - m.groupValues[2].length
    if (inCode(text, start)) return null
    return text.substring(0, start) + e + text.substring(text.length - 1)
}
