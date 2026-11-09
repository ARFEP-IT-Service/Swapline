// Fernzugriff auf einen Haupt-PC mit Swapline – dasselbe Protokoll wie src/remote.js:
// TLS 1.2 mit vorab geteiltem Schlüssel (ECDHE-PSK-CHACHA20-POLY1305), eine JSON-Zeile je Nachricht.
// Gerät → Haupt-PC: {t:'req', id, ch, args}. Haupt-PC → Gerät: {t:'res', id, ok, value | error} und {t:'evt', kind, data}.
// Koppeln: Identität 'pair' mit dem Schlüssel aus dem Einmal-Code; der Haupt-PC bestätigt und schickt
// Geräte-ID und einen eigenen 256-Bit-Schlüssel.
package de.arfep.swapline.net

import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import org.bouncycastle.tls.BasicTlsPSKIdentity
import org.bouncycastle.tls.CipherSuite
import org.bouncycastle.tls.PSKTlsClient
import org.bouncycastle.tls.ProtocolVersion
import org.bouncycastle.tls.TlsClientProtocol
import org.bouncycastle.tls.crypto.impl.bc.BcTlsCrypto
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

const val DEFAULT_PORT = 47820
// Diagnose im Log nur in Debug-Builds (Release: keine Adressen oder Fehlertexte im Systemprotokoll)
private val DEBUG_LOG = runCatching { Class.forName("android.util.Log"); de.arfep.swapline.BuildConfig.DEBUG }.getOrDefault(false)
private const val MAX_FRAME = 48 * 1024 * 1024
private const val CONNECT_TIMEOUT = 15_000
private const val CALL_TIMEOUT = 120_000L
private const val HEARTBEAT = 4 * 60_000L
private const val HEARTBEAT_TIMEOUT = 30_000L
private const val PAIR_TIMEOUT = 5 * 60_000L + 10_000L
private val DEVICE_ID_RE = Regex("^[0-9a-f]{16}$")

val json = Json { ignoreUnknownKeys = true }

// ---------- Einmal-Code (Crockford-Base32 wie in remote.js) ----------
object PairCode {
    private const val B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

    fun decode(code: String): ByteArray? {
        val clean = code.uppercase().replace(Regex("[\\s-]"), "").replace('O', '0').replace(Regex("[IL]"), "1")
        var bits = 0
        var value = 0
        val out = ByteArrayOutputStream()
        for (ch in clean) {
            val i = B32.indexOf(ch)
            if (i < 0) return null
            value = (value shl 5) or i
            bits += 5
            if (bits >= 8) {
                out.write((value ushr (bits - 8)) and 255)
                bits -= 8
            }
            value = value and 0xFFFF
        }
        return out.toByteArray()
    }

    fun key(secret: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").run {
        update("swapline-pair-v1".toByteArray())
        update(secret)
        digest()
    }
}

class LinkException(val reason: String, message: String = reason) : IOException(message)

// ---------- TLS-PSK über BouncyCastle ----------
private class PskClient(identity: ByteArray, key: ByteArray) :
    PSKTlsClient(BcTlsCrypto(SecureRandom()), BasicTlsPSKIdentity(identity, key)) {
    override fun getSupportedVersions(): Array<ProtocolVersion> = ProtocolVersion.TLSv12.only()
    override fun getSupportedCipherSuites(): IntArray = intArrayOf(CipherSuite.TLS_ECDHE_PSK_WITH_CHACHA20_POLY1305_SHA256)
}

private class Channel(val socket: Socket, val input: InputStream, val output: OutputStream) {
    private val lock = Any()
    private val buf = ByteArrayOutputStream()
    private val chunk = ByteArray(16 * 1024)
    private var pending = ByteArray(0)
    private var pendingPos = 0

    fun write(obj: JsonElement) {
        val bytes = (obj.toString() + "\n").toByteArray(Charsets.UTF_8)
        synchronized(lock) { output.write(bytes); output.flush() }
    }

    // Senden ohne den aufrufenden Thread zu blockieren (Android verbietet Netzwerk auf dem UI-Thread):
    // ein eigener Thread je Verbindung, Nachrichten in der Reihenfolge des Aufrufs
    private val writer = java.util.concurrent.Executors.newSingleThreadExecutor { r -> Thread(r, "swapline-send").apply { isDaemon = true } }
    fun send(obj: JsonElement, onError: (Exception) -> Unit) {
        try { writer.execute { try { write(obj) } catch (e: Exception) { onError(e) } } }
        catch (e: java.util.concurrent.RejectedExecutionException) { onError(e) }
    }

    // Nächste Zeile; null = Verbindung beendet. Zu große Nachrichten beenden die Verbindung.
    fun readLine(): String? {
        while (true) {
            while (pendingPos < pending.size) {
                val b = pending[pendingPos++]
                if (b == '\n'.code.toByte()) {
                    val line = buf.toString(Charsets.UTF_8.name())
                    buf.reset()
                    if (line.isNotEmpty()) return line
                } else {
                    buf.write(b.toInt())
                    if (buf.size() > MAX_FRAME) throw LinkException("frame", "Nachricht zu groß")
                }
            }
            val n = try { input.read(chunk) } catch (e: IOException) { if (socket.isClosed) -1 else throw e }
            if (n < 0) return null
            pending = chunk.copyOf(n)
            pendingPos = 0
        }
    }

