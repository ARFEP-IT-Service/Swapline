@file:OptIn(ExperimentalMaterial3Api::class)

package de.arfep.swapline.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.PhotoCamera
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.ui.draw.clip
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.outlined.Build
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import de.arfep.swapline.model.AnswerKind
import de.arfep.swapline.model.Answer
import de.arfep.swapline.model.AppModel
import de.arfep.swapline.model.Chat
import de.arfep.swapline.model.ClaudeText
import de.arfep.swapline.model.Item
import de.arfep.swapline.model.SysCode
import de.arfep.swapline.model.prim
import de.arfep.swapline.model.toolSummary
import de.arfep.swapline.net.str
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import java.text.DateFormat
import java.util.Date

private val pretty = Json { prettyPrint = true }

fun answerText(a: Answer): String = when (a.kind) {
    AnswerKind.ALLOWED -> tr("✓ Erlaubt", "✓ Allowed")
    AnswerKind.ALWAYS -> tr("✓ Immer erlaubt", "✓ Always allowed")
    AnswerKind.DENIED -> tr("✕ Abgelehnt", "✕ Declined")
    AnswerKind.PLAN_ACCEPTED -> tr("✓ Plan angenommen – Claude setzt ihn um", "✓ Plan accepted – Claude is implementing it")
    AnswerKind.PLAN_REVISE -> tr("✎ Überarbeitung gewünscht: ", "✎ Revision requested: ") + a.detail
    AnswerKind.PLAN_REJECTED -> tr("✕ Plan abgelehnt", "✕ Plan rejected")
    AnswerKind.ANSWERED -> a.detail
    AnswerKind.SKIPPED -> tr("✕ Übersprungen", "✕ Skipped")
    AnswerKind.ANSWERED_ELSEWHERE -> tr("✓ Beantwortet auf ${a.detail}", "✓ Answered on ${a.detail}")
    AnswerKind.DENIED_ELSEWHERE -> tr("✕ Abgelehnt auf ${a.detail}", "✕ Declined on ${a.detail}")
}

private fun inputText(name: String, input: JsonElement): String {
    val o = input as? JsonObject
    return when {
        o == null -> input.toString()
        name == "Bash" || name == "PowerShell" -> o.str("command").orEmpty()
        o.str("file_path") != null -> o.str("file_path") + (o.str("new_string")?.let { "\n\n− " + o.str("old_string").orEmpty() + "\n+ " + it } ?: "")
        else -> pretty.encodeToString(JsonElement.serializer(), input)
    }
}

