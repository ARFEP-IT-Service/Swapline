// Inhalt des QR-Codes, den Swapline am PC beim Koppeln zeigt:
// swapline://pair?v=1&a=<Adresse>,<Adresse>…&p=<Port>&c=<Einmal-Code ohne Bindestriche>&n=<Name des PCs>
// Alles wird streng geprüft – ein fremder QR-Code darf nichts anderes auslösen als ein Koppelversuch,
// den der Haupt-PC ohnehin erst nach Bestätigung annimmt.
package de.arfep.swapline.net

import java.net.URLDecoder

data class PairLink(val addresses: List<String>, val port: Int, val code: String, val name: String)

object PairLinks {
    private val IPV4 = Regex("^(25[0-5]|2[0-4]\\d|1?\\d?\\d)(\\.(25[0-5]|2[0-4]\\d|1?\\d?\\d)){3}$")
    private val HOSTNAME = Regex("^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$", RegexOption.IGNORE_CASE)
    private val CODE = Regex("^[0-9A-HJKMNP-TV-Z]{26}$")

    fun validAddress(a: String) = a.length <= 253 && (IPV4.matches(a) || (HOSTNAME.matches(a) && !Regex("^[0-9.]+$").matches(a)))

    fun parse(text: String): PairLink? {
        val t = text.trim()
        if (t.length > 1000 || !t.startsWith("swapline://pair?")) return null
        val q = t.removePrefix("swapline://pair?").split('&').mapNotNull {
            val i = it.indexOf('=')
            if (i <= 0) null else it.substring(0, i) to runCatching { URLDecoder.decode(it.substring(i + 1), "UTF-8") }.getOrNull()
        }.toMap()
        if (q["v"] != "1") return null
        val addresses = q["a"].orEmpty().split(',').map { it.trim() }.filter { it.isNotEmpty() }.take(6)
        if (addresses.isEmpty() || !addresses.all(::validAddress)) return null
        val port = q["p"]?.toIntOrNull()?.takeIf { it in 1024..65535 } ?: return null
        val code = q["c"]?.uppercase()?.takeIf { CODE.matches(it) } ?: return null
        val name = q["n"].orEmpty().replace(Regex("[^\\p{L}\\p{N} ._-]"), "").take(40)
        return PairLink(addresses, port, code, name)
    }
}
