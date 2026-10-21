const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const https = require('https');

function updaterRoutes(app, { data, save, requireAuth, originAllowed, APP_OWNER_USER_ID }) {
  const MANIFEST_DIR = path.join(__dirname, '..', 'updater-manifests');

  // Ensure manifest directory exists
  if (!fs.existsSync(MANIFEST_DIR)) {
    fs.mkdirSync(MANIFEST_DIR, { recursive: true });
  }

  function manifestPathFor(filename) {
    if (typeof filename !== 'string' || !/^update-manifest-(windows|macos|linux)-(x64|arm64)-(stable|beta|alpha)\.json$/.test(filename)) {
      return null;
    }
    return path.join(MANIFEST_DIR, filename);
  }

  // Get current app version
  const packageJsonPath = path.join(__dirname, '..', 'package.json');
  const currentVersion = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')).version;

  // Public endpoint to check for updates (used by desktop/Tauri clients)
  app.get('/api/updater/check', (req, res) => {
    const { platform, arch, channel = 'stable', version: clientVersion } = req.query;

    if (!platform || !arch) {
      return res.status(400).json({ error: 'platform and arch query parameters are required' });
    }

    const validChannels = ['stable', 'beta', 'alpha'];
    const validPlatforms = ['windows', 'macos', 'linux'];
    const validArchs = ['x64', 'arm64'];

    if (!validPlatforms.includes(platform)) {
      return res.status(400).json({ error: `Invalid platform. Must be one of: ${validPlatforms.join(', ')}` });
    }
    if (!validArchs.includes(arch)) {
      return res.status(400).json({ error: `Invalid arch. Must be one of: ${validArchs.join(', ')}` });
    }
    if (!['stable', 'beta', 'alpha'].includes(channel)) {
      return res.status(400).json({ error: `Invalid channel. Must be one of: stable, beta, alpha` });
    }

    // Find the latest manifest for the requested platform/arch/channel
    const manifestFiles = fs.readdirSync(MANIFEST_DIR)
      .filter(f => f.startsWith(`update-manifest-${platform}-${arch}-${channel}`) && f.endsWith('.json'))
      .sort()
      .reverse();

    if (manifestFiles.length === 0) {
      return res.json({ update: null, currentVersion });
    }

    const latestManifest = JSON.parse(fs.readFileSync(path.join(MANIFEST_DIR, manifestFiles[0]), 'utf8'));

    // Check if update is available. A missing or malformed client version is
    // treated as an old client instead of crashing the public endpoint.
    const normalizedClientVersion = typeof clientVersion === 'string' && /^\d+\.\d+\.\d+/.test(clientVersion)
      ? clientVersion
      : '0.0.0';
    const updateAvailable = isUpdateAvailable(normalizedClientVersion, latestManifest.version);

    if (!updateAvailable) {
      return res.json({ update: null, currentVersion });
    }

    // Return update info WITH signature for client-side verification
    // The signature is safe to expose - only the private key can create valid signatures
    res.json({ update: latestManifest, currentVersion });
  });

  // Admin endpoint to list all manifests
  app.get('/api/admin/updater/manifests', requireAuth, (req, res) => {
    const user = req.minecordUser;
    if (user.id !== APP_OWNER_USER_ID && user.role !== 'app_owner') {
      return res.status(403).json({ error: 'App owner access required' });
    }

    const manifests = fs.readdirSync(MANIFEST_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const manifest = JSON.parse(fs.readFileSync(path.join(MANIFEST_DIR, f), 'utf8'));
        const { signature, ...publicManifest } = manifest;
        return {
          filename: f,
          ...publicManifest,
          hasSignature: Boolean(signature)
        };
      })
      .sort((a, b) => b.timestamp - a.timestamp);

    res.json({ manifests, currentVersion });
  });

  // Admin endpoint to create a new manifest
  app.post('/api/admin/updater/manifests', requireAuth, async (req, res) => {
    if (!originAllowed(req)) return res.status(403).json({ error: 'Request origin is not allowed.' });

    const user = req.minecordUser;
    if (user.id !== APP_OWNER_USER_ID && user.role !== 'app_owner') {
      return res.status(403).json({ error: 'App owner access required' });
    }

    const { version, platform, arch, channel = 'stable', notes = '', minVersion = '0.0.0', critical = false } = req.body;

    if (!version || !platform || !arch) {
      return res.status(400).json({ error: 'version, platform, and arch are required' });
    }

    const validPlatforms = ['windows', 'macos', 'linux'];
    const validArchs = ['x64', 'arm64'];
    const validChannels = ['stable', 'beta', 'alpha'];

    if (!['windows', 'macos', 'linux'].includes(platform)) {
      return res.status(400).json({ error: `Invalid platform. Must be one of: ${validPlatforms.join(', ')}` });
    }
    if (!['x64', 'arm64'].includes(arch)) {
      return res.status(400).json({ error: `Invalid arch. Must be one of: ${validArchs.join(', ')}` });
    }
    if (!['stable', 'beta', 'alpha'].includes(channel)) {
      return res.status(400).json({ error: `Invalid channel. Must be one of: ${validChannels.join(', ')}` });
    }

    // Check if version is valid semver
    if (!/^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?(\+[a-zA-Z0-9.-]+)?$/.test(version)) {
      return res.status(400).json({ error: 'Invalid version format. Use semantic versioning (e.g., 1.2.3)' });
    }

    // Check if manifest already exists
    const manifestFilename = `update-manifest-${platform}-${arch}-${channel}.json`;
    const manifestPath = path.join(MANIFEST_DIR, manifestFilename);

    if (fs.existsSync(manifestPath)) {
      const existing = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (existing.version === version) {
        return res.status(409).json({ error: 'Manifest for this version/platform/arch/channel already exists' });
      }
    }

    // For now, we create a manifest without artifacts (they would be uploaded separately)
    // In production, artifacts would be uploaded and hashed
    const manifest = createUpdateManifest({
      version,
      platform,
      arch,
      channel,
      artifacts: [], // Would be populated when artifacts are uploaded
      notes: notes || '',
      minVersion: minVersion || '0.0.0',
      critical: critical || false,
      timestamp: Date.now(),
      downloadUrl: null,
      sha256Hash: null
    });

    // Save manifest (without signature for now - would be signed in CI/CD)
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    res.status(201).json({ manifest, currentVersion });
  });

  // Admin endpoint to upload artifacts and update manifest
  app.post('/api/admin/updater/manifests/:manifestFile/artifacts', requireAuth, (req, res) => {
    if (!originAllowed(req)) return res.status(403).json({ error: 'Request origin is not allowed.' });

    const user = req.minecordUser;
    if (user.id !== APP_OWNER_USER_ID && user.role !== 'app_owner') {
      return res.status(403).json({ error: 'App owner access required' });
    }

    const artifactManifestPath = manifestPathFor(req.params.manifestFile);
    if (!artifactManifestPath) return res.status(400).json({ error: 'Invalid manifest filename.' });

    if (!fs.existsSync(artifactManifestPath)) {
      return res.status(404).json({ error: 'Manifest not found' });
    }

    // In a real implementation, this would handle multipart file uploads
    // For now, return an error indicating this needs proper multipart handling
    return res.status(501).json({ error: 'Artifact upload not yet implemented. Use CI/CD pipeline for artifact uploads.' });
  });

  // Admin endpoint to sign a manifest's artifact hash
  app.post('/api/admin/updater/manifests/:manifestFile/sign', requireAuth, (req, res) => {
    if (!originAllowed(req)) return res.status(403).json({ error: 'Request origin is not allowed.' });

    const user = req.minecordUser;
    if (user.id !== APP_OWNER_USER_ID && user.role !== 'app_owner') {
      return res.status(403).json({ error: 'App owner access required' });
    }

    const manifestPath = manifestPathFor(req.params.manifestFile);
    if (!manifestPath) return res.status(400).json({ error: 'Invalid manifest filename.' });

    if (!fs.existsSync(manifestPath)) {
      return res.status(404).json({ error: 'Manifest not found' });
    }

    const { privateKeyPath } = req.body;
    if (!privateKeyPath) {
      return res.status(400).json({ error: 'privateKeyPath is required' });
    }

    if (!fs.existsSync(privateKeyPath)) {
      return res.status(400).json({ error: 'Private key file not found' });
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    
    // The manifest MUST have sha256Hash of the artifact to sign
    if (!manifest.sha256Hash) {
      return res.status(400).json({ error: 'Manifest missing sha256Hash. Upload artifact first.' });
    }

    // Sign the SHA-256 hash of the artifact (base64 or hex)
    // This is what the client will verify against the downloaded file
    const artifactHash = manifest.sha256Hash;
    const privateKey = fs.readFileSync(privateKeyPath, 'utf8');
    
    // Use Ed25519 for signing (consistent with minisign/Ed25519 verification)
    const privateKeyObj = crypto.createPrivateKey({
      key: privateKey,
      format: 'pem',
      type: 'pkcs8'
    });
    
    // For Ed25519, use null algorithm (no pre-hash) - Ed25519 uses SHA-512 internally
    const sign = crypto.createSign(null);
    sign.update(artifactHash);
    sign.end();
    
    // Ed25519 signature in raw IEEE P1363 format (64 bytes: 32 bytes r + 32 bytes s)
    const newSignature = sign.sign({ 
      key: privateKeyObj,
      dsaEncoding: 'ieee-p1363'
    }, 'base64');

    manifest.signature = newSignature;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    res.json({ manifest, message: 'Manifest signed successfully' });
  });

  // Admin endpoint to delete a manifest
  app.delete('/api/admin/updater/manifests/:manifestFile', requireAuth, (req, res) => {
    if (!originAllowed(req)) return res.status(403).json({ error: 'Request origin is not allowed.' });

    const user = req.minecordUser;
    if (user.id !== APP_OWNER_USER_ID && user.role !== 'app_owner') {
      return res.status(403).json({ error: 'App owner access required' });
    }

    const manifestPath = manifestPathFor(req.params.manifestFile);
    if (!manifestPath) return res.status(400).json({ error: 'Invalid manifest filename.' });

    if (!fs.existsSync(manifestPath)) {
      return res.status(404).json({ error: 'Manifest not found' });
    }

    fs.unlinkSync(manifestPath);
    res.json({ ok: true });
  });

  // Get current version
  app.get('/api/updater/version', (req, res) => {
    res.json({ version: currentVersion });
  });
}

function createUpdateManifest({ version, platform, arch, channel, artifacts, notes, minVersion, critical, timestamp, signature, downloadUrl, sha256Hash }) {
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
    signature: signature || null,
    downloadUrl: downloadUrl || null,
    sha256Hash: sha256Hash || null
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

module.exports = { updaterRoutes };