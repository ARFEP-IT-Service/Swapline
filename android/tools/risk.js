// Erzeugt app/src/main/java/de/arfep/swapline/model/Risk.kt aus src/renderer/risk.js (gleiche Muster am PC und auf
// dem Handy). Nach jeder Änderung an risk.js: node tools/risk.js – RiskTest prüft beide mit tests/risk-cases.json.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'risk.js'), 'utf8');
const list = name => {
  const block = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\n\\];`).exec(src)[1];
  return [...block.matchAll(/\['(\w+)', \/(.+)\/i\],/g)].map(m => [m[1], m[2]]);
};
const one = name => new RegExp(`const ${name} = \\/(.+)\\/i;`).exec(src)[1];
// JS-Muster → Kotlin-Rohstring; „$“ vor Buchstaben oder { wäre in Kotlin eine Vorlage
const kt = re => { if (/\$[A-Za-z{]/.test(re) || re.includes('"""')) throw new Error('Muster nicht übertragbar: ' + re); return 'Regex("""' + re + '""", RegexOption.IGNORE_CASE)'; };
const rules = arr => arr.map(([r, re]) => `        "${r}" to ${kt(re)},`).join('\n');
const out = `// ERZEUGT aus src/renderer/risk.js mit „node tools/risk.js“ – nicht von Hand ändern.
// Einstufung von Rückfragen („Darf Claude … ausführen?“): kritisch (rot), Vorsicht (orange) oder normal – nur Anzeige.
package de.arfep.swapline.model

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

enum class RiskLevel { CRITICAL, MEDIUM, NORMAL }
data class Risk(val level: RiskLevel, val reason: String)

object Risks {
    private val critical = listOf(
${rules(list('RISK_CRITICAL'))}
    )
    private val medium = listOf(
${rules(list('RISK_MEDIUM'))}
    )
    private val fileCritical = ${kt(one('RISK_FILE_CRITICAL'))}
    private val fileMedium = ${kt(one('RISK_FILE_MEDIUM'))}

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
`;
fs.writeFileSync(path.join(__dirname, '..', 'app', 'src', 'main', 'java', 'de', 'arfep', 'swapline', 'model', 'Risk.kt'), out);
console.log('Risk.kt geschrieben');
