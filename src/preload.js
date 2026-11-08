const { contextBridge, ipcRenderer } = require('electron');

const invoke = (ch, arg) => ipcRenderer.invoke(ch, arg);

contextBridge.exposeInMainWorld('api', {
  getStore: () => invoke('store:get'),
  profiles: {
    add: data => invoke('profiles:add', data),
    update: (id, patch) => invoke('profiles:update', { id, patch }),
    remove: id => invoke('profiles:remove', id),
    setActive: id => invoke('profiles:setActive', id),
    status: id => invoke('profiles:status', id),
    models: (id, refresh = false) => invoke('profiles:models', { id, refresh }),
    login: id => invoke('profiles:login', id),
    loginConsole: id => invoke('profiles:loginConsole', id),
    loginCancel: id => invoke('profiles:loginCancel', id),
    logout: id => invoke('profiles:logout', id),
    openTerminal: (id, cwd) => invoke('profiles:openTerminal', { id, cwd }),
  },
  favorites: {
    add: () => invoke('favorites:add'),
    remove: p => invoke('favorites:remove', p),
  },
  projects: {
    add: data => invoke('projects:add', data),
    update: (id, patch) => invoke('projects:update', { id, patch }),
    remove: id => invoke('projects:remove', id),
    setActive: id => invoke('projects:setActive', id),
    reorder: ids => invoke('projects:reorder', ids),
  },
  pickFolder: () => invoke('dialog:pickFolder'),
  setSettings: patch => invoke('settings:set', patch),
  pickClaude: () => invoke('settings:pickClaude'),
  history: {
    list: profileId => invoke('history:list', profileId),
    loadSession: data => invoke('history:loadSession', data),
  },
  session: {
    send: (tab, content) => invoke('session:send', { tab, content }),
    confirmBypass: tabId => invoke('session:confirmBypass', tabId),
    respond: (tabId, requestId, response) => invoke('session:respond', { tabId, requestId, response }),
    interrupt: tabId => invoke('session:interrupt', tabId),
    restart: tabId => invoke('session:restart', tabId),
    close: tabId => invoke('session:close', tabId),
    moveProfile: data => invoke('session:moveProfile', data),
  },
  openPath: p => invoke('shell:openPath', p),
  onEvent: cb => ipcRenderer.on('claude:event', (_e, d) => cb(d)),
  onUsage: cb => ipcRenderer.on('usage:update', (_e, d) => cb(d)),
  onLogin: cb => ipcRenderer.on('login:update', (_e, d) => cb(d)),
});
