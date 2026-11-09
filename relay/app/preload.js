// Schmale Schnittstelle zur Oberfläche – jede Aktion prüft der Hauptprozess selbst.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const call = (ch, ...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld('relay', {
  state: force => call('state', !!force),
  showSecret: () => call('secret:show'),
  copySecret: () => call('secret:copy'),
  newSecret: () => call('secret:new'),
  copyCode: address => call('code:copy', address),
  setPort: port => call('port:set', port),
  install: () => call('svc:install'),
  uninstall: () => call('svc:uninstall'),
  start: () => call('svc:start'),
  stop: () => call('svc:stop'),
  restart: () => call('svc:restart'),
  setFirewall: on => call('firewall:set', !!on),
  log: () => call('log:tail'),
  openDir: () => call('dir:open'),
  checkUpdate: () => call('update:check'),
  openUpdate: url => call('update:open', url),
  installUpdate: () => call('update:install'),
  onUpdateProgress: fn => ipcRenderer.on('update:progress', (_e, p) => fn(Number(p) || 0)),
});
