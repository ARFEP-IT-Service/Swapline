// Fenster „Gerät koppeln“: nur Texte holen und die Antwort zurückgeben (der Hauptprozess prüft den Absender)
'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('pairConfirm', {
  info: () => ipcRenderer.invoke('pairc:info'),
  answer: a => ipcRenderer.invoke('pairc:answer', a),
});
