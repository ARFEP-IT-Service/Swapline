@file:OptIn(ExperimentalMaterial3Api::class)

package de.arfep.swapline.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.sp
import de.arfep.swapline.model.AppModel
import de.arfep.swapline.model.Chat
import de.arfep.swapline.model.HostState
import de.arfep.swapline.model.ModelOpt

// Auswahl als Knopf mit Liste (Konto, Ordner, Modell …)
@Composable
fun <T> Picker(label: String, options: List<T>, selected: T?, text: (T) -> String, color: Color = Color.Unspecified, onPick: (T) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Column {
        Text(label, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Box {
            OutlinedButton(onClick = { open = true }, Modifier.fillMaxWidth()) {
                Text(selected?.let(text) ?: "–", Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, color = color)
                Icon(Icons.Default.ArrowDropDown, null)
            }
            DropdownMenu(open, { open = false }) {
                for (o in options) DropdownMenuItem(text = { Text(text(o)) }, onClick = { open = false; onPick(o) })
            }
        }
    }
}

val EFFORTS = listOf("", "low", "medium", "high", "xhigh", "max")
fun effortText(e: String) = when (e) { "" -> tr("Standard", "Default"); "low" -> tr("Niedrig", "Low"); "medium" -> tr("Mittel", "Medium"); "high" -> tr("Hoch", "High"); "xhigh" -> tr("Sehr hoch", "Very high"); "max" -> "Max"; else -> e }
fun modeText(m: String) = when (m) {
    "default" -> tr("Nachfragen", "Ask")
    "acceptEdits" -> tr("Änderungen erlauben", "Accept edits")
    "plan" -> tr("Nur planen", "Plan only")
    "bypassPermissions" -> tr("Alles erlauben", "Allow everything")
    else -> m
}

private data class Folder(val path: String, val label: String)

// Neuer Chat oder Einstellungen eines eigenen Chats (Konto und Ordner nur beim neuen Chat wählbar)
@Composable
fun ChatSetupDialog(model: AppModel, h: HostState, chat: Chat?, onDismiss: () -> Unit, onCreated: (Chat) -> Unit) {
    val st = h.store ?: return onDismiss()
    var profileId by remember { mutableStateOf(chat?.profileId ?: h.profileId ?: st.activeProfileId ?: st.profiles.firstOrNull()?.id) }
    val folders = remember(st) {
        val proj = st.projects.filter { it.cwd.isNotEmpty() }.map { Folder(it.cwd, it.name + " · " + folderName(it.cwd)) }
        proj + st.allowedFolders.filter { f -> proj.none { it.path.equals(f, true) } }.map { Folder(it, folderName(it)) }
    }
    val preset = h.projectFilter?.let { id -> st.projects.firstOrNull { it.id == id }?.cwd }?.takeIf { it.isNotEmpty() }
    var cwd by remember { mutableStateOf(chat?.cwd ?: preset ?: folders.firstOrNull()?.path ?: "") }
    var modelId by remember { mutableStateOf(chat?.model ?: st.model) }
    var effort by remember { mutableStateOf(chat?.effort ?: st.effort) }
    var mode by remember { mutableStateOf(chat?.permissionMode ?: st.permissionMode.takeIf { it != "bypassPermissions" || st.allowBypass } ?: "default") }
    var models by remember { mutableStateOf<List<ModelOpt>>(emptyList()) }
    var confirmBypass by remember { mutableStateOf(false) }
    LaunchedEffect(profileId) { profileId?.let { models = model.models(h, it) } }

    if (confirmBypass) {
        AlertDialog(onDismissRequest = { confirmBypass = false },
            title = { Text(tr("„Alles erlauben“ verwenden?", "Use “Allow everything”?")) },
            text = { Text(tr("Claude führt dann am Haupt-PC Befehle aus und ändert Dateien ohne Rückfrage (--dangerously-skip-permissions).",
                "Claude will then run commands and change files on the host PC without asking (--dangerously-skip-permissions).")) },
            confirmButton = { TextButton(onClick = { confirmBypass = false; mode = "bypassPermissions" }) { Text(tr("Verwenden", "Use"), color = Danger) } },
            dismissButton = { TextButton(onClick = { confirmBypass = false }) { Text(tr("Abbrechen", "Cancel")) } })
        return
    }
    AlertDialog(onDismissRequest = onDismiss,
        title = { Text(if (chat == null) tr("Neuer Chat auf ${h.record.name}", "New chat on ${h.record.name}", "${h.record.name} üzerinde yeni sohbet") else tr("Chat-Einstellungen", "Chat settings")) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp())) {
                if (chat == null) {
                    if (st.profiles.size > 1) Picker(tr("Konto", "Account"), st.profiles, st.profiles.firstOrNull { it.id == profileId }, { it.name }) { profileId = it.id }
                    Picker(tr("Ordner", "Folder"), folders, folders.firstOrNull { it.path == cwd } ?: Folder(cwd, cwd.ifEmpty { tr("Kein Ordner", "No folder") }), { it.label }) { cwd = it.path }
                }
                val opts = listOf(ModelOpt("", tr("Standard", "Default"), "")) + models.filter { it.value.isNotEmpty() && it.value != "default" }
                Picker(tr("Modell", "Model"), opts, opts.firstOrNull { it.value == modelId } ?: ModelOpt(modelId, modelId, ""), { it.name }) { modelId = it.value }
                Picker(tr("Aufwand", "Effort"), EFFORTS, effort, ::effortText) { effort = it }
                val modes = listOf("default", "acceptEdits", "plan") + if (st.allowBypass) listOf("bypassPermissions") else emptyList()
                Picker(tr("Berechtigungen", "Permissions"), modes, mode, ::modeText, if (mode == "bypassPermissions") Danger else Color.Unspecified) {
                    if (it == "bypassPermissions" && mode != it) confirmBypass = true else mode = it
                }
                if (!st.allowBypass) Text(tr("„Alles erlauben“ ist für dieses Gerät am Haupt-PC nicht freigegeben.", "“Allow everything” is not enabled for this device on the host PC."),
                    fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (chat != null && chat.sessionId != null) Text(tr("Änderungen gelten ab der nächsten Nachricht (Claude startet am Haupt-PC neu und setzt den Chat fort).",
                    "Changes apply from the next message (Claude restarts on the host PC and continues the chat)."), fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        },
        confirmButton = {
            TextButton(enabled = profileId != null && (chat != null || cwd.isNotEmpty() || st.allowedFolders.isEmpty()), onClick = {
                if (chat == null) onCreated(model.newChat(h, profileId!!, cwd, modelId, effort, mode))
                else { model.changeSettings(chat, modelId, effort, mode); onDismiss() }
            }) { Text(if (chat == null) tr("Starten", "Start") else tr("Speichern", "Save")) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(tr("Abbrechen", "Cancel")) } })
}

private fun Int.dp() = androidx.compose.ui.unit.Dp(this.toFloat())
