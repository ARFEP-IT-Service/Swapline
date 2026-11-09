// Schlanke Markdown-Anzeige für Antworten von Claude: Absätze, Überschriften, Listen, Zitate, Code-Blöcke,
// **fett**, *kursiv*, `Code` und Links (nur https, öffnen im Browser).
package de.arfep.swapline.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

sealed class Block {
    data class Para(val text: String) : Block()
    data class Heading(val level: Int, val text: String) : Block()
    data class Bullet(val marker: String, val text: String, val indent: Int) : Block()
    data class Quote(val text: String) : Block()
    data class Code(val lang: String, val code: String) : Block()
    data object Rule : Block()
}

fun parseMarkdown(src: String): List<Block> {
    val out = mutableListOf<Block>()
    val lines = src.replace("\r\n", "\n").split("\n")
    var i = 0
    val para = StringBuilder()
    fun flush() { if (para.isNotBlank()) out += Block.Para(para.toString().trim()); para.clear() }
    while (i < lines.size) {
        val line = lines[i]
        val fence = Regex("^\\s*(```|~~~)(.*)$").find(line)
        if (fence != null) {
            flush()
            val mark = fence.groupValues[1]
            val code = StringBuilder()
            i++
            while (i < lines.size && !lines[i].trimStart().startsWith(mark)) { code.append(lines[i]).append('\n'); i++ }
            out += Block.Code(fence.groupValues[2].trim(), code.toString().trimEnd('\n'))
            i++
            continue
        }
        val h = Regex("^(#{1,6})\\s+(.*)$").find(line)
        val b = Regex("^(\\s*)([-*+]|\\d+[.)])\\s+(.*)$").find(line)
        when {
            line.isBlank() -> flush()
            h != null -> { flush(); out += Block.Heading(h.groupValues[1].length, h.groupValues[2]) }
            Regex("^\\s*([-*_])(\\s*\\1){2,}\\s*$").matches(line) -> { flush(); out += Block.Rule }
            b != null -> { flush(); out += Block.Bullet(b.groupValues[2].let { if (it.length == 1) "•" else it }, b.groupValues[3], b.groupValues[1].length / 2) }
            line.startsWith(">") -> { flush(); out += Block.Quote(line.removePrefix(">").trim()) }
            else -> { if (para.isNotEmpty()) para.append('\n'); para.append(line) }
        }
        i++
    }
    flush()
    return out
}

private val INLINE = Regex("`([^`]+)`|\\*\\*(.+?)\\*\\*|__(.+?)__|(?<![*\\w])\\*(?!\\s)(.+?)(?<!\\s)\\*(?!\\*)|\\[([^\\]]+)]\\((https://[^)\\s]+)\\)")

fun inline(text: String, codeBg: androidx.compose.ui.graphics.Color, link: androidx.compose.ui.graphics.Color): AnnotatedString = buildAnnotatedString {
    var pos = 0
    for (m in INLINE.findAll(text)) {
        append(text.substring(pos, m.range.first))
        val g = m.groupValues
        when {
            g[1].isNotEmpty() -> withStyle(SpanStyle(fontFamily = FontFamily.Monospace, background = codeBg, fontSize = 13.sp)) { append(g[1]) }
            g[2].isNotEmpty() || g[3].isNotEmpty() -> withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(g[2].ifEmpty { g[3] }) }
            g[4].isNotEmpty() -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { append(g[4]) }
            g[5].isNotEmpty() -> withLink(LinkAnnotation.Url(g[6], TextLinkStyles(SpanStyle(color = link, textDecoration = TextDecoration.Underline)))) { append(g[5]) }
        }
        pos = m.range.last + 1
    }
    append(text.substring(pos))
}

@Composable
fun Markdown(text: String, modifier: Modifier = Modifier) {
    val blocks = remember(text) { parseMarkdown(text) }
    val cs = MaterialTheme.colorScheme
    val codeBg = cs.surfaceContainerHighest
    Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        for (b in blocks) when (b) {
            is Block.Para -> Text(inline(b.text, codeBg, cs.primary), style = MaterialTheme.typography.bodyMedium)
            is Block.Heading -> Text(inline(b.text, codeBg, cs.primary), fontWeight = FontWeight.SemiBold,
                style = if (b.level <= 2) MaterialTheme.typography.titleMedium else MaterialTheme.typography.titleSmall)
            is Block.Bullet -> Row(Modifier.padding(start = (b.indent * 14).dp)) {
                Text(b.marker, Modifier.width(if (b.marker == "•") 14.dp else 22.dp), style = MaterialTheme.typography.bodyMedium)
                Text(inline(b.text, codeBg, cs.primary), style = MaterialTheme.typography.bodyMedium)
            }
            is Block.Quote -> Text(inline(b.text, codeBg, cs.primary), Modifier.padding(start = 8.dp), color = cs.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
            is Block.Code -> CodeBlock(b.code, b.lang)
            Block.Rule -> Box(Modifier.fillMaxWidth().padding(vertical = 4.dp).size(1.dp).background(cs.outlineVariant))
        }
    }
}

@Composable
fun CodeBlock(code: String, lang: String = "", maxLines: Int = Int.MAX_VALUE) {
    val cs = MaterialTheme.colorScheme
    val clip = LocalClipboardManager.current
    Column(Modifier.fillMaxWidth().background(cs.surfaceContainerHighest, RoundedCornerShape(10.dp))) {
        Row(Modifier.fillMaxWidth().padding(start = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(lang, Modifier.weight(1f), color = cs.onSurfaceVariant, fontSize = 11.sp)
            IconButton(onClick = { clip.setText(AnnotatedString(code)) }, Modifier.size(32.dp)) {
                Icon(Icons.Outlined.ContentCopy, tr("Kopieren", "Copy"), Modifier.size(16.dp), tint = cs.onSurfaceVariant)
            }
        }
        SelectionContainer {
            Text(code, Modifier.horizontalScroll(rememberScrollState()).padding(start = 10.dp, end = 10.dp, bottom = 10.dp),
                fontFamily = FontFamily.Monospace, fontSize = 12.5.sp, lineHeight = 17.sp, maxLines = maxLines, softWrap = false)
        }
    }
}
