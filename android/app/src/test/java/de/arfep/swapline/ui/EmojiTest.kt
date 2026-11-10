package de.arfep.swapline.ui

import de.arfep.swapline.net.json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

// Smileys → Emojis: dieselben Fälle wie am PC (tests/emoji-cases.json) und dieselbe Tabelle wie src/renderer/emoji.js
class EmojiTest {
    private val repo = File(System.getProperty("swapline.repo"))

    @Test fun sameAsDesktop() {
        val cases = json.parseToJsonElement(File(repo, "tests/emoji-cases.json").readText()) as JsonArray
        val bad = cases.map { it as JsonObject }.filter { emojify(it["in"]!!.jsonPrimitive.content) != it["out"]!!.jsonPrimitive.content }
            .map { "${it["in"]} → ${emojify(it["in"]!!.jsonPrimitive.content)}" }
        assertTrue(bad.joinToString("\n"), bad.isEmpty())
    }

    @Test fun sameTableAsDesktop() {
        val js = File(repo, "src/renderer/emoji.js").readText()
        val pairs = Regex("""\[(['"])(.+?)\1, '([^']+)'\]""").findAll(js).map { it.groupValues[2] to it.groupValues[3] }.toList()
        assertEquals(pairs.toMap(), EMOTICONS)
    }

    @Test fun whileTyping() {
        assertEquals("Danke 😄 ", emojifyTyped("Danke :D "))
        assertEquals("😉\n", emojifyTyped(";)\n"))
        assertNull(emojifyTyped("Danke :D"))       // noch kein Leerzeichen
        assertNull(emojifyTyped("a:D "))            // nicht einzeln
        assertNull(emojifyTyped("`x :D "))          // in Code
    }
}
