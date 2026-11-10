package de.arfep.swapline.net

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.AfterClass
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.BeforeClass
import org.junit.Test
import java.io.BufferedReader
import java.io.File
import java.io.Writer
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

// Gegen den echten Fernzugriff aus src/remote.js (android/testhost/host.js, braucht Node)
class LinkTest {
    companion object {
        private lateinit var proc: Process
        private lateinit var stdin: Writer
        private val lines = LinkedBlockingQueue<JsonObject>()
        private var port = 0
        private lateinit var relay: RelayRoute

        @BeforeClass @JvmStatic fun start() {
            val repo = File(System.getProperty("swapline.repo") ?: "../..")
            proc = ProcessBuilder(System.getenv("SWAPLINE_TEST_NODE") ?: "node", File(repo, "android/testhost/host.js").absolutePath).redirectErrorStream(true).start()
            stdin = proc.outputStream.writer()
            val reader: BufferedReader = proc.inputStream.bufferedReader()
            Thread {
                reader.lineSequence().forEach { l -> runCatching { lines.put(json.parseToJsonElement(l).jsonObject) }.onFailure { System.err.println("host: $l") } }
            }.apply { isDaemon = true }.start()
            val ready = next()
            port = ready.getValue("port").jsonPrimitive.content.toInt()
            relay = RelayRoute("127.0.0.1", ready.getValue("relayPort").jsonPrimitive.content.toInt(), ready.getValue("hostId").jsonPrimitive.content, ready.getValue("dialKey").jsonPrimitive.content)
        }

        @AfterClass @JvmStatic fun stop() { runCatching { stdin.close() }; proc.waitFor(5, TimeUnit.SECONDS); proc.destroy() }

        private fun next(): JsonObject = lines.poll(20, TimeUnit.SECONDS) ?: error("Testhost antwortet nicht")
        private fun cmd(c: String): JsonObject { stdin.write(c + "\n"); stdin.flush(); return next() }
        private fun code(): String = cmd("pair").getValue("code").jsonPrimitive.content
    }

    private suspend fun pairOk(name: String = "Handy"): Paired {
        val code = code()
        val p = pair("127.0.0.1", port, code, name)
        assertEquals(name, next().getValue("confirm").jsonPrimitive.content)
        return p
    }

    @Test fun pairCodeRoundTrip() {
        // gleiche Dekodierung wie remote.js: 26 Zeichen -> 16 Byte, Bindestriche und Verwechsler egal
        val bytes = PairCode.decode("0123-4567-89AB-CDEF-GHJK-MNPQ-RS")!!
        assertEquals(16, bytes.size)
        assertTrue(PairCode.decode("01OI-L") contentEquals PairCode.decode("0101-1"))
        assertNull(PairCode.decode("U!"))
    }

    @Test fun pairConnectCallAndEvents() = runBlocking {
        val p = pairOk()
        assertEquals(32, p.key.size)
        assertTrue(Regex("^[0-9a-f]{16}$").matches(p.deviceId))

        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val events = CopyOnWriteArrayList<Pair<String, JsonElement>>()
        val states = CopyOnWriteArrayList<LinkState>()
        val link = HostLink(scope, { k, d -> events += k to d }, { s, _ -> states += s })
        link.use(Target("127.0.0.1", port, p.deviceId, p.key))
        withTimeout(15_000) { while (link.state != LinkState.CONNECTED) delay(20) }

        val r = link.call("echo", JsonPrimitive("hallo"), JsonPrimitive(3)).jsonObject
        assertEquals("Handy", r.getValue("device").jsonPrimitive.content)
        assertEquals("[\"hallo\",3]", r.getValue("args").toString())

        try { link.call("fail"); fail("Fehler erwartet") } catch (e: LinkException) { assertEquals("absichtlich", e.message) }

        // große Antwort (über mehrere TLS-Records)
        assertEquals(2_000_000, link.call("big", JsonPrimitive(2_000_000)).jsonPrimitive.content.length)

        cmd("push store-changed")
        withTimeout(5_000) { while (events.none { it.first == "store-changed" }) delay(20) }
        assertEquals("welt", events.first { it.first == "store-changed" }.second.jsonObject.getValue("hello").jsonPrimitive.content)

        // Gerät am Haupt-PC entfernt: Verbindung bricht ab, neue Anmeldung scheitert
        cmd("remove")
        withTimeout(5_000) { while (link.state == LinkState.CONNECTED) delay(20) }
        try { link.call("echo"); fail("offline erwartet") } catch (e: LinkException) { assertEquals("offline", e.reason) }
        link.close()
        scope.cancel()
    }

