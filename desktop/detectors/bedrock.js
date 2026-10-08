const { runBooleanQuery } = require('./powershell');

module.exports = {
  id: 'bedrock',
  async detect() {
    return runBooleanQuery(
      "$p = Get-Process -Name 'Minecraft.Windows' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1; if ($p) { '1' } else { '0' }"
    );
  }
};
