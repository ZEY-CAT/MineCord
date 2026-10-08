const { execFile } = require('child_process');

function runBooleanQuery(script) {
  if (process.platform !== 'win32') return Promise.resolve(false);
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      timeout: 2500,
      windowsHide: true,
      maxBuffer: 1024
    }, (error, stdout) => {
      if (error) return reject(error);
      resolve(stdout.trim() === '1');
    });
  });
}

module.exports = { runBooleanQuery };
