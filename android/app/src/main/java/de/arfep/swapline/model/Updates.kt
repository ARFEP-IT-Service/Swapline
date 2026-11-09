// Update-Hinweis: neuere Version der Android-App in den GitHub-Releases (Tags android-v…)?
// Nur lesen über die öffentliche GitHub-API, keine Anmeldung; installiert wird nie automatisch – der Download-Link
// öffnet sich im Browser, Android fragt vor der Installation.
package de.arfep.swapline.model

import de.arfep.swapline.net.json
import de.arfep.swapline.net.str
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import java.net.URL
import javax.net.ssl.HttpsURLConnection

data class Update(val version: String, val apkUrl: String, val pageUrl: String)

object Updates {
    private const val API = "https://api.github.com/repos/ARFEP-IT-Service/Swapline/releases?per_page=30"
    private const val DOWNLOAD = "https://github.com/ARFEP-IT-Service/Swapline/releases/"
    private val VERSION = Regex("^\\d+\\.\\d+\\.\\d+$")

    // Versionen vergleichen (nur X.Y.Z): > 0, wenn a neuer ist als b
    fun compare(a: String, b: String): Int {
        val x = a.split('.').map { it.toIntOrNull() ?: 0 }
        val y = b.split('.').map { it.toIntOrNull() ?: 0 }
        for (i in 0 until maxOf(x.size, y.size)) { val d = x.getOrElse(i) { 0 } - y.getOrElse(i) { 0 }; if (d != 0) return d }
        return 0
    }

    // Neueste veröffentlichte Android-Version aus der Release-Liste (ohne Entwürfe und Vorabversionen)
    fun pick(releases: JsonArray, current: String): Update? = releases.mapNotNull { e ->
        val r = e as? JsonObject ?: return@mapNotNull null
        if ((r["draft"] as? JsonPrimitive)?.booleanOrNull == true || (r["prerelease"] as? JsonPrimitive)?.booleanOrNull == true) return@mapNotNull null
        val v = r.str("tag_name")?.removePrefix("android-v")?.takeIf { r.str("tag_name")!!.startsWith("android-v") && VERSION.matches(it) } ?: return@mapNotNull null
        val apk = (r["assets"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonObject)?.str("browser_download_url") }
            .firstOrNull { it.startsWith(DOWNLOAD + "download/android-v$v/") && it.endsWith(".apk") } ?: return@mapNotNull null
        Update(v, apk, DOWNLOAD + "tag/android-v$v")
    }.maxWithOrNull { a, b -> compare(a.version, b.version) }?.takeIf { compare(it.version, current) > 0 }

    suspend fun check(current: String): Update? = withContext(Dispatchers.IO) {
        runCatching {
            val c = URL(API).openConnection() as HttpsURLConnection
            c.connectTimeout = 10_000
            c.readTimeout = 10_000
            c.setRequestProperty("Accept", "application/vnd.github+json")
            c.setRequestProperty("User-Agent", "Swapline-Android")
            try {
                if (c.responseCode != 200) return@runCatching null
                val text = c.inputStream.use { s -> String(s.readBytes(), Charsets.UTF_8) }
                pick(json.parseToJsonElement(text) as JsonArray, current)
            } finally { c.disconnect() }
        }.getOrNull()
    }
}
