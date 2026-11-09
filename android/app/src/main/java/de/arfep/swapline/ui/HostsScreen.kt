@file:OptIn(ExperimentalMaterial3Api::class)

package de.arfep.swapline.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import de.arfep.swapline.model.AppModel
import de.arfep.swapline.model.HostState
import de.arfep.swapline.net.DEFAULT_PORT
import de.arfep.swapline.net.LinkException
import kotlinx.coroutines.launch

@Composable
fun HostsScreen(model: AppModel, onBack: () -> Unit, onPair: () -> Unit, onPicked: (String) -> Unit) {
    var edit by remember { mutableStateOf<HostState?>(null) }
    Scaffold(
        topBar = {
            TopAppBar(title = { Text(tr("Haupt-PCs", "Host PCs")) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, tr("Zurück", "Back")) } },
                actions = { IconButton(onClick = onPair) { Icon(Icons.Default.Add, tr("Haupt-PC koppeln", "Pair host PC")) } })
        },
    ) { pad ->
        LazyColumn(Modifier.fillMaxSize().padding(pad)) {
            items(model.hosts, key = { it.id }) { h ->
                Row(Modifier.fillMaxWidth().clickable { onPicked(h.id) }.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Avatar(h.record.name, h.record.color, 40.dp)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(h.record.name, style = MaterialTheme.typography.titleSmall)
                        Text(h.record.address.replace(",", ", ") + " · Port ${h.record.port}", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            StatusDot(h.state); Spacer(Modifier.width(6.dp))
                            Text(stateText(h) + (h.store?.hostVersion?.takeIf { it.isNotEmpty() }?.let { " · Swapline $it" } ?: ""), fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    TextButton(onClick = { edit = h }) { Text(tr("Bearbeiten", "Edit")) }
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
            item { AboutRow(model) }
            item {
                Text(tr("Nur eigene Geräte koppeln. Claude Code und die Anmeldung der Konten bleiben auf dem Haupt-PC – das Handy speichert nur seinen eigenen, verschlüsselten Geräteschlüssel.",
                    "Only pair your own devices. Claude Code and the account sign-in stay on the host PC – the phone only stores its own encrypted device key."),
                    Modifier.padding(16.dp), fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
    edit?.let { h -> EditHostDialog(model, h) { edit = null } }
}

@Composable
private fun EditHostDialog(model: AppModel, h: HostState, onDone: () -> Unit) {
    var name by remember { mutableStateOf(h.record.name) }
    var address by remember { mutableStateOf(h.record.address) }
    var port by remember { mutableStateOf(h.record.port.toString()) }
    var confirmRemove by remember { mutableStateOf(false) }
    if (confirmRemove) {
        AlertDialog(onDismissRequest = { confirmRemove = false },
            title = { Text(tr("„${h.record.name}“ entfernen?", "Remove “${h.record.name}”?")) },
            text = { Text(tr("Die Kopplung wird auf dem Handy gelöscht. Am Haupt-PC bitte das Gerät zusätzlich unter Fernzugriff entfernen.",
                "The pairing is deleted on the phone. Please also remove the device under Remote access on the host PC.")) },
            confirmButton = { TextButton(onClick = { model.removeHost(h); confirmRemove = false; onDone() }) { Text(tr("Entfernen", "Remove"), color = Danger) } },
            dismissButton = { TextButton(onClick = { confirmRemove = false }) { Text(tr("Abbrechen", "Cancel")) } })
        return
    }
    AlertDialog(onDismissRequest = onDone,
        title = { Text(tr("Haupt-PC", "Host PC")) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(name, { name = it.take(40) }, label = { Text(tr("Name", "Name")) }, singleLine = true)
                OutlinedTextField(address, { address = it.replace(" ", "") }, label = { Text(tr("Adressen (der Reihe nach, mit Komma)", "Addresses (in order, comma-separated)")) },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri))
                OutlinedTextField(port, { port = it.filter(Char::isDigit).take(5) }, label = { Text("Port") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                TextButton(onClick = { confirmRemove = true }) { Text(tr("Kopplung entfernen", "Remove pairing"), color = Danger) }
            }
        },
        confirmButton = {
            TextButton(onClick = {
                val p = port.toIntOrNull()?.takeIf { it in 1..65535 } ?: h.record.port
                model.updateHost(h, name, address.ifBlank { h.record.address }, p); onDone()
            }) { Text(tr("Speichern", "Save")) }
        },
        dismissButton = { TextButton(onClick = onDone) { Text(tr("Abbrechen", "Cancel")) } })
}

// Koppeln: Adresse, Port und Einmal-Code vom Haupt-PC (oder per QR-Code). Der Haupt-PC fragt danach nach Bestätigung.
@Composable
fun PairScreen(model: AppModel, initial: PairData?, onBack: () -> Unit, onScan: (() -> Unit)?, onPaired: (String) -> Unit) {
    var address by rememberSaveable { mutableStateOf(initial?.addresses?.joinToString(", ") ?: "") }
    var port by rememberSaveable { mutableStateOf((initial?.port ?: DEFAULT_PORT).toString()) }
    var code by rememberSaveable { mutableStateOf(initial?.code ?: "") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    fun start() {
        val p = port.toIntOrNull()
        val list = address.split(',').map { it.trim() }.filter { it.isNotEmpty() }
        if (list.isEmpty() || p == null || p !in 1..65535 || code.isBlank()) { error = tr("Bitte Adresse, Port und Code angeben.", "Please enter address, port and code."); return }
        busy = true; error = null
        scope.launch {
            try { onPaired(model.pairHost(list, p, code).id) }
            catch (e: LinkException) {
                error = when (e.reason) {
                    "code" -> tr("Der Code ist ungültig.", "The code is invalid.")
                    "denied" -> tr("Am Haupt-PC abgelehnt.", "Declined on the host PC.")
                    "unreachable" -> tr("Haupt-PC nicht erreichbar. Ist das Handy im selben Netz (oder per Tailscale/VPN verbunden) und der Fernzugriff am PC eingeschaltet? ", "Host PC unreachable. Is the phone on the same network (or connected via Tailscale/VPN) and remote access turned on at the PC? ") + e.message
                    else -> tr("Kopplung fehlgeschlagen: ", "Pairing failed: ") + e.message
                }
            } catch (e: Exception) {
                error = tr("Kopplung fehlgeschlagen – Code abgelaufen oder schon benutzt. ", "Pairing failed – code expired or already used. ") + (e.message ?: e.javaClass.simpleName)
            } finally { busy = false }
        }
    }
    // aus dem QR-Code: gleich koppeln, der Haupt-PC fragt nach Bestätigung
    LaunchedEffect(initial) { if (initial != null) start() }
    Scaffold(topBar = {
        TopAppBar(title = { Text(tr("Haupt-PC koppeln", "Pair host PC")) },
            navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, tr("Zurück", "Back")) } })
    }) { pad ->
        Column(Modifier.fillMaxSize().padding(pad).imePadding().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(tr("Am PC in Swapline: Fernzugriff (Symbol in der Leiste links) → „Fernzugriff erlauben“ → „Gerät koppeln …“. Dort stehen Adresse und Einmal-Code (5 Minuten gültig).",
                "In Swapline on the PC: Remote access (icon in the left rail) → “Allow remote access” → “Pair device …”. It shows the address and a one-time code (valid for 5 minutes)."),
                color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
            if (onScan != null) OutlinedButton(onClick = onScan, Modifier.fillMaxWidth(), enabled = !busy) {
                Icon(Icons.Outlined.QrCodeScanner, null); Spacer(Modifier.width(8.dp)); Text(tr("QR-Code scannen", "Scan QR code"))
            }
            OutlinedTextField(address, { address = it.trim() }, Modifier.fillMaxWidth(), label = { Text(tr("Adresse des Haupt-PCs", "Host PC address")) },
                placeholder = { Text("192.168.x.y") }, singleLine = true, enabled = !busy, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri))
            OutlinedTextField(port, { port = it.filter(Char::isDigit).take(5) }, Modifier.fillMaxWidth(), label = { Text("Port") }, singleLine = true, enabled = !busy,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
            OutlinedTextField(code, { code = it.uppercase().take(40) }, Modifier.fillMaxWidth(), label = { Text(tr("Einmal-Code", "One-time code")) },
                placeholder = { Text("XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XX") }, singleLine = true, enabled = !busy,
                textStyle = MaterialTheme.typography.bodyLarge.copy(fontFamily = FontFamily.Monospace),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, autoCorrectEnabled = false, keyboardType = KeyboardType.Ascii))
            error?.let { Text(it, color = Danger) }
            if (busy) Row(verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.padding(end = 12.dp))
                Text(tr("Bitte die Kopplung am Haupt-PC bestätigen …", "Please confirm the pairing on the host PC …"))
            }
            Button(onClick = { start() }, Modifier.fillMaxWidth().height(48.dp), enabled = !busy) { Text(tr("Koppeln", "Pair")) }
            Text(tr("Übers Internet: am besten per Tailscale/VPN (Adresse 100.x.y.z), sonst Portweiterleitung am Router auf den Haupt-PC.",
                "Over the internet: preferably via Tailscale/VPN (address 100.x.y.z), otherwise port forwarding on the router to the host PC."),
                fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

data class PairData(val addresses: List<String>, val port: Int, val code: String, val name: String = "")

@Composable
private fun AboutRow(model: AppModel) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    var licenses by remember { mutableStateOf<String?>(null) }
    var checking by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    Column(Modifier.fillMaxWidth().padding(16.dp)) {
        Text(tr("Swapline für Android ${de.arfep.swapline.BuildConfig.VERSION_NAME}", "Swapline for Android ${de.arfep.swapline.BuildConfig.VERSION_NAME}"), style = MaterialTheme.typography.titleSmall)
        Text("ARFEP IT-Service · MIT", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        val u = model.update
        if (u != null) TextButton(onClick = { openUrl(ctx, u.apkUrl) }) { Text(tr("Version ${u.version} herunterladen", "Download version ${u.version}")) }
        else TextButton(enabled = !checking, onClick = { checking = true; scope.launch { model.checkUpdate(force = true).join(); checking = false; if (model.update == null) android.widget.Toast.makeText(ctx, tr("Du hast die neueste Version.", "You have the latest version."), android.widget.Toast.LENGTH_SHORT).show() } }) {
            Text(if (checking) tr("Suche …", "Checking …") else tr("Nach Updates suchen", "Check for updates"))
        }
        TextButton(onClick = { licenses = runCatching { ctx.assets.open("licenses.txt").bufferedReader().readText() }.getOrDefault("") }) { Text(tr("Open-Source-Lizenzen", "Open source licenses")) }
    }
    licenses?.let { text ->
        AlertDialog(onDismissRequest = { licenses = null }, title = { Text(tr("Open-Source-Lizenzen", "Open source licenses")) },
            text = { Text(text, Modifier.verticalScroll(rememberScrollState()), fontSize = 11.sp, fontFamily = FontFamily.Monospace) },
            confirmButton = { TextButton(onClick = { licenses = null }) { Text("OK") } })
    }
}
