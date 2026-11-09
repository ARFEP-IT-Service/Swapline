package de.arfep.swapline.model

import de.arfep.swapline.net.json
import de.arfep.swapline.ui.Block
import de.arfep.swapline.ui.parseMarkdown
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// Nachrichten wie Claude Code sie im stream-json-Format schickt (und Swapline sie ergänzt)
class ChatTest {
    private fun j(s: String): JsonObject = json.parseToJsonElement(s).jsonObject
    private fun chat() = Chat("abcdef123456", "h1", null, "p1", "C:\\work", null)

    @Test fun streamingThenFinalText() {
        val c = chat()
        c.ingest(j("""{"type":"system","subtype":"init","session_id":"11111111-2222-3333-4444-555555555555","model":"claude-opus"}"""))
        assertEquals("11111111-2222-3333-4444-555555555555", c.sessionId)
        c.ingest(j("""{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hal"}}}"""))
        c.ingest(j("""{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"lo"}}}"""))
        assertEquals(1, c.items.size)
        assertEquals("Hallo", (c.items[0] as Item.Ai).text)
        assertTrue((c.items[0] as Item.Ai).streaming)
        c.ingest(j("""{"type":"assistant","message":{"content":[{"type":"text","text":"Hallo Welt"}]}}"""))
        assertEquals(1, c.items.size)
        assertEquals("Hallo Welt", (c.items[0] as Item.Ai).text)
        assertFalse((c.items[0] as Item.Ai).streaming)
        // Unter-Agenten erscheinen nicht im Hauptchat
        c.ingest(j("""{"type":"assistant","parent_tool_use_id":"x","message":{"content":[{"type":"text","text":"intern"}]}}"""))
        assertEquals(1, c.items.size)
    }

    @Test fun toolUseAndResult() {
        val c = chat()
        c.running = true
        c.ingest(j("""{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"ls -la\nmore"}}]}}"""))
        val t = c.items[0] as Item.Tool
        assertNull(t.result)
        assertEquals("ls -la", toolSummary(t.name, t.input))
        c.ingest(j("""{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":[{"type":"text","text":"ok"}],"is_error":true}]}}"""))
        assertEquals("ok", (c.items[0] as Item.Tool).result)
        assertTrue((c.items[0] as Item.Tool).isError)
        val n = c.ingest(j("""{"type":"result","subtype":"success","duration_ms":2500,"swapline_cost_delta":0.0123,"is_error":false}"""))
        assertEquals(Notice.DONE, n)
        assertFalse(c.running)
        val r = c.items.last() as Item.Result
        assertEquals(2.5, r.seconds, 0.001)
        assertEquals(0.0123, r.cost!!, 1e-9)
    }

    @Test fun permissionQuestionPlanAndAnsweredElsewhere() {
        val c = chat()
        assertEquals(Notice.PERMISSION, c.ingest(j("""{"type":"control_request","request_id":"r1","request":{"subtype":"can_use_tool","tool_name":"Bash","input":{"command":"rm x"},"permission_suggestions":[{"type":"addRules"}]}}""")))
        assertEquals(Notice.QUESTION, c.ingest(j("""{"type":"control_request","request_id":"r2","request":{"subtype":"can_use_tool","tool_name":"AskUserQuestion","input":{"questions":[{"question":"Welche?","options":[{"label":"A"}]}]}}}""")))
        assertEquals(Notice.PLAN, c.ingest(j("""{"type":"control_request","request_id":"r3","request":{"subtype":"can_use_tool","tool_name":"ExitPlanMode","input":{"plan":"# Plan"}}}""")))
        assertEquals(3, c.items.size)
        assertTrue((c.items[0] as Item.Perm).suggestions is JsonArray)
        // am PC beantwortet
        c.ingest(j("""{"type":"swapline_answered","requestId":"r1","behavior":"deny","from":"PC-1"}"""))
        assertEquals(Answer(AnswerKind.DENIED_ELSEWHERE, "PC-1"), (c.items[0] as Item.Perm).answer)
        c.setAnswer(c.items[2], Answer(AnswerKind.PLAN_ACCEPTED))
        assertEquals(AnswerKind.PLAN_ACCEPTED, (c.items[2] as Item.Plan).answer?.kind)
    }

    @Test fun messageFromOtherDeviceAndErrors() {
        val c = chat()
        c.ingest(j("""{"type":"swapline_user","content":{"text":"vom PC","images":0},"from":"PC-1"}"""))
        assertEquals(Item.Me("vom PC", (c.items[0] as Item.Me).time, "PC-1", 0), c.items[0])
        assertTrue(c.running)
        assertEquals("vom PC", c.title)
        assertEquals(Notice.ERROR, c.ingest(j("""{"type":"app_exit","code":1,"stderr":"line1\nauth failed"}""")))
        assertEquals(SysCode.EXITED, (c.items.last() as Item.Sys).code)
        assertFalse(c.running)
        assertNull(c.ingest(j("""{"type":"app_exit","code":0}"""))) // nicht laufend: nichts melden
    }

