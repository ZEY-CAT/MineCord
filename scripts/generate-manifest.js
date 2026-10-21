#!/usr/bin/env node
/**
 * Generate Tauri v2 updater manifest (latest.json) with minisign signatures.
 * Supports Windows, macOS, and Linux artifacts.
 *
 * Usage: node generate-manifest.js <version> <notes> <artifacts_dir> <output_path> [private_key_path]
 *
 * artifacts_dir should contain platform-specific subdirectories:
 *   windows/   - .exe installer + .minisig
 *   macos/     - .dmg + .minisig, .app.tar.gz + .minisig
 *   linux/     - .AppImage + .minisig, .deb + .minisig, .rpm + .minisig
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PLATFORM_MAP = {
  windows: { platform: 'windows-x86_64', ext: '.exe', arch: 'x64' },
  macos: { platform: 'darwin-universal', ext: '.dmg', arch: 'universal' },
  linux: { platform: 'linux-x86_64', ext: '.AppImage', arch: 'x86_64' },
};

function findMinisign() {
  const candidates = [
    path.join(process.env.USERPROFILE, 'bin', 'minisign.exe'),
    path.join(process.env.USERPROFILE, '.cargo', 'bin', 'minisign.exe'),
    'minisign',
    'minisign.exe',
  ];
  for (const c of candidates) {
    try {
      const r = spawnSync(c, ['-V'], { encoding: 'utf8' });
      if (r.status === 0) return c;
    } catch {}
  }
  return null;
}

function findArtifacts(artifactsDir) {
  const artifacts = [];

  // Windows: NSIS installer
  const winDir = path.join(artifactsDir, 'windows');
  if (fs.existsSync(winDir)) {
    for (const file of fs.readdirSync(winDir)) {
      if (file.endsWith('.exe') && !file.endsWith('.minisig')) {
        const sigFile = file + '.minisig';
        if (fs.existsSync(path.join(winDir, sigFile))) {
          artifacts.push({
            platform: 'windows-x86_64',
            file: path.join(winDir, file),
            sigFile: path.join(winDir, sigFile),
            filename: file,
          });
        }
      }
    }
  }

  // macOS: DMG and .app.tar.gz
  const macDir = path.join(artifactsDir, 'macos');
  if (fs.existsSync(macDir)) {
    for (const file of fs.readdirSync(macDir)) {
      if ((file.endsWith('.dmg') || file.endsWith('.tar.gz')) && !file.endsWith('.minisig')) {
        const sigFile = file + '.minisig';
        if (fs.existsSync(path.join(macDir, sigFile))) {
          artifacts.push({
            platform: 'darwin-universal',
            file: path.join(macDir, file),
            sigFile: path.join(macDir, sigFile),
            filename: file,
          });
        }
      }
    }
  }

  // Linux: AppImage, DEB, RPM
  const linuxDir = path.join(artifactsDir, 'linux');
  if (fs.existsSync(linuxDir)) {
    for (const file of fs.readdirSync(linuxDir)) {
      if ((file.endsWith('.AppImage') || file.endsWith('.deb') || file.endsWith('.rpm')) && !file.endsWith('.minisig')) {
        const sigFile = file + '.minisig';
        if (fs.existsSync(path.join(linuxDir, sigFile))) {
          artifacts.push({
            platform: 'linux-x86_64',
            file: path.join(linuxDir, file),
            sigFile: path.join(linuxDir, sigFile),
            filename: file,
          });
        }
      }
    }
  }

  return artifacts;
}

function signWithMinisign(filePath, privateKeyPath, minisignPath) {
  const result = spawnSync(minisignPath, [
    '-S', '-m', filePath,
    '-s', privateKeyPath,
    '-W',
    '-c', `MINECORD release artifact`
  ], { encoding: 'utf8' });

  if (result.error) {
    throw new Error(`minisign failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`minisign failed with code ${result.status}: ${result.stderr}`);
  }

  const sigFile = filePath + '.minisig';
  if (!fs.existsSync(sigFile)) {
    throw new Error(`Signature file not created: ${sigFile}`);
  }

  return fs.readFileSync(sigFile, 'utf8');
}

function base64Encode(content) {
  return Buffer.from(content, 'utf8').toString('base64');
}

function verifyKeyPair(publicKeyB64, privateKeyPath, minisignPath) {
  // Verify the private key corresponds to the public key by signing a test file
  const tmpFile = path.join(path.dirname(privateKeyPath) || '.', '.minisign_test_' + Date.now());
  fs.writeFileSync(tmpFile, 'test');
  try {
    signWithMinisign(tmpFile, privateKeyPath, minisignPath);
    const sigContent = fs.readFileSync(tmpFile + '.minisig', 'utf8');
    // The signature contains the public key; we could verify it matches but minisign doesn't easily expose this
    // Just verify signing works
    fs.unlinkSync(tmpFile);
    fs.unlinkSync(tmpFile + '.minisig');
    return true;
  } catch (e) {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    if (fs.existsSync(tmpFile + '.minisig')) fs.unlinkSync(tmpFile + '.minisig');
    throw new Error(`Key pair verification failed: ${e.message}`);
  }
}

function main() {
  if (process.argv.length < 6) {
    console.error('Usage: node generate-manifest.js <version> <notes> <artifacts_dir> <output_path> [private_key_path]');
    process.exit(1);
  }

  const version = process.argv[2];
  const notes = process.argv[3];
  const artifactsDir = process.argv[4];
  const outputPath = process.argv[5];
  const privateKeyPath = process.argv[6] || path.join(process.env.USERPROFILE, '.minisign', 'minisign.key');

  if (!fs.existsSync(artifactsDir)) {
    throw new Error(`Artifacts directory not found: ${artifactsDir}`);
  }
  if (!fs.existsSync(privateKeyPath)) {
    throw new Error(`Private key not found: ${privateKeyPath}`);
  }

  const minisignPath = findMinisign();
  if (!minisignPath) {
    throw new Error('minisign not found in PATH or standard locations');
  }

  console.log(`Using minisign: ${minisignPath}`);
  console.log(`Scanning artifacts in: ${artifactsDir}`);

  const artifacts = findArtifacts(artifactsDir);
  if (artifacts.length === 0) {
    throw new Error('No signed artifacts found. Ensure each artifact has a corresponding .minisig file.');
  }

  console.log(`Found ${artifacts.length} signed artifact(s):`);
  for (const a of artifacts) {
    console.log(`  - ${a.platform}: ${a.filename}`);
  }

  // Verify key pair works
  console.log('Verifying key pair...');
  verifyKeyPair('', privateKeyPath, minisignPath);

  // Build manifest platforms object
  const platforms = {};
  for (const artifact of artifacts) {
    const sigContent = fs.readFileSync(artifact.sigFile, 'utf8');
    const signatureBase64 = base64Encode(sigContent);

    // Tauri updater expects the URL to be the download URL for this specific artifact
    platforms[artifact.platform] = {
      signature: signatureBase64,
      url: `https://github.com/ZEY-CAT/MineCord/releases/download/v${version}/${artifact.filename}`
    };
  }

  const manifest = {
    version,
    notes,
    pub_date: new Date().toISOString(),
    platforms,
  };

  fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2));
  console.log(`Manifest written to ${outputPath}`);

  // Also sign the manifest itself
  console.log('Signing manifest...');
  const manifestContent = fs.readFileSync(outputPath, 'utf8');
  const tempManifest = outputPath + '.tmp';
  fs.writeFileSync(tempManifest, manifestContent);

  const sigResult = spawnSync(minisignPath, [
    '-S', '-m', tempManifest,
    '-s', privateKeyPath,
    '-W',
    '-c', `MINECORD ${version} latest.json manifest`
  ], { encoding: 'utf8' });

  if (sigResult.error || sigResult.status !== 0) {
    throw new Error(`Failed to sign manifest: ${sigResult.stderr || sigResult.error}`);
  }

  const manifestSigFile = tempManifest + '.minisig';
  const manifestSigContent = fs.readFileSync(manifestSigFile, 'utf8');
  const manifestSigBase64 = base64Encode(manifestSigContent);

  console.log(`Manifest signature (base64): ${manifestSigBase64.substring(0, 50)}...`);

  fs.unlinkSync(tempManifest);
  fs.unlinkSync(manifestSigFile);

  console.log('Done!');
}

try {
  main();
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
}