package de.arfep.swapline.ui

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

// Türkisch: jeder feste Text aus tr("…", "…") hat einen Eintrag in TR_TEXTS, Texte mit eingesetzten Werten ($…)
// haben Türkisch als dritten Wert im Aufruf
class TrTextsTest {
    private val sources = File(System.getProperty("swapline.repo"), "android/app/src/main/java").walkTopDown().filter { it.extension == "kt" && it.name != "TrTexts.kt" }.toList()
    private val call = Regex("""\btr\(\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*\)""")
    private val template = Regex("""(?<!\\)\$[A-Za-z_{]""")
    private fun unescape(s: String) = s.replace(Regex("""\\(.)""")) { m -> when (val c = m.groupValues[1]) { "n" -> "\n"; "t" -> "\t"; else -> c } }

    @Test fun everyFixedTextHasTurkish() {
        val missing = sources.flatMap { f -> call.findAll(f.readText()).map { it.groupValues[1] }.filter { !template.containsMatchIn(it) }.map { f.name + ": " + unescape(it) }.toList() }
            .filter { TR_TEXTS[it.substringAfter(": ")] == null }
        assertTrue("ohne Türkisch:\n" + missing.joinToString("\n"), missing.isEmpty())
    }

    @Test fun templatesHaveTurkishArgument() {
        val two = sources.flatMap { f -> call.findAll(f.readText()).filter { template.containsMatchIn(it.groupValues[1]) }.map { f.name + ": " + it.value }.toList() }
        assertTrue("Texte mit eingesetzten Werten ohne Türkisch:\n" + two.joinToString("\n"), two.isEmpty())
    }

    @Test fun noEmptyTranslations() {
        assertTrue(TR_TEXTS.isNotEmpty() && TR_TEXTS.values.all { it.isNotBlank() })
    }
}