@Composable
fun ChatScreen(model: AppModel, chat: Chat, onBack: () -> Unit, onSettings: () -> Unit) {
    val h = model.host(chat.hostId)
    val scope = rememberCoroutineScope()
    var text by rememberSaveable(chat.id) { mutableStateOf("") }
    var menu by remember { mutableStateOf(false) }
    var confirmClose by remember { mutableStateOf(false) }
    val list = rememberLazyListState()
    val attachments = remember(chat.id) { mutableStateListOf<Attach>() }
    val items = chat.items
    LaunchedEffect(chat.id) { model.open(chat) }

    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, tr("Zurück", "Back")) } },
                title = {
                    Column {
                        Text(chat.title.ifBlank { tr("Neuer Chat", "New chat") }, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 17.sp)
                        val sub = listOfNotNull(h?.record?.name, folderName(chat.cwd).takeIf { chat.cwd.isNotEmpty() },
                            (chat.modelName.ifEmpty { chat.model }).takeIf { it.isNotEmpty() }, if (chat.mirror) tr("am PC offen", "open on PC") else null,
                            if (chat.permissionMode == "bypassPermissions") tr("Alles erlauben", "Allow everything") else null)
                        Text(sub.joinToString(" · "), maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                },
                actions = {
                    if (chat.running) IconButton(onClick = { model.interrupt(chat) }) { Icon(Icons.Default.Stop, tr("Anhalten", "Stop")) }
                    Box {
                        IconButton(onClick = { menu = true }) { Icon(Icons.Default.MoreVert, null) }
                        DropdownMenu(menu, { menu = false }) {
                            if (!chat.mirror) DropdownMenuItem(text = { Text(tr("Chat-Einstellungen", "Chat settings")) }, onClick = { menu = false; onSettings() })
                            DropdownMenuItem(text = { Text(if (chat.mirror) tr("Chat verlassen", "Leave chat") else tr("Chat schließen", "Close chat")) },
                                onClick = { menu = false; confirmClose = true })
                        }
                    }
                },
            )
        },
    ) { pad ->
        Column(Modifier.fillMaxSize().padding(pad).imePadding()) {
            Box(Modifier.weight(1f)) {
                // umgekehrte Liste: neueste unten, bleibt beim Eintreffen neuer Nachrichten unten
                LazyColumn(Modifier.fillMaxSize(), state = list, reverseLayout = true, contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (chat.running) item(key = "typing") { Typing() }
                    items(items.size, key = { items.size - 1 - it }) { i ->
                        ItemView(model, chat, items[items.size - 1 - i])
                    }
                }
                val atBottom = list.firstVisibleItemIndex == 0
                if (!atBottom) SmallFloatingActionButton(onClick = { scope.launch { list.animateScrollToItem(0) } }, Modifier.align(Alignment.BottomEnd).padding(12.dp)) {
                    Icon(Icons.Default.KeyboardArrowDown, tr("Ganz nach unten", "Scroll to bottom"))
                }
            }
            BgTaskBar(model, chat)
            Composer(text, { text = it }, attachments, enabled = h?.connected == true, offline = h?.connected != true, mic = model.micEnabled, onDeviceOnly = model.onDeviceOnly) {
                val t = text.trim()
                if (t.isEmpty() && attachments.isEmpty()) return@Composer
                val imgs = attachments.filter { it.isImage }.map { it.data }
                val docs = attachments.filter { !it.isImage }.map { it.name to it.data }
                text = ""
                attachments.clear()
                scope.launch { model.send(chat, t, imgs, docs); list.scrollToItem(0) }
            }
        }
    }
    if (confirmClose) AlertDialog(onDismissRequest = { confirmClose = false },
        title = { Text(if (chat.mirror) tr("Chat verlassen?", "Leave chat?") else tr("Chat schließen?", "Close chat?")) },
        text = { Text(if (chat.mirror) tr("Der Chat läuft am Haupt-PC weiter.", "The chat keeps running on the host PC.")
            else tr("Claude wird für diesen Chat am Haupt-PC beendet. Der Verlauf bleibt erhalten und kann fortgesetzt werden.", "Claude is stopped for this chat on the host PC. The history is kept and can be continued.")) },
        confirmButton = { TextButton(onClick = { confirmClose = false; model.close(chat); onBack() }) { Text(tr("Ja", "Yes")) } },
        dismissButton = { TextButton(onClick = { confirmClose = false }) { Text(tr("Abbrechen", "Cancel")) } })
}