    @Test fun pairAndWorkOnlyViaRelay() = runBlocking {
        // von unterwegs: Haupt-PC direkt nicht erreichbar, nur über den Vermittler
        val code = code()
        val p = pair("swapline-test.invalid", port, code, "Unterwegs", relay = relay)
        assertEquals("Unterwegs", next().getValue("confirm").jsonPrimitive.content)
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val link = HostLink(scope, { _, _ -> }, { _, _ -> })
        link.use(Target("swapline-test.invalid", port, p.deviceId, p.key, relay))
        withTimeout(20_000) { while (link.state != LinkState.CONNECTED) delay(20) }
        assertEquals("relay", link.via)
        assertEquals("Unterwegs", link.call("echo").jsonObject.getValue("device").jsonPrimitive.content)
        // große Antwort auch durch den Vermittler
        assertEquals(1_000_000, link.call("big", JsonPrimitive(1_000_000)).jsonPrimitive.content.length)
        link.close()
        scope.cancel()
    }

    @Test fun relayRejectsWrongDialKey() = runBlocking {
        val code = code()
        try { pair("swapline-test.invalid", port, code, "Fremd", relay = relay.copy(dialKey = "0".repeat(64))); fail("abgelehnt erwartet") }
        catch (e: LinkException) { assertEquals("relay", e.reason) }
    }

    // SSH-Server des Haupt-PCs: eigener Eintrag, Aufrufe gehen als „server:call“ über dieselbe Verbindung
    @Test fun serverCallsGoThroughHost() = runBlocking {
        val p = pairOk("Server")
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val link = HostLink(scope, { _, _ -> }, { _, _ -> })
        link.use(Target("127.0.0.1", port, p.deviceId, p.key))
        withTimeout(15_000) { while (link.state != LinkState.CONNECTED) delay(20) }
        val rec = de.arfep.swapline.model.HostRecord("h1", "PC", "127.0.0.1", port, p.deviceId, "", "PC")
        val parent = de.arfep.swapline.model.HostState(rec).also { it.link = link; it.state = LinkState.CONNECTED }
        val srv = de.arfep.swapline.model.HostState(rec.copy(id = "h1~s1"), parent = parent, serverId = "s1").also { it.link = link }
        assertTrue(srv.connected)
        val r = srv.call("history:list", JsonPrimitive("server")).jsonObject
        assertEquals("s1", r["server"]!!.jsonPrimitive.content)
        assertEquals("history:list", r["ch"]!!.jsonPrimitive.content)
        assertEquals("[\"server\"]", r["args"].toString())
        // der Haupt-PC selbst: direkt, ohne Umweg
        assertEquals("[\"x\"]", (parent.call("echo", JsonPrimitive("x")) as JsonObject)["args"].toString())
        link.close()
        scope.cancel()
    }

