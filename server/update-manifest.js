const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function computeFileHash(filePath, algorithm = 'sha256') {
  const hash = crypto.createHash(algorithm);
  const stream = fs.createReadStream(filePath);
  return new Promise((resolve, reject) => {
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function computeFileSize(filePath) {
  const stats = fs.statSync(filePath);
  return stats.size;
}

function signData(data, privateKeyPath) {
  const privateKey = fs.readFileSync(privateKeyPath, 'utf8');
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(data);
  sign.end();
  return sign.sign(privateKey, 'base64');
}

function verifySignature(data, signature, publicKeyPath) {
  const publicKey = fs.readFileSync(publicKeyPath, 'utf8');
  const verify = crypto.createVerify('RSA-SHA256');
  verify.update(data);
  verify.end();
  return verify.verify(publicKey, signature, 'base64');
}

function createUpdateManifest({ version, platform, arch, channel, artifacts, notes, minVersion, critical, timestamp, signature }) {
  return {
    version,
    platform,
    arch,
    channel: channel || 'stable',
    artifacts: artifacts || [],
    notes: notes || '',
    minVersion: minVersion || '0.0.0',
    critical: critical || false,
    timestamp: timestamp || Date.now(),
    signature: signature || null
  };
}

function verifyManifest(manifest, publicKeyPath) {
  if (!manifest.signature) return { valid: false, error: 'Missing signature' };
  const { signature, ...data } = manifest;
  const dataString = JSON.stringify(data, Object.keys(data).sort());
  const valid = verifySignature(dataString, manifest.signature, publicKeyPath);
  return { valid, error: valid ? null : 'Invalid signature' };
}

function loadManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) return null;
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function saveManifest(manifest, manifestPath) {
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

async function generateManifestForBuild({
  buildDir,
  version,
  platform,
  arch,
  channel = 'stable',
  notes = '',
  minVersion = '0.0.0',
  critical = false,
  privateKeyPath = null,
  outputDir = null
}) {
  const artifacts = [];

  for (const file of fs.readdirSync(buildDir)) {
    const filePath = path.join(buildDir, file);
    if (!fs.statSync(filePath).isFile()) continue;

    const hash = await computeFileHash(filePath);
    const size = computeFileSize(filePath);
    artifacts.push({
      filename: file,
      hash: `sha256:${hash}`,
      size,
      platform,
      arch,
      channel
    });
  }

  const manifest = createUpdateManifest({
    version,
    platform,
    arch,
    channel,
    artifacts,
    notes,
    minVersion,
    critical,
    timestamp: Date.now(),
    signature: privateKeyPath ? signData(
      JSON.stringify({
        version,
        platform,
        arch,
        channel,
        artifacts,
        notes,
        minVersion,
        critical,
        timestamp: Date.now()
      }, Object.keys({ version, platform, arch, channel, artifacts, notes, minVersion, critical, timestamp: Date.now() }).sort()),
      privateKeyPath
    ) : null
  });

  if (outputDir) {
    const outputPath = path.join(outputDir, `update-manifest-${platform}-${arch}-${channel}.json`);
    saveManifest(manifest, outputPath);
    console.log(`Manifest saved to ${outputPath}`);
  }

  return manifest;
}

function getPlatformArch() {
  const platform = process.platform;
  const arch = process.arch;
  return {
    platform: platform === 'win32' ? 'windows' : platform === 'darwin' ? 'macos' : platform === 'linux' ? 'linux' : platform,
    arch: arch === 'x64' ? 'x64' : arch === 'arm64' ? 'arm64' : arch
  };
}

function isUpdateAvailable(currentVersion, latestVersion) {
  const current = currentVersion.split('.').map(Number);
  const latest = latestVersion.split('.').map(Number);
  for (let i = 0; i < Math.max(current.length, latest.length); i++) {
    const c = current[i] || 0;
    const l = latest[i] || 0;
    if (l > c) return true;
    if (c > l) return false;
  }
  return false;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getUpdateInstallationPath(platform) {
  if (platform === 'windows') {
    return path.join(process.env.LOCALAPPDATA || process.env.APPDATA || '', 'MineCord', 'updates');
  }
  if (platform === 'darwin') {
    return path.join(process.env.HOME, 'Library', 'Application Support', 'MineCord', 'updates');
  }
  if (platform === 'linux') {
    return path.join(process.env.HOME, '.local', 'share', 'minecord', 'updates');
  }
  return path.join(process.cwd(), 'updates');
}

module.exports = {
  computeFileHash,
  computeFileSize,
  signData,
  verifySignature,
  createUpdateManifest,
  verifyManifest,
  loadManifest,
  saveManifest,
  generateManifestForBuild,
  getPlatformArch,
  isUpdateAvailable,
  formatBytes,
  getUpdateInstallationPath
};