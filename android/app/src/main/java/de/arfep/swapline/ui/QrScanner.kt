@file:OptIn(ExperimentalMaterial3Api::class)

package de.arfep.swapline.ui

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.MultiFormatReader
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.common.HybridBinarizer
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

// QR-Code mit der Kamera lesen – nur in der App, Bilder werden nicht gespeichert und nirgends hingeschickt
@Composable
fun QrScanner(onBack: () -> Unit, onResult: (String) -> Unit) {
    val ctx = LocalContext.current
    var granted by remember { mutableStateOf(ContextCompat.checkSelfPermission(ctx, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted = it }
    LaunchedEffect(Unit) { if (!granted) ask.launch(Manifest.permission.CAMERA) }
    Scaffold(topBar = {
        TopAppBar(title = { Text(tr("QR-Code scannen", "Scan QR code")) },
            navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, tr("Zurück", "Back")) } })
    }) { pad ->
        Box(Modifier.fillMaxSize().padding(pad), contentAlignment = Alignment.Center) {
            if (!granted) Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(32.dp)) {
                Text(tr("Für den QR-Code braucht Swapline die Kamera.", "Swapline needs the camera for the QR code."), color = MaterialTheme.colorScheme.onSurfaceVariant)
                Button(onClick = { ask.launch(Manifest.permission.CAMERA) }, Modifier.padding(top = 12.dp)) { Text(tr("Kamera erlauben", "Allow camera")) }
            } else {
                CameraView(onResult)
                Box(Modifier.size(260.dp).border(3.dp, Color.White.copy(alpha = 0.85f), RoundedCornerShape(24.dp)))
                Text(tr("QR-Code aus Swapline am PC (Fernzugriff → „Gerät koppeln …“) ins Bild halten", "Point at the QR code in Swapline on the PC (Remote access → “Pair device …”)"),
                    Modifier.align(Alignment.BottomCenter).padding(24.dp), color = Color.White)
            }
        }
    }
}

@Composable
private fun CameraView(onResult: (String) -> Unit) {
    val ctx = LocalContext.current
    val owner = LocalLifecycleOwner.current
    val done = remember { AtomicBoolean(false) }
    val executor = remember { Executors.newSingleThreadExecutor() }
    val reader = remember { MultiFormatReader().apply { setHints(mapOf(DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE), DecodeHintType.TRY_HARDER to true)) } }
    DisposableEffect(Unit) { onDispose { executor.shutdown() } }
    AndroidView(modifier = Modifier.fillMaxSize(), factory = { c ->
        val view = PreviewView(c)
        val future = ProcessCameraProvider.getInstance(c)
        future.addListener({
            val provider = future.get()
            val preview = Preview.Builder().build().also { it.surfaceProvider = view.surfaceProvider }
            val analysis = ImageAnalysis.Builder().setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build()
            analysis.setAnalyzer(executor) { img -> decode(reader, img)?.let { if (done.compareAndSet(false, true)) ContextCompat.getMainExecutor(ctx).execute { onResult(it) } } }
            provider.unbindAll()
            runCatching { provider.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis) }
        }, ContextCompat.getMainExecutor(c))
        view
    })
}

private fun decode(reader: MultiFormatReader, img: ImageProxy): String? = try {
    val plane = img.planes[0]
    val buf = plane.buffer
    val data = ByteArray(buf.remaining()).also { buf.get(it) }
    val src = PlanarYUVLuminanceSource(data, plane.rowStride, img.height, 0, 0, img.width, img.height, false)
    reader.decodeWithState(BinaryBitmap(HybridBinarizer(src))).text
} catch (_: Exception) {
    null
} finally {
    reader.reset()
    img.close()
}
