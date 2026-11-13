package de.arfep.swapline.ui

import de.arfep.swapline.model.HostRecord
import de.arfep.swapline.model.HostState
import de.arfep.swapline.model.Parse
import de.arfep.swapline.net.json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// Projekt-Filter auf dem Handy: offene Chats des Haupt-PCs gehören zu dem Projekt, dem sie dort zugeordnet sind –
// auch wenn ihr Ordner außerhalb des Projektordners liegt (bis 0.12.0 nur nach Ordner, Chat fehlte unter dem Projekt)
class ProjectFilterTest {
    private fun host(): HostState {
        val h = HostState(HostRecord("h1", "PC", "127.0.0.1", 47820, "0123456789abcdef", "", "PC"))
        h.store = Parse.store(json.parseToJsonElement("""{"profiles":[{"id":"p1","name":"Konto"}],"projects":[{"id":"web","name":"Webseite","cwd":"C:\\Projekte\\web"},{"id":"leer","name":"Ohne Ordner","cwd":""}],"settings":{}}"""))
        return h
    }

    @Test fun parsesProjectIdOfOpenTabs() {
        val tabs = Parse.openTabs(json.parseToJsonElement("""[{"id":"tab1","projectId":"web","cwd":"D:\\anders"},{"id":"tab2","projectId":"../x"},{"id":"tab3"}]"""))
        assertEquals("web", tabs[0].projectId)
        assertNull(tabs[1].projectId) // ungültige ID verworfen
        assertNull(tabs[2].projectId)
    }

    @Test fun projectFromHostWinsOverFolder() {
        val h = host()
        h.projectFilter = "web"
        assertTrue(inFilter(h, "D:\\anders", "web"))             // zugeordnet, Ordner passt nicht
        assertFalse(inFilter(h, "C:\\Projekte\\web\\src", "leer")) // anderem Projekt zugeordnet
        assertTrue(inFilter(h, "C:\\Projekte\\web\\src"))           // ohne Zuordnung: nach Ordner
        assertFalse(inFilter(h, "D:\\anders"))
        h.projectFilter = "leer"
        assertTrue(inFilter(h, "", "leer"))                         // Projekt ohne Ordner: nur über die Zuordnung
        h.projectFilter = null
        assertTrue(inFilter(h, "D:\\anders", "web"))                // „Alle“
    }
}
