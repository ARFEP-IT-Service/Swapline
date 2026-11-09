// Bilder an Claude anhängen: aus der Galerie (Android-Fotoauswahl, keine Speicher-Berechtigung nötig) oder mit der
// Kamera. Bilder werden auf dem Handy verkleinert (längste Seite 1600 px, JPEG) und gehen als Bild-Block an den
// Haupt-PC – wie Anhänge in Swapline am PC (dort: png/jpeg/gif/webp, je höchstens 5 MB).
package de.arfep.swapline.ui

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File

const val MAX_ATTACH = 6
private const val MAX_SIDE = 1600
private const val MAX_BASE64 = 7_000_000 // Grenze des Haupt-PCs je Bild

// Bild (thumb gesetzt, JPEG) oder Dokument (name/size; geht als Datei an den Haupt-PC, Claude bekommt den Pfad)
class Attach(val data: String, val thumb: ImageBitmap?, val name: String = "", val size: Long = 0) { val isImage get() = thumb != null }

const val MAX_DOC = 25L * 1024 * 1024 // Grenze des Haupt-PCs je Datei

fun sizeText(b: Long) = when { b < 1024 -> "$b B"; b < 1024 * 1024 -> "${b / 1024} KB"; else -> String.format("%.1f MB", b / 1048576.0) }

// Dokument einlesen (beliebiger Dateityp, auch aus Cloud-Speichern); null = zu groß oder nicht lesbar
suspend fun loadDoc(ctx: Context, uri: Uri): Result<Attach> = withContext(Dispatchers.IO) {
    runCatching {
        var name = "datei"; var size = -1L
        ctx.contentResolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME, android.provider.OpenableColumns.SIZE), null, null, null)?.use { c ->
            if (c.moveToFirst()) {
                c.getString(0)?.let { name = it }
                if (!c.isNull(1)) size = c.getLong(1)
            }
        }
        if (size > MAX_DOC) error(tr("„$name“ ist zu groß (höchstens 25 MB).", "“$name” is too large (max. 25 MB).", "“$name” çok büyük (en fazla 25 MB)."))
        val bytes = ctx.contentResolver.openInputStream(uri)!!.use { s ->
            val out = ByteArrayOutputStream(); val buf = ByteArray(64 * 1024); var total = 0L
            while (true) { val n = s.read(buf); if (n < 0) break; total += n; if (total > MAX_DOC) error(tr("„$name“ ist zu groß (höchstens 25 MB).", "“$name” is too large (max. 25 MB).", "“$name” çok büyük (en fazla 25 MB).")); out.write(buf, 0, n) }
            out.toByteArray()
        }
        Attach(Base64.encodeToString(bytes, Base64.NO_WRAP), null, name.take(120), bytes.size.toLong())
    }
}

// Bild laden, drehen wie aufgenommen (ImageDecoder beachtet EXIF), verkleinern und als JPEG kodieren
suspend fun loadAttach(ctx: Context, uri: Uri): Attach? = withContext(Dispatchers.IO) {
    runCatching {
        val bmp: Bitmap = if (Build.VERSION.SDK_INT >= 28) {
            ImageDecoder.decodeBitmap(ImageDecoder.createSource(ctx.contentResolver, uri)) { dec, info, _ ->
                val w = info.size.width; val h = info.size.height
                val scale = minOf(1f, MAX_SIDE.toFloat() / maxOf(w, h))
                if (scale < 1f) dec.setTargetSize((w * scale).toInt().coerceAtLeast(1), (h * scale).toInt().coerceAtLeast(1))
                dec.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
            }
        } else {
            val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            ctx.contentResolver.openInputStream(uri)!!.use { BitmapFactory.decodeStream(it, null, opts) }
            var sample = 1
            while (maxOf(opts.outWidth, opts.outHeight) / (sample * 2) >= MAX_SIDE) sample *= 2
            val raw = ctx.contentResolver.openInputStream(uri)!!.use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample }) }!!
            val scale = minOf(1f, MAX_SIDE.toFloat() / maxOf(raw.width, raw.height))
            if (scale < 1f) Bitmap.createScaledBitmap(raw, (raw.width * scale).toInt(), (raw.height * scale).toInt(), true) else raw
        }
        var quality = 88
        var b64: String
        do {
            val out = ByteArrayOutputStream()
            bmp.compress(Bitmap.CompressFormat.JPEG, quality, out)
            b64 = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
            quality -= 15
        } while (b64.length > MAX_BASE64 && quality > 30)
        if (b64.length > MAX_BASE64) return@runCatching null
        val tw = 160; val th = (bmp.height * tw / bmp.width.toFloat()).toInt().coerceAtLeast(1)
        Attach(b64, Bitmap.createScaledBitmap(bmp, tw, th, true).asImageBitmap())
    }.getOrNull()
}

