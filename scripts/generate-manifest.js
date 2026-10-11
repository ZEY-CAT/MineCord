#!/usr/bin/env node
/**
 * Generate Tauri updater manifest (latest.json) with correctly formatted minisign signature.
 * Usage: node generate-manifest.js <installer_path> <version> <notes> <output_path>
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function signWithMinisign(filePath, privateKeyPath) {
  const minisignPath = path.join(process.env.USERPROFILE, 'bin', 'minisign.exe');
  const result = spawnSync(minisignPath, [
    '-S', '-m', filePath,
    '-s', privateKeyPath,
    '-W',
    '-c', `MINECORD ${process.argv[3] || 'release'} installer`
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

function main() {
  if (process.argv.length < 6) {
    console.error('Usage: node generate-manifest.js <installer_path> <version> <notes> <output_path> [private_key_path]');
    process.exit(1);
  }

  const installerPath = process.argv[2];
  const version = process.argv[3];
  const notes = process.argv[4];
  const outputPath = process.argv[5];
  const privateKeyPath = process.argv[6] || path.join(process.env.USERPROFILE, '.minisign', 'minisign.key');
  const minisignPath = path.join(process.env.USERPROFILE, 'bin', 'minisign.exe');

  if (!fs.existsSync(installerPath)) {
    throw new Error(`Installer not found: ${installerPath}`);
  }
  if (!fs.existsSync(privateKeyPath)) {
    throw new Error(`Private key not found: ${privateKeyPath}`);
  }

  // Sign the installer
  console.log(`Signing ${installerPath}...`);
  const sigContent = signWithMinisign(installerPath, privateKeyPath);

  // Read the signature file content (already in .minisig format)
  const signatureBase64 = base64Encode(sigContent);

  // Create manifest
  const manifest = {
    version,
    notes,
    pub_date: new Date().toISOString(),
    platforms: {
      'windows-x86_64': {
        signature: signatureBase64,
        url: `https://github.com/ZEY-CAT/MineCord/releases/download/v${version}/${path.basename(installerPath)}`
      }
    }
  };

  fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2));
  console.log(`Manifest written to ${outputPath}`);

  // Also sign the manifest
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

  // Update manifest with manifest signature (for reference)
  // Note: Tauri updater doesn't use manifest signature, but we keep it for verification
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