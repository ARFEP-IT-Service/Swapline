// Bilder in Antworten von Claude: Dateien vom Haupt-PC (geprüft: nur Bilder aus freigegebenen Ordnern), Bilder aus dem
// Internet erst nach Tippen (über den Haupt-PC, nur https und öffentliche Adressen). Antippen zeigt das Bild groß.
package de.arfep.swapline.ui

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

// Quelle für Bilder des offenen Chats (setzt der Chat-Bildschirm); Ergebnis: Bild oder Fehlertext
fun interface ImageSource { suspend fun load(src: String, web: Boolean): Pair<ImageBitmap?, String?> }
val LocalImages = staticCompositionLocalOf<ImageSource?> { null }

// base64 → Bild, höchstens 2048 Pixel an der langen Seite (große Fotos nicht in voller Größe in den Speicher)
fun decodeImage(b64: String): ImageBitmap? = runCatching {
    val bytes = java.util.Base64.getDecoder().decode(b64)
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 2048) sample *= 2
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })?.asImageBitmap()
}.getOrNull()

private val SCHEME = Regex("^[a-z][a-z0-9+.-]*:", RegexOption.IGNORE_CASE)
private val WIN_DRIVE = Regex("^[a-z]:[\\\\/]", RegexOption.IGNORE_CASE)

@Composable
fun MdImage(alt: String, src: String) {
    val source = LocalImages.current
    val web = src.startsWith("https://", ignoreCase = true)
    // http:, ftp: … nie laden; Dateipfade (auch C:\…) und https schon
    if (!web && SCHEME.containsMatchIn(src) && !WIN_DRIVE.containsMatchIn(src) && !src.startsWith("file:", ignoreCase = true)) return
    val label = alt.ifBlank { src.substringAfterLast('/').substringAfterLast('\\') }
    var go by remember(src) { mutableStateOf(!web) }
    var result by remember(src) { mutableStateOf<Pair<ImageBitmap?, String?>?>(null) }
    if (go && source != null) LaunchedEffect(src) { result = source.load(src, web) }
    val r = result
    when {
        source == null -> Text("🖼 $label", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        !go -> {
            val host = runCatching { java.net.URI(src).host }.getOrNull().orEmpty()
            OutlinedButton(onClick = { go = true }) { Text("🖼 " + tr("Bild von $host laden", "Load image from $host", "$host adresinden görseli yükle"), fontSize = 13.sp) }
        }
        r == null -> CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
        r.first != null -> ZoomableThumb(r.first!!, alt, Modifier.fillMaxWidth().heightIn(max = 320.dp))
        else -> Text("🖼 $label – " + tr("nicht anzeigbar", "cannot be shown") + (r.second?.let { " ($it)" } ?: ""), fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

// Bild aus einem Werkzeug-Ergebnis (base64), z. B. wenn Claude einen Screenshot liest
@Composable
fun Base64Thumb(b64: String, modifier: Modifier) {
    val bmp by produceState<ImageBitmap?>(null, b64) { value = withContext(Dispatchers.Default) { decodeImage(b64) } }
    bmp?.let { ZoomableThumb(it, null, modifier) }
}

@Composable
private fun ZoomableThumb(bmp: ImageBitmap, alt: String?, modifier: Modifier) {
    var full by remember { mutableStateOf(false) }
    Image(bmp, alt, modifier.clip(RoundedCornerShape(10.dp)).border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(10.dp)).clickable { full = true },
        contentScale = ContentScale.Fit, alignment = Alignment.CenterStart)
    if (full) Dialog(onDismissRequest = { full = false }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.92f)).clickable { full = false }.padding(12.dp), contentAlignment = Alignment.Center) {
            Image(bmp, alt, Modifier.fillMaxWidth(), contentScale = ContentScale.Fit)
        }
    }
}
