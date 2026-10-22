const crypto = require('node:crypto');

const CREDENTIAL_TTL_SECONDS = 24 * 60 * 60;
const DEFAULT_APP_NAME = 'minecord';
const DEFAULT_STUN = 'stun:stun.relay.metered.ca:80';
const METERED_HOST = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

function safeAppName(value) {
  const appName = String(value || DEFAULT_APP_NAME).trim();
  if (!METERED_HOST.test(appName)) return null;
  return appName;
}

function validateIceServers(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Metered returned an invalid ICE server configuration.');
  }
  const iceServers = value.map(server => {
    if (!server || typeof server !== 'object' || Array.isArray(server)) {
      throw new Error('Metered returned an invalid ICE server configuration.');
    }
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    if (!urls.length || urls.some(url => typeof url !== 'string' || !/^(?:stun|stuns|turn|turns):\S+$/i.test(url))) {
      throw new Error('Metered returned an invalid ICE server configuration.');
    }
    const result = { urls };
    if (server.username !== undefined || server.credential !== undefined) {
      if (typeof server.username !== 'string' || !server.username
        || typeof server.credential !== 'string' || !server.credential) {
        throw new Error('Metered returned incomplete TURN credentials.');
      }
      result.username = server.username;
      result.credential = server.credential;
    }
    return result;
  });
  if (!iceServers.some(server => server.urls.some(url => /^turns?:/i.test(url)) && server.username && server.credential)) {
    throw new Error('Metered returned no authenticated TURN relay.');
  }
  return iceServers;
}

function createMeteredTurnService({ env = process.env, database, fetchImpl = fetch, now = Date.now }) {
  const appName = safeAppName(env.METERED_APP_NAME);
  const secretKey = String(env.METERED_SECRET_KEY || '').trim();
  const ttlSeconds = CREDENTIAL_TTL_SECONDS;
  const pendingCredentials = new Map();

  // Check if Metered credentials are properly configured
  const isMeteredConfigured = Boolean(appName && secretKey);

  function fallbackConfig(userId) {
    const { createRtcConfig } = require('./turn-config');
    return createRtcConfig(userId, env, now());
  }

  async function requestJson(url, options) {
    if (!isMeteredConfigured) {
      throw new Error('Metered TURN service is not configured');
    }
    let response;
    try {
      response = await fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(15000) });
    } catch (error) {
      throw new Error(`Metered TURN service request failed: ${error.name === 'TimeoutError' ? 'request timed out' : 'network error'}`);
    }
    let body;
    try {
      body = await response.json();
    } catch {
      throw new Error('Metered TURN service returned an invalid response.');
    }
    if (!response.ok) throw new Error(`Metered TURN service rejected the request (HTTP ${response.status}).`);
    return body;
  }

  async function fetchIceServers(apiKey) {
    if (!isMeteredConfigured) {
      throw new Error('Metered TURN service is not configured');
    }
    const url = new URL(`https://${appName}.metered.live/api/v1/turn/credentials`);
    url.searchParams.set('apiKey', apiKey);
    return validateIceServers(await requestJson(url, { method: 'GET' }));
  }

  async function createCredential(userId) {
    if (!isMeteredConfigured) {
      throw new Error('Metered TURN service is not configured');
    }
    const label = `minecord-${crypto.createHash('sha256').update(String(userId)).digest('hex').slice(0, 24)}`;
    const url = new URL(`https://${appName}.metered.live/api/v1/turn/credential`);
    url.searchParams.set('secretKey', secretKey);
    const createdAt = now();
    const result = await requestJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiryInSeconds: ttlSeconds, label })
    });
    if (result.expiryInSeconds !== undefined && result.expiryInSeconds !== ttlSeconds) {
      throw new Error('Metered created a TURN credential with an unexpected expiry.');
    }
    if (typeof result.username !== 'string' || !result.username
      || typeof result.apiKey !== 'string' || !result.apiKey) {
      throw new Error('Metered returned incomplete TURN credential metadata.');
    }
    const credential = {
      username: result.username,
      apiKey: result.apiKey,
      iceServers: null,
      createdAt,
      expiresAt: createdAt + ttlSeconds * 1000
    };
    database.saveMeteredTurnCredential(userId, credential);
    return credential;
  }

  async function ensureCredential(userId) {
    if (!isMeteredConfigured) {
      throw new Error('Metered TURN service is not configured');
    }
    const saved = database.findMeteredTurnCredential(userId);
    if (saved && saved.expires_at > now() + 30_000) {
      return {
        username: saved.username,
        apiKey: saved.api_key,
        iceServers: saved.ice_servers,
        createdAt: saved.created_at,
        expiresAt: saved.expires_at
      };
    }
    if (pendingCredentials.has(userId)) return pendingCredentials.get(userId);
    const pending = createCredential(userId).finally(() => pendingCredentials.delete(userId));
    pendingCredentials.set(userId, pending);
    return pending;
  }

  async function configForUser(userId) {
    if (!isMeteredConfigured) return fallbackConfig(userId);
    let credential = await ensureCredential(userId);
    if (!credential.iceServers) {
      credential.iceServers = await fetchIceServers(credential.apiKey);
      database.saveMeteredTurnCredential(userId, credential);
    }
    return {
      iceServers: credential.iceServers,
      turn: { configured: true, expiresAt: credential.expiresAt },
      warnings: now() - credential.createdAt < 120_000
        ? ['New Metered TURN credentials can take up to 2 minutes to propagate.']
        : []
    };
  }

  async function usageForUser(userId) {
    if (!isMeteredConfigured) throw new Error('Metered TURN usage monitoring is not configured.');
    const credential = database.findMeteredTurnCredential(userId);
    if (!credential) throw new Error('No Metered TURN credential exists for this account yet.');
    const url = new URL(`https://${appName}.metered.live/api/v1/turn/current_usage_for_user`);
    url.searchParams.set('secretKey', secretKey);
    url.searchParams.set('username', credential.username);
    const result = await requestJson(url, { method: 'GET' });
    if (typeof result.usageInGB !== 'number' || !Number.isFinite(result.usageInGB) || result.usageInGB < 0) {
      throw new Error('Metered returned invalid usage data.');
    }
    return { usageInGB: result.usageInGB, checkedAt: now(), expiresAt: credential.expires_at };
  }

  return {
    configured: isMeteredConfigured,
    configForUser,
    usageForUser
  };
}

module.exports = { createMeteredTurnService, CREDENTIAL_TTL_SECONDS };
