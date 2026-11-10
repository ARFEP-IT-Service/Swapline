package de.arfep.swapline.model

import de.arfep.swapline.net.json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

// Dieselben Fälle wie am PC (tests/risk-cases.json) – die Muster in Risk.kt sind aus src/renderer/risk.js erzeugt
class RiskTest {
    @Test fun sameAsDesktop() {
        val cases = json.parseToJsonElement(File(System.getProperty("swapline.repo"), "tests/risk-cases.json").readText()) as JsonArray
        val bad = cases.mapNotNull { e ->
            val c = e as JsonObject
            val r = Risks.of(c["tool"]!!.jsonPrimitive.content, c["input"])
            val want = c["level"]!!.jsonPrimitive.content
            val reason = c["reason"]!!.jsonPrimitive.content
            if (r.level.name.lowercase() == want && r.reason == reason) null else "${c["input"]} → $r (erwartet $want/$reason)"
        }
        assertTrue(bad.joinToString("\n"), bad.isEmpty())
    }

    @Test fun generatedFromDesktop() {
        // Risk.kt muss aus der aktuellen risk.js erzeugt sein (sonst: node android/tools/risk.js)
        val js = File(System.getProperty("swapline.repo"), "src/renderer/risk.js").readText()
        val kt = File(System.getProperty("swapline.repo"), "android/app/src/main/java/de/arfep/swapline/model/Risk.kt").readText()
        val patterns = Regex("""\['\w+', /(.+)/i],|= /(.+)/i;""").findAll(js).map { it.groupValues[1].ifEmpty { it.groupValues[2] } }.toList()
        assertTrue(patterns.size >= 15 && patterns.all { kt.contains(it) })
    }
}
