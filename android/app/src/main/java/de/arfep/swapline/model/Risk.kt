// ERZEUGT aus src/renderer/risk.js mit „node tools/risk.js“ – nicht von Hand ändern.
// Einstufung von Rückfragen („Darf Claude … ausführen?“): kritisch (rot), Vorsicht (orange) oder normal – nur Anzeige.
package de.arfep.swapline.model

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

enum class RiskLevel { CRITICAL, MEDIUM, NORMAL }
data class Risk(val level: RiskLevel, val reason: String)

object Risks {
    private val critical = listOf(
        "delete" to Regex("""\brm(?=[^|;&\n]*\s(?:-[a-z]*r|--recursive))(?=[^|;&\n]*\s(?:-[a-z]*f|--force))\s|\bRemove-Item\b(?=[^|;\n]*\s-Recurse)(?=[^|;\n]*\s-Force)|\b(?:rd|rmdir)\s+\/s\b|\bdel\s+(?:\/\w+\s+)*\/s\b""", RegexOption.IGNORE_CASE),
        "git" to Regex("""\bgit\s+push\b[^|;&\n]*(?:\s--force(?:-with-lease)?\b|\s-f\b|\s--delete\b|\s\+\S)|\bgit\s+reset\s+--hard\b|\bgit\s+clean\s+-[a-z]*f|\bgit\s+filter-(?:branch|repo)\b|\bgit\s+branch\s+-D\b""", RegexOption.IGNORE_CASE),
        "script" to Regex("""\b(?:curl|wget|iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b[^|\n]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh|python3?|node|iex|Invoke-Expression)\b|\biex\s*\(|\bInvoke-Expression\b""", RegexOption.IGNORE_CASE),
        "system" to Regex("""\bsudo\b|\bdoas\b|\bmkfs|\bdd\s+if=|\bformat\s+[a-z]:|\bdiskpart\b|\bshutdown\b|\breboot\b|\bpoweroff\b|\bStop-Computer\b|\bRestart-Computer\b|\bFormat-Volume\b|\bbcdedit\b|\bvssadmin\b|\breg\s+(?:delete|add)\b|\bSet-ExecutionPolicy\b|\bchmod\s+(?:-R\s+)?0?777\b|\bchown\s+-R\b|:\(\)\s*\{|>\s*\/dev\/sd|\bkill\s+-9\s+-1\b|\btakeown\b""", RegexOption.IGNORE_CASE),
        "database" to Regex("""\bdrop\s+(?:table|database|schema)\b|\btruncate\s+table\b""", RegexOption.IGNORE_CASE),
        "publish" to Regex("""\b(?:npm|pnpm|yarn)\s+publish\b|\bcargo\s+publish\b|\btwine\s+upload\b|\bgh\s+release\s+(?:create|delete)\b|\bgh\s+repo\s+delete\b""", RegexOption.IGNORE_CASE),
        "secret" to Regex("""\.ssh[\\/]|\bid_(?:rsa|ed25519)\b|\.aws[\\/]credentials|\.credentials\.json|\/etc\/(?:passwd|shadow|sudoers)\b""", RegexOption.IGNORE_CASE),
    )
    private val medium = listOf(
        "delete" to Regex("""\brm\s|\brmdir\b|\bdel\s|\bRemove-Item\b|\bunlink\b|\s-delete\b|\bgit\s+rm\b|\bdocker\s+(?:rm|rmi|system\s+prune|volume\s+rm)\b""", RegexOption.IGNORE_CASE),
        "install" to Regex("""\b(?:npm|pnpm|yarn)\s+(?:i|install|add|update|upgrade)\b|\bnpx\s|\bpip3?\s+install\b|\bapt(?:-get)?\s+(?:install|remove|purge)\b|\bbrew\s+install\b|\bwinget\s+(?:install|uninstall)\b|\bchoco\s+(?:install|uninstall)\b|\bcargo\s+install\b|\bgo\s+install\b""", RegexOption.IGNORE_CASE),
        "git" to Regex("""\bgit\s+(?:push|rebase|merge|restore|commit\s+--amend|checkout\s+--|stash\s+(?:drop|clear)|tag\s+-d)\b""", RegexOption.IGNORE_CASE),
        "network" to Regex("""\b(?:curl|wget|iwr|irm|Invoke-WebRequest|Invoke-RestMethod|scp|rsync|ssh|sftp|ftp)\b""", RegexOption.IGNORE_CASE),
        "process" to Regex("""\b(?:kill|pkill|killall|taskkill|Stop-Process|Stop-Service)\b|\bsystemctl\s+(?:stop|restart|disable)\b""", RegexOption.IGNORE_CASE),
        "permissions" to Regex("""\b(?:chmod|chown|icacls|attrib)\b""", RegexOption.IGNORE_CASE),
    )
    private val fileCritical = Regex("""(?:^|[\\/])(?:\.ssh|\.aws|\.gnupg)[\\/]|(?:^|[\\/])\.env(?:\.[\w-]+)?$|\bid_(?:rsa|ed25519)\b|credentials|(?:^|[\\/])(?:\.npmrc|\.pypirc|authorized_keys|\.bashrc|\.zshrc|\.profile)$|^\/etc\/|[\\/]Windows[\\/]|System32""", RegexOption.IGNORE_CASE)
    private val fileMedium = Regex("""[\\/]\.git[\\/]|[\\/]\.github[\\/]workflows[\\/]|[\\/]\.claude[\\/]settings|(?:^|[\\/])package\.json$""", RegexOption.IGNORE_CASE)

    fun of(tool: String, input: JsonElement?): Risk {
        val o = input as? JsonObject
        fun s(k: String) = (o?.get(k) as? JsonPrimitive)?.takeIf { it.isString }?.content
        if (tool == "Bash" || tool == "PowerShell") {
            val cmd = s("command").orEmpty()
            critical.firstOrNull { it.second.containsMatchIn(cmd) }?.let { return Risk(RiskLevel.CRITICAL, it.first) }
            medium.firstOrNull { it.second.containsMatchIn(cmd) }?.let { return Risk(RiskLevel.MEDIUM, it.first) }
            return Risk(RiskLevel.NORMAL, "")
        }
        val file = s("file_path") ?: s("notebook_path") ?: ""
        if (file.isNotEmpty() && tool in setOf("Write", "Edit", "MultiEdit", "NotebookEdit")) {
            if (fileCritical.containsMatchIn(file)) return Risk(RiskLevel.CRITICAL, "secret")
            if (fileMedium.containsMatchIn(file)) return Risk(RiskLevel.MEDIUM, "config")
        }
        return Risk(RiskLevel.NORMAL, "")
    }
}