@Composable
private fun Typing() {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(start = 4.dp, top = 4.dp)) {
        androidx.compose.material3.CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp)
        Spacer(Modifier.width(8.dp))
        Text(tr("Claude arbeitet …", "Claude is working …"), fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun Composer(text: String, onText: (String) -> Unit, attachments: MutableList<Attach>, enabled: Boolean, offline: Boolean, mic: Boolean, onDeviceOnly: Boolean, onSend: () -> Unit) {
    var attachMenu by remember { mutableStateOf(false) }
    var micError by remember { mutableStateOf<String?>(null) }
    val (dictation, toggleMic) = rememberDictation(onDeviceOnly, onText = { micError = null; onText(it) }, onError = { micError = it })
    Surface(color = MaterialTheme.colorScheme.surfaceContainer) {
        Column(Modifier.navigationBarsPadding()) {
            if (offline) Text(tr("Nicht mit dem Haupt-PC verbunden", "Not connected to the host PC"), Modifier.padding(start = 16.dp, top = 6.dp), fontSize = 12.sp, color = Danger)
            micError?.let { Text(it, Modifier.padding(start = 16.dp, top = 6.dp), fontSize = 12.sp, color = Danger) }
            val picker = rememberAttachPicker(remaining = { MAX_ATTACH - attachments.size }, onAdd = { micError = null; attachments.addAll(it) }, onError = { micError = it })
            if (attachments.isNotEmpty()) Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(start = 12.dp, end = 12.dp, top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                attachments.forEachIndexed { i, a ->
                    Box {
                        val th = a.thumb
                        if (th != null) androidx.compose.foundation.Image(th, null, Modifier.size(64.dp).clip(RoundedCornerShape(10.dp)), contentScale = androidx.compose.ui.layout.ContentScale.Crop)
                        else Column(Modifier.size(width = 120.dp, height = 64.dp).background(MaterialTheme.colorScheme.surfaceContainerHighest, RoundedCornerShape(10.dp)).padding(8.dp)) {
                            Icon(Icons.Outlined.Description, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(a.name, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 12.sp)
                            Text(sizeText(a.size), fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Box(Modifier.align(Alignment.TopEnd).padding(2.dp).size(22.dp).background(Color.Black.copy(alpha = 0.6f), androidx.compose.foundation.shape.CircleShape)
                            .clickable { attachments.removeAt(i) }, contentAlignment = Alignment.Center) {
                            Icon(Icons.Default.Close, tr("Entfernen", "Remove"), Modifier.size(14.dp), tint = Color.White)
                        }
                    }
                }
            }
            if (dictation.listening) Text(tr("Ich höre zu … zum Beenden aufs Mikrofon tippen", "Listening … tap the microphone to stop"), Modifier.padding(start = 16.dp, top = 6.dp), fontSize = 12.sp, color = Accent)
            Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.Bottom) {
                Box {
                    IconButton(onClick = { attachMenu = true }, modifier = Modifier.size(48.dp)) {
                        Icon(Icons.Default.AttachFile, tr("Bild anhängen", "Attach image"), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    DropdownMenu(attachMenu, { attachMenu = false }) {
                        DropdownMenuItem(text = { Text(tr("Foto aufnehmen", "Take photo")) }, leadingIcon = { Icon(Icons.Outlined.PhotoCamera, null) }, onClick = { attachMenu = false; picker.camera() })
                        DropdownMenuItem(text = { Text(tr("Aus Galerie", "From gallery")) }, leadingIcon = { Icon(Icons.Outlined.Image, null) }, onClick = { attachMenu = false; picker.gallery() })
                        DropdownMenuItem(text = { Text(tr("Dokument", "Document")) }, leadingIcon = { Icon(Icons.Outlined.Description, null) }, onClick = { attachMenu = false; picker.document() })
                    }
                }
                TextField(text, onText, Modifier.weight(1f), placeholder = { Text(tr("Nachricht an Claude …", "Message Claude …")) }, maxLines = 6,
                    shape = RoundedCornerShape(22.dp), colors = TextFieldDefaults.colors(focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent, disabledIndicatorColor = Color.Transparent))
                if (mic) {
                    Spacer(Modifier.width(4.dp))
                    // Mikrofon: beim Zuhören rot, Ring zeigt die Lautstärke
                    val ring = if (dictation.listening) (4 + dictation.level * 10).dp else 0.dp
                    IconButton(onClick = { micError = null; toggleMic(text) }, modifier = Modifier.size(48.dp)
                        .then(if (dictation.listening) Modifier.border(ring, Danger.copy(alpha = 0.35f), androidx.compose.foundation.shape.CircleShape) else Modifier)) {
                        Icon(if (dictation.listening) Icons.Default.Mic else Icons.Outlined.Mic, if (dictation.listening) tr("Diktieren beenden", "Stop dictation") else tr("Diktieren", "Dictate"),
                            tint = if (dictation.listening) Danger else MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                Spacer(Modifier.width(4.dp))
                FilledIconButton(onClick = { if (dictation.listening) dictation.stop(); onSend() }, enabled = enabled && (text.isNotBlank() || attachments.isNotEmpty()), modifier = Modifier.size(48.dp)) {
                    Icon(Icons.AutoMirrored.Filled.Send, tr("Senden", "Send"))
                }
            }
        }
    }
}

private val timeFmt = DateFormat.getTimeInstance(DateFormat.SHORT)

@Composable
private fun ItemView(model: AppModel, chat: Chat, it: Item) {
    val cs = MaterialTheme.colorScheme
    when (it) {
        is Item.Me -> Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.End) {
            if (it.from.isNotEmpty()) Text(it.from, fontSize = 11.sp, color = cs.onSurfaceVariant, modifier = Modifier.padding(end = 6.dp, bottom = 2.dp))
            Surface(color = Accent, contentColor = Color.White, shape = RoundedCornerShape(18.dp, 18.dp, 4.dp, 18.dp), modifier = Modifier.widthIn(max = 320.dp)) {
                SelectionContainer {
                    Text(listOfNotNull(it.text.takeIf { t -> t.isNotBlank() && t != ClaudeText.SEE_IMAGE && t != ClaudeText.SEE_IMAGES },
                        if (it.images > 0) "📷 " + if (it.images == 1) tr("1 Bild", "1 image") else tr("${it.images} Bilder", "${it.images} images") else null,
                        it.files.takeIf { f -> f.isNotEmpty() }?.joinToString("\n") { f -> "📎 $f" }).joinToString("\n"),
                        Modifier.padding(horizontal = 14.dp, vertical = 9.dp))
                }
            }
            it.time?.let { t -> Text(timeFmt.format(Date(t)), fontSize = 10.sp, color = cs.onSurfaceVariant, modifier = Modifier.padding(end = 6.dp, top = 2.dp)) }
        }
        is Item.Ai -> {
            val clip = LocalClipboardManager.current
            Column(Modifier.fillMaxWidth()) {
                Surface(color = cs.surfaceContainerHigh, shape = RoundedCornerShape(18.dp, 18.dp, 18.dp, 4.dp)) {
                    SelectionContainer { Markdown(it.text, Modifier.padding(horizontal = 14.dp, vertical = 10.dp)) }
                }
                if (!it.streaming) Row(verticalAlignment = Alignment.CenterVertically) {
                    it.time?.let { t -> Text(timeFmt.format(Date(t)), fontSize = 10.sp, color = cs.onSurfaceVariant, modifier = Modifier.padding(start = 6.dp)) }
                    IconButton(onClick = { clip.setText(AnnotatedString(it.text)) }, Modifier.size(28.dp)) {
                        Icon(Icons.Outlined.ContentCopy, tr("Kopieren", "Copy"), Modifier.size(14.dp), tint = cs.onSurfaceVariant)
                    }
                }
            }
        }
        is Item.Tool -> ToolRow(it)
        is Item.Perm -> Card(done = it.answer != null) {
            Text(tr("Darf Claude ${it.toolName} ausführen?", "Allow Claude to run ${it.toolName}?"), fontWeight = FontWeight.SemiBold)
            if (it.description.isNotBlank()) Text(it.description, fontSize = 13.sp, color = cs.onSurfaceVariant)
            Spacer(Modifier.height(6.dp))
            CodeBlock(inputText(it.toolName, it.input), maxLines = 30)
            Spacer(Modifier.height(8.dp))
            val a = it.answer
            if (a != null) Text(answerText(a), color = cs.onSurfaceVariant)
            else FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { model.allow(chat, it, false) }) { Text(tr("Erlauben", "Allow")) }
                val sugg = it.suggestions as? JsonArray
                if (sugg != null && sugg.isNotEmpty() && sugg.none { s -> (s as? JsonObject)?.str("type") == "setMode" })
                    OutlinedButton(onClick = { model.allow(chat, it, true) }) { Text(tr("Immer erlauben", "Always allow")) }
                OutlinedButton(onClick = { model.deny(chat, it, ClaudeText.DENIED, Answer(AnswerKind.DENIED)) }) { Text(tr("Ablehnen", "Decline"), color = Danger) }
            }
        }
        is Item.Question -> QuestionCard(model, chat, it)
        is Item.Plan -> PlanCard(model, chat, it)
        is Item.Recap -> Card { Text("※ Recap", fontWeight = FontWeight.SemiBold); Text(it.text, fontSize = 14.sp) }
        is Item.Sys -> {
            val t = when (it.code) {
                SysCode.COMPACTED -> tr("Unterhaltung wurde zusammengefasst", "Conversation was compacted")
                SysCode.HISTORY_ABOVE -> tr("Bisheriger Verlauf – ab hier geht es weiter", "Previous history – continuing from here")
                SysCode.EXITED -> tr("Claude wurde beendet (Code ", "Claude exited (code ") + it.text.substringBefore('\n') + ")" + it.text.substringAfter('\n', "").let { s -> if (s.isNotEmpty()) "\n$s" else "" }
                SysCode.TEXT -> it.text
            }
            Text(t, Modifier.fillMaxWidth().padding(vertical = 2.dp), fontSize = 12.sp, color = if (it.error) Danger else cs.onSurfaceVariant,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        }
        is Item.Result -> Text((if (it.ok) "✓ " else "✕ ") + String.format("%.1f s", it.seconds) + (it.cost?.let { c -> String.format(" · $%.3f", c) } ?: "") + (if (it.model.isNotEmpty()) " · ${it.model}" else ""),
            fontSize = 11.sp, color = cs.onSurfaceVariant, modifier = Modifier.padding(start = 6.dp))
    }
}

@Composable
private fun Card(done: Boolean = false, content: @Composable () -> Unit) {
    val cs = MaterialTheme.colorScheme
    Column(Modifier.fillMaxWidth().background(cs.surfaceContainer, RoundedCornerShape(14.dp))
        .border(1.dp, if (done) cs.outlineVariant else Accent.copy(alpha = 0.6f), RoundedCornerShape(14.dp)).padding(12.dp)) { content() }
}

@Composable
private fun ToolRow(it: Item.Tool) {
    var open by remember { mutableStateOf(false) }
    val cs = MaterialTheme.colorScheme
    Column(Modifier.fillMaxWidth().background(cs.surfaceContainer, RoundedCornerShape(10.dp)).clickable { open = !open }.padding(horizontal = 10.dp, vertical = 7.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.Build, null, Modifier.size(14.dp), tint = if (it.isError) Danger else cs.onSurfaceVariant)
            Spacer(Modifier.width(8.dp))
            Text(it.name, fontWeight = FontWeight.Medium, fontSize = 13.sp)
            Spacer(Modifier.width(6.dp))
            Text(toolSummary(it.name, it.input), Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 12.sp, color = cs.onSurfaceVariant, fontFamily = FontFamily.Monospace)
            if (it.result == null) androidx.compose.material3.CircularProgressIndicator(Modifier.size(12.dp), strokeWidth = 1.5.dp)
        }
        AnimatedVisibility(open) {
            Column(Modifier.padding(top = 6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(tr("Eingabe", "Input"), fontSize = 11.sp, color = cs.onSurfaceVariant)
                CodeBlock(inputText(it.name, it.input), maxLines = 40)
                if (!it.result.isNullOrEmpty()) {
                    Text(if (it.isError) tr("Fehler", "Error") else tr("Ergebnis", "Result"), fontSize = 11.sp, color = cs.onSurfaceVariant)
                    CodeBlock(it.result.take(20000), maxLines = 60)
                }
            }
        }
    }
}

@Composable
private fun QuestionCard(model: AppModel, chat: Chat, q: Item.Question) {
    val cs = MaterialTheme.colorScheme
    val answers = remember(q.requestId) { mutableStateMapOf<String, String>() }
    val multi = remember(q.requestId) { mutableStateMapOf<String, Set<String>>() }
    Card(done = q.answer != null) {
        Text(tr("Claude hat eine Frage", "Claude has a question"), fontWeight = FontWeight.SemiBold)
        q.answer?.let { Text(answerText(it), color = cs.onSurfaceVariant); return@Card }
        for (qq in (q.input["questions"] as? JsonArray).orEmpty()) {
            val o = qq as? JsonObject ?: continue
            val question = o.str("question") ?: continue
            val isMulti = (o["multiSelect"] as? JsonPrimitive)?.booleanOrNull == true
            Spacer(Modifier.height(8.dp))
            Text(question, fontWeight = FontWeight.Medium)
            for (opt in (o["options"] as? JsonArray).orEmpty()) {
                val oo = opt as? JsonObject ?: continue
                val label = oo.str("label") ?: continue
                val sel = if (isMulti) label in multi[question].orEmpty() else answers[question] == label
                Column(Modifier.fillMaxWidth().padding(top = 6.dp)
                    .border(1.dp, if (sel) Accent else cs.outlineVariant, RoundedCornerShape(10.dp))
                    .background(if (sel) Accent.copy(alpha = 0.12f) else Color.Transparent, RoundedCornerShape(10.dp))
                    .clickable {
                        if (isMulti) { val s = multi[question].orEmpty(); multi[question] = if (label in s) s - label else s + label; answers[question] = multi[question]!!.joinToString(", ") }
                        else answers[question] = label
                    }.padding(10.dp)) {
                    Text(label)
                    oo.str("description")?.takeIf { it.isNotBlank() }?.let { Text(it, fontSize = 12.sp, color = cs.onSurfaceVariant) }
                }
            }
            val other = answers[question]?.takeIf { a -> (o["options"] as? JsonArray).orEmpty().none { (it as? JsonObject)?.str("label") == a } && !isMulti } ?: ""
            OutlinedTextField(other, { answers[question] = it }, Modifier.fillMaxWidth().padding(top = 6.dp), placeholder = { Text(tr("Andere Antwort …", "Other answer …")) }, singleLine = true)
        }
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { model.answerQuestion(chat, q, answers.filterValues { it.isNotBlank() }) }) { Text(tr("Antworten", "Answer")) }
            OutlinedButton(onClick = { model.deny(chat, q, ClaudeText.QUESTION_SKIPPED, Answer(AnswerKind.SKIPPED)) }) { Text(tr("Überspringen", "Skip"), color = Danger) }
        }
    }
}

@Composable
private fun PlanCard(model: AppModel, chat: Chat, p: Item.Plan) {
    var feedback by remember(p.requestId) { mutableStateOf("") }
    Card(done = p.answer != null) {
        Text(tr("📋 Plan von Claude", "📋 Plan from Claude"), fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(6.dp))
        Markdown(p.input["plan"].prim().orEmpty())
        Spacer(Modifier.height(8.dp))
        p.answer?.let { Text(answerText(it), color = MaterialTheme.colorScheme.onSurfaceVariant); return@Card }
        OutlinedTextField(feedback, { feedback = it }, Modifier.fillMaxWidth(), placeholder = { Text(tr("Optional: Was soll Claude am Plan ändern?", "Optional: what should Claude change in the plan?")) }, maxLines = 4)
        Spacer(Modifier.height(8.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { model.acceptPlan(chat, p) }) { Text(tr("Plan annehmen", "Accept plan")) }
            OutlinedButton(onClick = {
                if (feedback.isNotBlank()) model.deny(chat, p, ClaudeText.PLAN_REVISE + feedback.trim(), Answer(AnswerKind.PLAN_REVISE, feedback.trim()))
            }, enabled = feedback.isNotBlank()) { Text(tr("Überarbeiten lassen", "Request revision")) }
            OutlinedButton(onClick = { model.deny(chat, p, ClaudeText.PLAN_REJECTED, Answer(AnswerKind.PLAN_REJECTED)) }) { Text(tr("Ablehnen", "Reject"), color = Danger) }
        }
    }
}
