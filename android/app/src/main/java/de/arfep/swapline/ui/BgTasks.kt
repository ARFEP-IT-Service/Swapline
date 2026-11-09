// Hintergrund-Aufgaben eines Chats (wie die Leiste über dem Eingabefeld in Swapline am PC): Befehle mit
// run_in_background, Agenten im Hintergrund. Antippen zeigt die Liste, „Ausgabe“ holt die letzten 64 KB vom PC.
package de.arfep.swapline.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import de.arfep.swapline.model.AppModel
import de.arfep.swapline.model.BgTask
import de.arfep.swapline.model.Chat
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private fun typeText(t: String) = when (t) {
    "local_bash" -> tr("Befehl", "Command")
    "local_agent" -> tr("Agent", "Agent")
    "remote_agent" -> tr("Agent (Cloud)", "Agent (cloud)")
    "" -> tr("Aufgabe", "Task")
    else -> t
}

private fun duration(t: BgTask, now: Long): String {
    val s = (((t.end ?: now) - t.start) / 1000).coerceAtLeast(0)
    return if (s < 60) "$s s" else "${s / 60} min ${s % 60} s"
}

@Composable
private fun StatusIcon(t: BgTask) {
    when {
        t.running -> CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp)
        t.status == "completed" -> Text("✓", color = Ok, fontWeight = FontWeight.Bold)
        else -> Text("✕", color = Danger, fontWeight = FontWeight.Bold)
    }
}

@Composable
fun BgTaskBar(model: AppModel, chat: Chat) {
    // Uhr für Laufzeiten und zum Ausblenden beendeter Aufgaben
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(chat.id) { while (true) { delay(1000); now = System.currentTimeMillis(); chat.pruneTasks(now) } }
    var open by remember { mutableStateOf(false) }
    val list = chat.tasks.values.sortedByDescending { it.start }
    if (list.isEmpty()) { open = false; return }
    val running = list.count { it.running }
    val failed = list.count { !it.running && it.status != "completed" }
    val cs = MaterialTheme.colorScheme
    Row(Modifier.padding(start = 12.dp, top = 6.dp).horizontalScroll(rememberScrollState())) {
        Row(Modifier.background(cs.surfaceContainerHigh, RoundedCornerShape(16.dp))
            .border(1.dp, if (running > 0) Accent.copy(alpha = 0.5f) else cs.outlineVariant, RoundedCornerShape(16.dp))
            .clickable { open = true }.padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            if (running > 0) CircularProgressIndicator(Modifier.size(12.dp), strokeWidth = 1.5.dp) else StatusIcon(list.first())
            Spacer(Modifier.width(8.dp))
            Text(when {
                running == 1 -> tr("1 Hintergrund-Aufgabe läuft", "1 background task running")
                running > 1 -> tr("$running Hintergrund-Aufgaben laufen", "$running background tasks running")
                failed > 0 -> tr("Hintergrund-Aufgabe fehlgeschlagen", "Background task failed")
                else -> tr("Hintergrund-Aufgabe beendet", "Background task finished")
            }, fontSize = 13.sp)
            Text(tr(" – anzeigen", " – show"), fontSize = 13.sp, color = cs.onSurfaceVariant)
        }
    }
    if (open) TaskListDialog(model, chat, list, now) { open = false }
}

@Composable
private fun TaskListDialog(model: AppModel, chat: Chat, list: List<BgTask>, now: Long, onDismiss: () -> Unit) {
    var output by remember { mutableStateOf<Pair<BgTask, String?>?>(null) }
    val scope = rememberCoroutineScope()
    val cs = MaterialTheme.colorScheme
    output?.let { (task, text) ->
        AlertDialog(onDismissRequest = { output = null },
            title = { Text(task.desc.ifBlank { task.id }, maxLines = 2, overflow = TextOverflow.Ellipsis) },
            text = {
                if (text == null) CircularProgressIndicator()
                else SelectionContainer {
                    Text(text, Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState()).horizontalScroll(rememberScrollState()),
                        fontFamily = FontFamily.Monospace, fontSize = 11.sp, softWrap = false)
                }
            },
            confirmButton = {
                TextButton(onClick = { output = task to null; scope.launch { output = task to model.taskOutput(chat, task.output ?: "") } }) { Text(tr("Neu laden", "Reload")) }
                TextButton(onClick = { output = null }) { Text("OK") }
            })
        return
    }
    AlertDialog(onDismissRequest = onDismiss,
        title = { Text(tr("Hintergrund-Aufgaben", "Background tasks")) },
        text = {
            Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                for (t in list) Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.width(22.dp), contentAlignment = Alignment.Center) { StatusIcon(t) }
                    Spacer(Modifier.width(8.dp))
                    Column(Modifier.weight(1f)) {
                        Text(t.desc.ifBlank { t.id }, maxLines = 2, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.Medium)
                        Text(listOf(typeText(t.type), if (t.running) tr("läuft seit ${duration(t, now)}", "running for ${duration(t, now)}")
                            else (t.summary.ifBlank { t.status }) + " · " + duration(t, now)).joinToString(" · "),
                            fontSize = 12.sp, color = cs.onSurfaceVariant, maxLines = 3, overflow = TextOverflow.Ellipsis)
                    }
                    if (t.output != null) TextButton(onClick = { output = t to null; scope.launch { output = t to model.taskOutput(chat, t.output) } }) { Text(tr("Ausgabe", "Output")) }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("OK") } },
        dismissButton = {
            if (list.any { !it.running }) TextButton(onClick = { chat.clearFinishedTasks(); if (chat.tasks.isEmpty()) onDismiss() }) { Text(tr("Beendete entfernen", "Remove finished")) }
        })
}

