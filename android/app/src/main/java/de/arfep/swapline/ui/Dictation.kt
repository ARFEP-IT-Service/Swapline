// Diktieren ins Eingabefeld: Android-Spracherkennung, wenn möglich auf dem Gerät (Sprache verlässt das Handy nicht).
// Der erkannte Text erscheint live im Feld und wird erst mit „Senden“ verschickt – nie automatisch.
package de.arfep.swapline.ui

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import java.util.Locale

class Dictation internal constructor(private val ctx: Context, private val onText: (String) -> Unit, private val onError: (String) -> Unit) {
    var listening by mutableStateOf(false)
        private set
    var level by mutableStateOf(0f)   // Lautstärke 0…1 für die Anzeige
        private set
    val available = SpeechRecognizer.isRecognitionAvailable(ctx) || (Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(ctx))
    private var recognizer: SpeechRecognizer? = null
    private var base = ""          // Text im Feld vor dem Diktieren
    private var done = ""          // bereits abgeschlossene Sätze dieser Aufnahme

    private fun join(vararg parts: String) = parts.filter { it.isNotBlank() }.joinToString(" ") { it.trim() }

    fun start(current: String) {
        if (listening) return
        base = current
        done = ""
        val onDevice = Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(ctx)
        val r = (if (onDevice) SpeechRecognizer.createOnDeviceSpeechRecognizer(ctx) else SpeechRecognizer.createSpeechRecognizer(ctx))
        recognizer = r
        r.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) { listening = true }
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) { level = ((rmsdB + 2f) / 12f).coerceIn(0f, 1f) }
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onPartialResults(b: Bundle?) {
                val t = b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: return
                onText(join(base, done, t))
            }
            override fun onResults(b: Bundle?) {
                val t = b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
                done = join(done, t)
                onText(join(base, done))
                stop()
            }
            override fun onError(error: Int) {
                val silent = error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT || error == SpeechRecognizer.ERROR_CLIENT
                if (!silent) onError(when (error) {
                    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> tr("Kein Zugriff aufs Mikrofon", "No microphone access")
                    SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> tr("Spracherkennung braucht hier eine Internetverbindung", "Speech recognition needs an internet connection here")
                    SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED, SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE -> tr("Sprache für die Erkennung nicht installiert", "Language not installed for recognition")
                    else -> tr("Spracherkennung fehlgeschlagen (Code $error)", "Speech recognition failed (code $error)")
                })
                stop()
            }
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag())
            .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
            // längere Pausen beim Sprechen erlauben, bevor die Aufnahme endet
            .putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 2500L)
            .putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 2500L)
        listening = true
        r.startListening(intent)
    }

    fun stop() {
        listening = false
        level = 0f
        recognizer?.let { runCatching { it.stopListening() }; runCatching { it.destroy() } }
        recognizer = null
    }
}

@Composable
fun rememberDictation(onText: (String) -> Unit, onError: (String) -> Unit): Pair<Dictation, (String) -> Unit> {
    val ctx = LocalContext.current
    val text by rememberUpdatedState(onText)
    val err by rememberUpdatedState(onError)
    val d = remember { Dictation(ctx, { text(it) }, { err(it) }) }
    var pending by remember { mutableStateOf<String?>(null) }
    val perm = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        val p = pending; pending = null
        if (ok && p != null) d.start(p) else if (!ok) err(tr("Für das Diktieren braucht Swapline das Mikrofon.", "Swapline needs the microphone for dictation."))
    }
    DisposableEffect(Unit) { onDispose { d.stop() } }
    // Umschalten: starten (ggf. erst Mikrofon erlauben) oder beenden
    val toggle: (String) -> Unit = { current ->
        if (d.listening) d.stop()
        else if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) d.start(current)
        else { pending = current; perm.launch(Manifest.permission.RECORD_AUDIO) }
    }
    return d to toggle
}
