const { runBooleanQuery } = require('./powershell');

module.exports = {
  id: 'java',
  async detect() {
    return runBooleanQuery(
      "$p = Get-Process -Name 'javaw' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -match '^Minecraft(\\s|\\*|$)' } | Select-Object -First 1; if ($p) { '1' } else { '0' }"
    );
  }
};