    @Test fun imageMessagesPassHostValidation() = runBlocking {
        val p = pairOk("Bilder")
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val link = HostLink(scope, { _, _ -> }, { _, _ -> })
        link.use(Target("127.0.0.1", port, p.deviceId, p.key))
        withTimeout(15_000) { while (link.state != LinkState.CONNECTED) delay(20) }
        val img = java.util.Base64.getEncoder().encodeToString(ByteArray(300_000) { (it % 251).toByte() }) // ~400 KB base64
        // so wie die App sendet – geprüft mit validContent aus src/main.js
        for (c in listOf(de.arfep.swapline.model.messageContent("Hallo", emptyList()),
            de.arfep.swapline.model.messageContent("Was siehst du?", listOf(img)),
            de.arfep.swapline.model.messageContent("", List(6) { img }))) {
            assertEquals("true", link.call("content", c).toString())
        }
        // Gegenprobe: ungültige Bilddaten lehnt der Haupt-PC ab
        assertEquals("false", link.call("content", de.arfep.swapline.model.messageContent("x", listOf("kein base64!"))).toString())
        link.close()
        scope.cancel()
    }

    @Test fun largeUploadSurvivesHeartbeat() = runBlocking {
        val p = pairOk("Upload")
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val states = CopyOnWriteArrayList<LinkState>()
        // sehr kurzes Lebenszeichen: darf eine laufende große Übertragung nicht als „tot“ abbrechen
        val link = HostLink(scope, { _, _ -> }, { s, _ -> states += s }, heartbeat = 100, heartbeatTimeout = 300)
        link.use(Target("127.0.0.1", port, p.deviceId, p.key))
        withTimeout(15_000) { while (link.state != LinkState.CONNECTED) delay(20) }
        val bytes = ByteArray(20 * 1024 * 1024) { (it % 253).toByte() }
        val data = java.util.Base64.getEncoder().encodeToString(bytes)
        val r = link.callWithin(120_000, "files:upload", kotlinx.serialization.json.buildJsonObject {
            put("name", JsonPrimitive("bericht.pdf")); put("data", JsonPrimitive(data))
        }).jsonObject
        assertEquals(bytes.size.toString(), r.getValue("size").jsonPrimitive.content)
        assertTrue("Verbindung blieb bestehen", LinkState.RECONNECTING !in states)
        link.close()
        scope.cancel()
    }

    @Test fun heartbeatDetectsDeadConnection() = runBlocking {
        val p = pairOk("Lebenszeichen")
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val states = CopyOnWriteArrayList<LinkState>()
        // Lebenszeichen alle 300 ms, Antwort muss binnen 500 ms kommen
        val link = HostLink(scope, { _, _ -> }, { s, _ -> states += s }, heartbeat = 300, heartbeatTimeout = 500)
        link.use(Target("127.0.0.1", port, p.deviceId, p.key))
        withTimeout(15_000) { while (link.state != LinkState.CONNECTED) delay(20) }
        cmd("mute")  // Haupt-PC antwortet nicht mehr, Verbindung bleibt aber offen
        withTimeout(10_000) { while (LinkState.RECONNECTING !in states) delay(20) }
        cmd("mute off")
        withTimeout(15_000) { while (link.state != LinkState.CONNECTED) delay(20) }
        assertEquals("Lebenszeichen", link.call("echo").jsonObject.getValue("device").jsonPrimitive.content)
        link.close()
        scope.cancel()
    }

    @Test fun triesAddressesInOrder() = runBlocking {
        val p = pairOk("Mehrere")
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val link = HostLink(scope, { _, _ -> }, { _, _ -> })
        // erste Adresse gibt es nicht (z. B. Heimnetz von unterwegs), die zweite ist erreichbar
        link.use(Target("swapline-test.invalid, 127.0.0.1", port, p.deviceId, p.key))
        withTimeout(15_000) { while (link.state != LinkState.CONNECTED) delay(20) }
        assertEquals("Mehrere", link.call("echo").jsonObject.getValue("device").jsonPrimitive.content)
        link.close()
        scope.cancel()
    }

    @Test fun wrongKeyIsRejected() = runBlocking {
        val p = pairOk("Zweites")
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val details = CopyOnWriteArrayList<String?>()
        val link = HostLink(scope, { _, _ -> }, { s, d -> if (s == LinkState.RECONNECTING) details += d })
        link.use(Target("127.0.0.1", port, p.deviceId, ByteArray(32)))
        withTimeout(10_000) { while (details.isEmpty()) delay(20) }
        assertTrue(link.state != LinkState.CONNECTED)
        link.close()
        scope.cancel()
    }

