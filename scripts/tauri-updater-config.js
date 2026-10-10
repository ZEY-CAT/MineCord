function resolveUpdaterConfig(env = process.env) {
  const publicKey = String(env.MINECORD_UPDATER_PUBKEY || '').trim();
  const signingKey = String(env.TAURI_SIGNING_PRIVATE_KEY || '').trim();
  const endpoint = String(env.MINECORD_UPDATER_ENDPOINT || '').trim();
  const configured = [publicKey, signingKey, endpoint].filter(Boolean).length;

  if (configured === 0) {
    return {
      enabled: false,
      config: {
        bundle: { createUpdaterArtifacts: false },
        plugins: { updater: { pubkey: '', endpoints: [] } }
      }
    };
  }
  if (configured !== 3 || publicKey.includes('REPLACE') || publicKey.includes('REQUIRED')) {
    throw new Error('To enable signed updates, configure MINECORD_UPDATER_PUBKEY, TAURI_SIGNING_PRIVATE_KEY, and MINECORD_UPDATER_ENDPOINT together.');
  }

  let parsedEndpoint;
  try {
    parsedEndpoint = new URL(endpoint);
  } catch {
    throw new Error('MINECORD_UPDATER_ENDPOINT must be a valid HTTPS URL.');
  }
  if (parsedEndpoint.protocol !== 'https:' || parsedEndpoint.username || parsedEndpoint.password) {
    throw new Error('MINECORD_UPDATER_ENDPOINT must be an HTTPS URL without embedded credentials.');
  }
  if (!signingKey.includes('\n') && !require('node:fs').existsSync(signingKey)) {
    throw new Error('TAURI_SIGNING_PRIVATE_KEY does not name an accessible key file.');
  }

  return {
    enabled: true,
    config: {
      bundle: { createUpdaterArtifacts: true },
      plugins: { updater: { pubkey: publicKey, endpoints: [parsedEndpoint.href] } }
    }
  };
}

module.exports = { resolveUpdaterConfig };
