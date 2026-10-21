const { app, BrowserWindow, shell, session, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { startActivityMonitor } = require('./activity-monitor');
const MineCordUpdater = require('./updater-bridge');

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
let updateCheckInterval = null;

// Current app version from package.json
const packageJsonPath = path.join(__dirname, '..', 'package.json');
const currentVersion = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')).version;

// Initialize the native updater
const updater = require('./updater-bridge');

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

async function checkForUpdates() {
  if (!serverUrl || !app.isPackaged) return;
  try {
    const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux';
    const arch = process.arch === 'x64' ? 'x64' : 'arm64';
    const channel = process.env.UPDATE_CHANNEL || 'stable';

    const updateInfo = await updater.checkForUpdates({
      serverUrl,
      currentVersion,
      platform,
      arch,
      channel
    });

    if (updateInfo) {
      // Update available - show notification to user
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        win.webContents.send('update-available', {
          version: updateInfo.version,
          notes: updateInfo.releaseNotes,
          critical: updateInfo.critical
        });
      }
    }
  } catch (error) {
    console.warn('MINECORD update check failed:', error.message);
  }
}

function setupAutoUpdater() {
  if (!app.isPackaged) return;

  // Initialize the native updater
  updater.load().catch(err => {
    console.error('Failed to load native updater:', err);
  });

  // Check for updates on startup
  checkForUpdates().catch(console.warn);

  // Also check periodically (every 6 hours)
  setInterval(() => {
    checkForUpdates().catch(console.warn);
  }, 6 * 60 * 60 * 1000);
}

async function downloadAndInstallUpdate(updateInfo) {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;

  try {
    // Show progress dialog
    const progressWin = new BrowserWindow({
      width: 400,
      height: 150,
      frame: false,
      resizable: false,
      parent: win,
      modal: true,
      show: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });

    // Simple progress HTML
    await progressWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
      <html><body style="font-family:system-ui;padding:20px;background:#1e1f22;color:#f2f4f7">
        <h3>Downloading Update...</h3>
        <progress id="progress" value="0" max="100" style="width:100%"></progress>
        <p id="status">Starting download...</p>
      </body></html>
    `)}`);

    progressWin.show();

    // Download with progress
    const tempDir = app.getPath('temp');
    const installerPath = path.join(tempDir, `MineCord-${updateInfo.version}-setup.exe`);

    await updater.downloadUpdate(updateInfo.downloadUrl, installerPath, (downloaded, total) => {
      const percent = total > 0 ? Math.round((downloaded / total) * 100) : 0;
      progressWin.webContents.executeJavaScript(`
        document.getElementById('progress').value = ${percent};
        document.getElementById('status').textContent = 'Downloaded ${(downloaded/1024/1024).toFixed(1)} MB / ${(total/1024/1024).toFixed(1)} MB (${percent}%)';
      `).catch(() => {});
      return true; // Continue
    });

    progressWin.close();

    // Install the update
    await updater.installUpdate(installerPath, app.getPath('exe').replace(/\\MINECORD\.exe$/i, ''));

    // Restart the app
    app.relaunch();
    app.exit(0);
  } catch (error) {
    console.error('Update failed:', error);
    dialog.showErrorBox('Update Failed', `Failed to install update: ${error.message}`);
  }
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
    try {
      const target = new URL(url);
      if (target.protocol === 'https:' || target.protocol === 'http:') {
        shell.openExternal(target.href).catch(error => {
          console.warn('Could not open external MINECORD link:', error.message);
        });
      }
    } catch (error) {
      console.warn('Could not open external MINECORD link:', error.message);
    }
    return { action: 'deny' };
  });

  return win;
}

app.whenReady().then(async () => {
  // Initialize auto-updater for packaged apps
  setupAutoUpdater();

  const win = createWindow();

  win.on('closed', () => {
    if (stopActivityMonitor) stopActivityMonitor();
  });

  // Handle update-available from renderer
  win.webContents.on('update-available', (event, info) => {
    win.webContents.send('update-download-progress', { percent: 0 });
    downloadAndInstallUpdate(info).catch(console.error);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});