    @Test fun deniedPairing() = runBlocking {
        cmd("deny")
        val code = code()
        try { pair("127.0.0.1", port, code, "Fremd"); fail("abgelehnt erwartet") } catch (e: LinkException) { assertEquals("denied", e.reason) }
        next() // confirm
        // Code gilt nur einmal
        try { pair("127.0.0.1", port, code, "Nochmal"); fail("Fehler erwartet") } catch (e: Exception) { /* Handshake scheitert */ }
    }

    @Test fun wrongCodeFormat() = runBlocking {
        try { pair("127.0.0.1", port, "ABC", "x"); fail() } catch (e: LinkException) { assertEquals("code", e.reason) }
    }
}

class PairLinkTest {
    @Test fun parsesSwaplineLink() {
        val l = PairLinks.parse("swapline://pair?v=1&a=172.16.0.20,100.64.1.2,my-pc.tail.ts.net&p=47820&c=0123456789ABCDEFGHJKMNPQRS&n=DESKTOP-1")!!
        assertEquals(listOf("172.16.0.20", "100.64.1.2", "my-pc.tail.ts.net"), l.addresses)
        assertEquals(47820, l.port)
        assertEquals("0123456789ABCDEFGHJKMNPQRS", l.code)
        assertEquals(16, PairCode.decode(l.code)!!.size)
        assertEquals("DESKTOP-1", l.name)
    }

    @Test fun parsesRelayFromQr() {
        val k = "ab".repeat(32)
        val l = PairLinks.parse("swapline://pair?v=1&a=a%20b&p=47820&c=0123456789ABCDEFGHJKMNPQRS&n=PC&r=relay.example.com%3A47821&h=0123456789abcdef&k=$k")
        assertNull(l) // ungültige Heimnetz-Adresse
        val ok = PairLinks.parse("swapline://pair?v=1&a=172.16.0.20&p=47820&c=0123456789ABCDEFGHJKMNPQRS&n=PC&r=relay.example.com%3A47821&h=0123456789abcdef&k=$k")!!
        assertEquals(RelayRoute("relay.example.com", 47821, "0123456789abcdef", k), ok.relay)
        // kaputte Vermittler-Angaben: Kopplung bleibt möglich, nur ohne Vermittler
        assertNull(PairLinks.parse("swapline://pair?v=1&a=172.16.0.20&p=47820&c=0123456789ABCDEFGHJKMNPQRS&r=x%3A99999&h=zz&k=1")!!.relay)
    }

    @Test fun rejectsForeignOrBrokenLinks() {
        val ok = "swapline://pair?v=1&a=172.16.0.20&p=47820&c=0123456789ABCDEFGHJKMNPQRS"
        assertTrue(PairLinks.parse(ok) != null)
        for (bad in listOf(
            "https://example.com/?a=1",
            ok.replace("v=1", "v=2"),
            ok.replace("172.16.0.20", "999.1.1.1"),
            ok.replace("172.16.0.20", "\\\\server\\share"),
            ok.replace("172.16.0.20", "a b"),
            ok.replace("47820", "80"),
            ok.replace("0123456789ABCDEFGHJKMNPQRS", "0123456789ABCDEFGHJKMNPQRU"),
            ok.replace("&c=0123456789ABCDEFGHJKMNPQRS", ""),
            ok + "&a=" + "x".repeat(1000),
        )) assertNull(bad, PairLinks.parse(bad))
    }

    @Test fun unreachableAddressIsReportedAsSuch() = kotlinx.coroutines.runBlocking {
        try { pair("127.0.0.1", 1, "0123456789ABCDEFGHJKMNPQRS", "x", 2_000); fail() } catch (e: LinkException) { assertEquals("unreachable", e.reason) }
    }
}
