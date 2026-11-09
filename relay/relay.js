#!/usr/bin/env node
// Swapline-Vermittler ohne App starten (z. B. Linux/systemd): node relay.js [Pfad zur relay.json]
//   relay.json: { "port": 47821, "secret": "<mindestens 32 Zeichen>", "logFile": "relay.log" }
// Unter Windows besser die App „Swapline Relay“ (Dienst + Oberfläche). Der Vermittler selbst steht in app/core.js.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createRelay, hmac } = require('./app/core.js');

module.exports = { createRelay, hmac };

if (require.main === module) {
  const file = process.argv[2] || path.join(__dirname, 'relay.json');
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  const logFile = cfg.logFile ? path.resolve(path.dirname(file), cfg.logFile) : null;
  const log = msg => {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(line);
    if (logFile) { try { if (fs.existsSync(logFile) && fs.statSync(logFile).size > 5 * 1024 * 1024) fs.renameSync(logFile, logFile + '.1'); fs.appendFileSync(logFile, line + '\n'); } catch {} }
  };
  const relay = createRelay({ secret: cfg.secret, maxHosts: cfg.maxHosts, maxPipesPerHost: cfg.maxPipesPerHost, log });
  relay.listen(cfg.port || 47821, cfg.bind || '0.0.0.0').then(port => log(`Swapline-Vermittler hört auf Port ${port}`), e => { log('Start fehlgeschlagen: ' + e.message); process.exit(1); });
}
