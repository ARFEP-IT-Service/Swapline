package de.arfep.swapline.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.util.Locale

// Oberfläche Deutsch oder Englisch nach Systemsprache (wie tr() in src/main.js)
fun tr(de: String, en: String): String = if (Locale.getDefault().language == "de") de else en

val Accent = Color(0xFF1581FF)
val Danger = Color(0xFFE5484D)
val Ok = Color(0xFF30A46C)

private val Dark = darkColorScheme(
    primary = Accent, onPrimary = Color.White, primaryContainer = Accent, onPrimaryContainer = Color.White,
    background = Color(0xFF0F1115), onBackground = Color(0xFFE6E8EB),
    surface = Color(0xFF0F1115), onSurface = Color(0xFFE6E8EB),
    surfaceVariant = Color(0xFF1B1F26), onSurfaceVariant = Color(0xFF9BA1A9),
    surfaceContainer = Color(0xFF161A20), surfaceContainerHigh = Color(0xFF1B1F26), surfaceContainerHighest = Color(0xFF232832),
    secondaryContainer = Color(0xFF1E3350), onSecondaryContainer = Color(0xFFD6E6FF),
    outline = Color(0xFF353B45), outlineVariant = Color(0xFF262B33), error = Danger,
)
private val Light = lightColorScheme(
    primary = Accent, onPrimary = Color.White, primaryContainer = Accent, onPrimaryContainer = Color.White,
    background = Color(0xFFF7F8FA), surface = Color(0xFFF7F8FA),
    surfaceVariant = Color(0xFFECEEF2), surfaceContainer = Color(0xFFF0F2F5), surfaceContainerHigh = Color(0xFFE9ECF0), surfaceContainerHighest = Color(0xFFE1E5EA),
    secondaryContainer = Color(0xFFDCEBFF), onSecondaryContainer = Color(0xFF0B2A52),
    error = Danger,
)

@Composable
fun SwaplineTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (isSystemInDarkTheme()) Dark else Light, content = content)
}

fun parseColor(hex: String): Color = runCatching { Color(android.graphics.Color.parseColor(hex)) }.getOrDefault(Accent)

// Initialen auf Farbfläche – wie die Projekt- und Konto-Symbole in Swapline
@Composable
fun Avatar(name: String, color: String, size: Dp = 36.dp, modifier: Modifier = Modifier) {
    val initials = name.split(Regex("\\s+")).filter { it.isNotEmpty() }.take(2).joinToString("") { it.take(1).uppercase() }.ifEmpty { "?" }
    Box(modifier.size(size).background(parseColor(color), RoundedCornerShape(size * 0.3f)), contentAlignment = Alignment.Center) {
        Text(initials, color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = (size.value * 0.38f).sp)
    }
}

fun ago(ms: Long): String {
    if (ms <= 0) return ""
    val d = (System.currentTimeMillis() - ms) / 1000
    return when {
        d < 60 -> tr("gerade eben", "just now")
        d < 3600 -> tr("vor ${d / 60} Min.", "${d / 60} min ago")
        d < 86400 -> tr("vor ${d / 3600} Std.", "${d / 3600} h ago")
        else -> tr("vor ${d / 86400} T.", "${d / 86400} d ago")
    }
}

fun folderName(p: String) = p.replace('\\', '/').trimEnd('/').substringAfterLast('/').ifEmpty { p }