    fun close() { runCatching { socket.close() }; writer.shutdown() }
}

private fun open(address: String, port: Int, identity: ByteArray, key: ByteArray, connectTimeout: Int = CONNECT_TIMEOUT): Channel {
    val socket = Socket()
    try {
        socket.connect(InetSocketAddress(address, port), connectTimeout)
        socket.soTimeout = 0
        socket.keepAlive = true
        socket.tcpNoDelay = true
        val proto = TlsClientProtocol(socket.getInputStream(), socket.getOutputStream())
        socket.soTimeout = CONNECT_TIMEOUT
        proto.connect(PskClient(identity, key))
        socket.soTimeout = 0
        return Channel(socket, proto.inputStream, proto.outputStream)
    } catch (e: Exception) {
        runCatching { socket.close() }
        throw e
    }
}

// ---------- Koppeln ----------
data class Paired(val deviceId: String, val key: ByteArray, val hostName: String)

suspend fun pair(address: String, port: Int, code: String, name: String, connectTimeout: Int = CONNECT_TIMEOUT): Paired = withContext(Dispatchers.IO) {
    val secret = PairCode.decode(code)
    if (secret == null || secret.size != 16) throw LinkException("code", "Ungültiger Code")
    withTimeout(PAIR_TIMEOUT) {
        val ch = try { open(address, port, "pair".toByteArray(), PairCode.key(secret), connectTimeout) }
        catch (e: java.net.SocketTimeoutException) { throw LinkException("unreachable", e.message ?: "timeout") }
        catch (e: java.net.ConnectException) { throw LinkException("unreachable", e.message ?: "refused") }
        catch (e: java.net.NoRouteToHostException) { throw LinkException("unreachable", e.message ?: "no route") }
        catch (e: java.net.UnknownHostException) { throw LinkException("unreachable", e.message ?: "unknown host") }
        suspendCancellableCoroutine { cont ->
            cont.invokeOnCancellation { ch.close() }
            try {
                ch.write(buildJsonObject { put("t", "pair"); put("name", name) })
                while (true) {
                    val line = ch.readLine() ?: throw LinkException("closed", "Verbindung beendet")
                    val m = runCatching { json.parseToJsonElement(line).jsonObject }.getOrNull() ?: continue
                    when (m.str("t")) {
                        "paired" -> {
                            val id = m.str("deviceId")
                            val key = m.str("key")?.let { runCatching { Base64.getDecoder().decode(it) }.getOrNull() }
                            if (id == null || !DEVICE_ID_RE.matches(id) || key == null || key.size != 32) throw LinkException("invalid", "Ungültige Antwort")
                            cont.resume(Paired(id, key, (m.str("hostName") ?: "").take(40)))
                            break
                        }
                        "pair-denied" -> throw LinkException("denied", "Am Haupt-PC abgelehnt")
                    }
                }
            } catch (e: Exception) {
                if (cont.isActive) cont.resumeWithException(e)
            } finally {
                ch.close()
            }
        }
    }
}

// ---------- Verbindung zu einem gekoppelten Haupt-PC ----------
// address: eine oder mehrere Adressen, durch Komma getrennt (z. B. Heimnetz, dann öffentliche IP) – der Reihe nach probiert
data class Target(val address: String, val port: Int, val deviceId: String, val key: ByteArray) {
    val addresses get() = address.split(',').map { it.trim() }.filter { it.isNotEmpty() }
}

private fun unreachable(e: Exception) = e is java.net.SocketTimeoutException || e is java.net.ConnectException ||
    e is java.net.NoRouteToHostException || e is java.net.UnknownHostException

// Erste erreichbare Adresse; nicht erreichbare kosten nur ein kurzes Warten
private fun openAny(t: Target): Channel {
    val list = t.addresses.ifEmpty { throw LinkException("unreachable", "keine Adresse") }
    var last: Exception? = null
    for (a in list) {
        try { return open(a, t.port, t.deviceId.toByteArray(), t.key, if (list.size > 1) 4_000 else CONNECT_TIMEOUT) }
        catch (e: Exception) { if (unreachable(e)) last = e else throw e }
    }
    throw last!!
}

enum class LinkState { OFF, CONNECTING, CONNECTED, RECONNECTING }