    @Test fun historyHidesInternalUserTextAndMarksBoundary() {
        val c = chat()
        c.addOwn("live")
        val hist = json.parseToJsonElement("""[
          {"type":"user","message":{"content":"<system-reminder>x</system-reminder>"}},
          {"type":"user","timestamp":"2026-11-09T10:00:00Z","message":{"content":"Frage"}},
          {"type":"user","message":{"content":[{"type":"text","text":"mit Bild"},{"type":"image","source":{}}]}},
          {"type":"assistant","timestamp":"2026-11-09T10:00:05Z","message":{"content":[{"type":"text","text":"Antwort"}]}}
        ]""") as JsonArray
        c.loadHistory(hist)
        assertEquals(listOf("Frage", "mit Bild", "Antwort", "", "live"), c.items.map { (it as? Item.Me)?.text ?: (it as? Item.Ai)?.text ?: "" })
        assertEquals(1, (c.items[1] as Item.Me).images)
        assertEquals(SysCode.HISTORY_ABOVE, (c.items[3] as Item.Sys).code)
        assertTrue(c.loaded)
    }

    @Test fun resyncFillsGapsAfterInterruption() {
        val c = chat()
        // live angekommen: Frage und ein Bash-Aufruf – dann riss die Verbindung ab
        c.ingest(j("""{"type":"swapline_user","content":{"text":"Baue das","images":0},"from":"PC"}"""))
        c.ingest(j("""{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"ls"}}]}}"""))
        c.ingest(j("""{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"halb"}}}"""))
        c.stale = true
        // Sitzungsdatei vom Haupt-PC (vollständig) + offene Rückfrage
        val hist = json.parseToJsonElement("""[
          {"type":"user","message":{"content":"Baue das"}},
          {"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"ls"}}]}},
          {"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"a.txt"}]}},
          {"type":"assistant","message":{"content":[{"type":"tool_use","id":"t2","name":"Bash","input":{"command":"npm test"}}]}},
          {"type":"assistant","message":{"content":[{"type":"text","text":"Fertig, Tests laufen."}]}}
        ]""") as JsonArray
        val pending = json.parseToJsonElement("""[{"type":"control_request","request_id":"r9","request":{"subtype":"can_use_tool","tool_name":"Bash","input":{"command":"rm -rf build"},"permission_suggestions":null,"description":""}}]""") as JsonArray
        c.resync(hist, pending)
        assertFalse(c.stale)
        assertEquals(listOf("Me", "Tool", "Tool", "Ai", "Perm"), c.items.map { it.javaClass.simpleName })
        assertEquals("a.txt", (c.items[1] as Item.Tool).result)
        assertEquals("Fertig, Tests laufen.", (c.items[3] as Item.Ai).text)
        assertEquals("r9", (c.items[4] as Item.Perm).requestId)
        // danach weiterlaufende Live-Ereignisse hängen sauber an (kein Rest der abgebrochenen Live-Zeile)
        c.ingest(j("""{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Neu"}}}"""))
        assertEquals("Neu", (c.items.last() as Item.Ai).text)
        // Rückfrage, die schon angezeigt wird, kommt nicht doppelt
        c.resync(hist, pending)
        assertEquals(1, c.items.count { it is Item.Perm })
    }

    @Test fun withinFolders() {
        assertTrue(within("C:\\Work\\app", "c:\\work"))
        assertTrue(within("C:\\Work", "C:\\Work\\"))
        assertFalse(within("C:\\Work-other", "C:\\Work"))
        assertFalse(within("", "C:\\Work"))
    }

    @Test fun parseStoreIgnoresBadValues() {
        val st = Parse.store(json.parseToJsonElement("""{"profiles":[{"id":"p1","name":"Max","color":"red"},{"name":"ohne id"}],
            "projects":[{"id":"x","name":"Web","color":"#112233","cwd":"C:\\w"}],"settings":{"model":"opus","permissionMode":"plan"},
            "allowedFolders":["C:\\w",5],"allowBypass":true,"scope":{"newChats":false}}"""))!!
        assertEquals(1, st.profiles.size)
        assertEquals("#1581FF", st.profiles[0].color)
        assertEquals("#112233", st.projects[0].color)
        assertEquals(listOf("C:\\w"), st.allowedFolders)
        assertEquals("plan", st.permissionMode)
        assertTrue(st.allowBypass)
        assertFalse(st.newChats)
        assertEquals(listOf<OpenTab>(), Parse.openTabs(json.parseToJsonElement("""[{"title":"ohne id"}]""")))
        assertNull(Parse.openTabs(json.parseToJsonElement("""[{"id":"a1","sessionId":"kein-uuid"}]"""))[0].sessionId)
    }

    @Test fun markdownBlocks() {
        val b = parseMarkdown("# Titel\n\nText **fett**\nweiter\n\n- eins\n  - zwei\n1. drei\n\n```kotlin\nval x = 1\n```\n> Zitat")
        assertEquals(Block.Heading(1, "Titel"), b[0])
        assertEquals(Block.Para("Text **fett**\nweiter"), b[1])
        assertEquals(Block.Bullet("•", "eins", 0), b[2])
        assertEquals(Block.Bullet("•", "zwei", 1), b[3])
        assertEquals(Block.Bullet("1.", "drei", 0), b[4])
        assertEquals(Block.Code("kotlin", "val x = 1"), b[5])
        assertEquals(Block.Quote("Zitat"), b[6])
    }
}