class AttachPicker(val gallery: () -> Unit, val camera: () -> Unit, val document: () -> Unit)

@Composable
fun rememberAttachPicker(remaining: () -> Int, onAdd: (List<Attach>) -> Unit, onError: (String) -> Unit): AttachPicker {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val add by rememberUpdatedState(onAdd)
    val err by rememberUpdatedState(onError)
    var photoUri by remember { mutableStateOf<Uri?>(null) }
    fun load(uris: List<Uri>) = scope.launch {
        val list = uris.take(remaining()).mapNotNull { loadAttach(ctx, it) }
        if (list.size < uris.size.coerceAtMost(remaining())) err(tr("Ein Bild konnte nicht gelesen werden.", "An image could not be read."))
        if (list.isNotEmpty()) add(list)
    }
    val docs = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        scope.launch {
            val list = mutableListOf<Attach>()
            for (u in uris.take(remaining())) loadDoc(ctx, u).onSuccess { list += it }.onFailure { err(it.message ?: tr("Datei konnte nicht gelesen werden.", "File could not be read.")) }
            if (list.isNotEmpty()) add(list)
        }
    }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(MAX_ATTACH)) { uris -> if (uris.isNotEmpty()) load(uris) }
    val take = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val u = photoUri
        if (ok && u != null) scope.launch {
            load(listOf(u)).join()
            runCatching { ctx.contentResolver.delete(u, null, null) } // Foto nicht aufbewahren
            File(ctx.cacheDir, "camera").listFiles()?.forEach { it.delete() }
        }
    }
    fun startCamera() {
        // Foto landet nur im App-eigenen Zwischenspeicher und wird nach dem Lesen nicht weiter aufbewahrt
        val dir = File(ctx.cacheDir, "camera").apply { mkdirs(); listFiles()?.forEach { it.delete() } }
        val f = File(dir, "photo-${System.currentTimeMillis()}.jpg")
        val u = FileProvider.getUriForFile(ctx, ctx.packageName + ".files", f)
        photoUri = u
        runCatching { take.launch(u) }.onFailure { err(tr("Keine Kamera-App gefunden.", "No camera app found.")) }
    }
    val camPerm = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        if (ok) startCamera() else err(tr("Für Fotos braucht Swapline die Kamera.", "Swapline needs the camera for photos."))
    }
    return remember {
        AttachPicker(
            gallery = { if (remaining() > 0) pick.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) else err(tr("Höchstens $MAX_ATTACH Anhänge je Nachricht.", "At most $MAX_ATTACH attachments per message.", "Mesaj başına en fazla $MAX_ATTACH ek.")) },
            document = { if (remaining() > 0) docs.launch(arrayOf("*/*")) else err(tr("Höchstens $MAX_ATTACH Anhänge je Nachricht.", "At most $MAX_ATTACH attachments per message.", "Mesaj başına en fazla $MAX_ATTACH ek.")) },
            camera = {
                if (remaining() <= 0) err(tr("Höchstens $MAX_ATTACH Bilder je Nachricht.", "At most $MAX_ATTACH images per message.", "Mesaj başına en fazla $MAX_ATTACH görsel."))
                // Die App führt die Kamera-Berechtigung (QR-Code) – Android verlangt sie dann auch für die Kamera-App
                else if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) startCamera()
                else camPerm.launch(Manifest.permission.CAMERA)
            },
        )
    }
}