class HostLink(
    private val scope: CoroutineScope,
    private val onEvent: (kind: String, data: JsonElement) -> Unit,
    private val onState: (LinkState, String?) -> Unit,
    private val heartbeat: Long = HEARTBEAT,
    private val heartbeatTimeout: Long = HEARTBEAT_TIMEOUT,
) {
    @Volatile var state = LinkState.OFF
        private set
    @Volatile private var target: Target? = null
    @Volatile private var channel: Channel? = null
    private var job: Job? = null
    private val nextId = AtomicInteger(1)
    private val calls = ConcurrentHashMap<Int, CancellableContinuation<JsonElement>>()

    private fun setState(s: LinkState, detail: String? = null) { state = s; onState(s, detail) }

    fun use(t: Target?) {
        job?.cancel()
        channel?.close()
        channel = null
        failAll(if (t == null) "Getrennt" else "Neu verbunden")
        target = t
        if (t == null) { setState(LinkState.OFF); return }
        job = scope.launch(Dispatchers.IO) { run(t) }
    }

    private suspend fun run(t: Target) {
        var backoff = 2_000L
        var first = true
        while (scope.isActive && target === t) {
            setState(if (first) LinkState.CONNECTING else LinkState.RECONNECTING)
            first = false
            var detail: String? = null
            var mine: Channel? = null
            try {
                val ch = openAny(t)
                if (target !== t) { ch.close(); return }
                mine = ch
                channel = ch
                backoff = 2_000L
                setState(LinkState.CONNECTED)
                // Lebenszeichen: Router und Mobilfunk kappen stille Verbindungen oft ohne Meldung. Alle paar Minuten eine
                // kleine Anfrage; bleibt die Antwort aus, gilt die Verbindung als tot und wird neu aufgebaut.
                val beat = scope.launch {
                    while (channel === ch) {
                        delay(heartbeat)
                        if (channel !== ch) break
                        try { withTimeout(heartbeatTimeout) { call("tabs:list") } }
                        catch (e: kotlinx.coroutines.TimeoutCancellationException) { ch.close(); break }
                        catch (e: Exception) { /* Fehler vom Haupt-PC = Verbindung lebt */ }
                    }
                }
                try {
                    while (true) {
                        val line = ch.readLine()
                        if (line == null) { detail = "closed"; break }
                        val m = runCatching { json.parseToJsonElement(line) as? JsonObject }.getOrNull()
                        if (m == null) { detail = "bad json: " + line.take(120); break }
                        handle(m)
                    }
                } finally { beat.cancel() }
            } catch (e: Exception) {
                detail = e.javaClass.simpleName + ": " + e.message
                if (DEBUG_LOG) runCatching { android.util.Log.w("SwaplineLink", "Verbindung beendet", e) }
            } finally {
                if (DEBUG_LOG) runCatching { android.util.Log.i("SwaplineLink", "Ende: " + detail) }
                // nur die eigene Verbindung aufräumen – eine inzwischen neu aufgebaute bleibt bestehen
                mine?.close()
                if (channel === mine && mine != null) { channel = null; failAll("Verbindung zum Haupt-PC getrennt") }
            }
            if (target !== t) return
            setState(LinkState.RECONNECTING, detail)
            delay(backoff)
            backoff = (backoff * 2).coerceAtMost(30_000L)
        }
    }

    private fun handle(m: JsonObject) {
        when (m.str("t")) {
            "res" -> {
                val id = (m["id"] as? JsonPrimitive)?.intOrNull ?: return
                val c = calls.remove(id) ?: return
                if ((m["ok"] as? JsonPrimitive)?.booleanOrNull == true) c.resume(m["value"] ?: JsonNull)
                else c.resumeWithException(LinkException("remote", m.str("error") ?: "Fehler"))
            }
            "evt" -> {
                val kind = m.str("kind") ?: return
                runCatching { onEvent(kind, m["data"] ?: JsonNull) }
            }
        }
    }

    // Offene Anfragen beenden. Andere Threads können gleichzeitig Einträge entfernen (Antwort, Abbruch) –
    // jeder Eintrag wird genau einmal per remove() übernommen.
    private fun failAll(why: String) {
        for (id in calls.keys.toTypedArray()) calls.remove(id)?.let { c -> if (c.isActive) c.resumeWithException(LinkException("offline", why)) }
    }

    // Anfrage an den Haupt-PC; der Haupt-PC prüft jede Anfrage selbst
    suspend fun call(ch: String, vararg args: JsonElement): JsonElement = withTimeout(CALL_TIMEOUT) {
        val c = channel
        if (c == null || state != LinkState.CONNECTED) throw LinkException("offline", "Nicht mit dem Haupt-PC verbunden")
        val id = nextId.getAndIncrement()
        suspendCancellableCoroutine { cont ->
            calls[id] = cont
            cont.invokeOnCancellation { calls.remove(id) }
            try {
                c.send(buildJsonObject { put("t", "req"); put("id", id); put("ch", ch); put("args", JsonArray(args.toList())) }) { e ->
                    calls.remove(id)?.let { if (it.isActive) it.resumeWithException(LinkException("offline", e.message ?: "Senden fehlgeschlagen")) }
                }
            } catch (e: Exception) {
                calls.remove(id)
                if (cont.isActive) cont.resumeWithException(LinkException("offline", e.message ?: "Senden fehlgeschlagen"))
            }
        }
    }

    fun close() = use(null)
}

fun JsonObject.str(k: String): String? = (this[k] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
