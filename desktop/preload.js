const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('minecordDesktop', {
  openExternalAuth: url => ipcRenderer.invoke('minecord:open-external-auth', url),
  openAppInBrowser: () => ipcRenderer.invoke('minecord:open-app-in-browser'),
  getInitialOAuthUrl: () => ipcRenderer.invoke('minecord:get-initial-oauth-url'),
  onOAuthUrl: listener => {
    if (typeof listener !== 'function') return () => {};
    const handler = (_event, url) => listener(url);
    ipcRenderer.on('minecord:oauth-url', handler);
    return () => ipcRenderer.removeListener('minecord:oauth-url', handler);
  }
});
