const { app, BrowserWindow, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { startActivityMonitor } = require('./activity-monitor');

const configFile = path.join(__dirname, 'config.json');
let savedServerUrl = '';
try {
  savedServerUrl = JSON.parse(fs.readFileSync(configFile, 'utf8')).serverUrl || '';
} catch (error) {
  if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) console.error('Could not read desktop config:', error);
}
const configuredServerUrl = (process.env.MINECORD_SERVER_URL || (!app.isPackaged ? 'http://localhost:3000' : savedServerUrl)).replace(/\/+$/, '');
const serverUrl = app.isPackaged && !/^https:\/\//i.test(configuredServerUrl) ? '' : configuredServerUrl;
let stopActivityMonitor = null;

async function reportActivity(activity) {
  if (!serverUrl) return;
  const cookies = await session.defaultSession.cookies.get({ url: serverUrl });
  const sessionCookie = cookies.find(cookie => cookie.name === 'mc_session');
  if (!sessionCookie) return;
  const response = await fetch(`${serverUrl}/api/activity/presence`, {
    method: 'POST',
    headers: { Cookie: `mc_session=${encodeURIComponent(sessionCookie.value)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(activity)
  });
  if (!response.ok && response.status !== 401) throw new Error(`MINECORD activity update failed (${response.status}).`);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#111',
    webPreferences: {
      contextIsolation: true,
      sandbox: true
    }
  });

  if (!serverUrl) {
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<h2>MINECORD server is not configured</h2><p>Set MINECORD_SERVER_URL or update desktop/config.json before building.</p>'));
  } else {
    win.loadURL(serverUrl);
    stopActivityMonitor = startActivityMonitor(reportActivity, message => console.warn(message));
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  createWindow();
});

app.on('window-all-closed', () => {
  if (stopActivityMonitor) stopActivityMonitor();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (stopActivityMonitor) stopActivityMonitor();
});