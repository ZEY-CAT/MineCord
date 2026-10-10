const crypto = require('node:crypto');

const DEFAULT_STUN_URL = 'stun:stun.l.google.com:19302';
const DEFAULT_CREDENTIAL_TTL_SECONDS = 3600;
const MIN_CREDENTIAL_TTL_SECONDS = 60;
const MAX_CREDENTIAL_TTL_SECONDS = 86400;

function configuredUrls(value, schemes, variableName) {
  if (!value) return [];
  const urls = String(value).split(',').map(item => item.trim()).filter(Boolean);
  for (const url of urls) {
    if (/\s/.test(url) || !new RegExp(`^(?:${schemes.join('|')}):[^,]+$`, 'i').test(url)) {
      throw new Error(`${variableName} contains an invalid ICE URL.`);
    }
    if (/^turns:/i.test(url) && /[?&]transport=udp(?:&|$)/i.test(url)) {
      throw new Error(`${variableName} cannot use UDP transport with a TLS TURN URL.`);
    }
    const transport = url.match(/[?&]transport=([^&]+)/i)?.[1];
    if (transport && !['udp', 'tcp'].includes(transport.toLowerCase())) {
      throw new Error(`${variableName} transport must be udp or tcp.`);
    }
  }
  return [...new Set(urls)];
}

function credentialTtl(env) {
  if (!env.TURN_CREDENTIAL_TTL_SECONDS) return DEFAULT_CREDENTIAL_TTL_SECONDS;
  const value = Number(env.TURN_CREDENTIAL_TTL_SECONDS);
  if (!Number.isSafeInteger(value) || value < MIN_CREDENTIAL_TTL_SECONDS || value > MAX_CREDENTIAL_TTL_SECONDS) {
    return DEFAULT_CREDENTIAL_TTL_SECONDS;
  }
  return value;
}

function createRtcConfig(userId, env = process.env, now = Date.now()) {
  const stunUrls = configuredUrls(env.STUN_URL, ['stun', 'stuns'], 'STUN_URL');
  const turnUrls = configuredUrls(env.TURN_URL, ['turn', 'turns'], 'TURN_URL');
  const iceServers = [{ urls: [...new Set([DEFAULT_STUN_URL, ...stunUrls])] }];
  const warnings = [];
  const sharedSecret = env.TURN_SHARED_SECRET;
  let turnConfigured = false;
  let expiresAt = null;

  if (turnUrls.length && sharedSecret) {
    const ttl = credentialTtl(env);
    expiresAt = Math.floor(now / 1000) + ttl;
    const username = `${expiresAt}:${userId}`;
    const credential = crypto.createHmac('sha1', sharedSecret).update(username).digest('base64');
    iceServers.push({ urls: turnUrls, username, credential });
    turnConfigured = true;
  } else if (turnUrls.length || sharedSecret) {
    warnings.push('TURN relay is not ready. Configure both TURN_URL and TURN_SHARED_SECRET; permanent TURN credentials are not sent to clients.');
  } else {
    warnings.push('TURN relay is not configured. Voice may not connect across restrictive networks; STUN-only connections are best effort.');
  }

  if (env.TURN_USERNAME || env.TURN_CREDENTIAL) {
    warnings.push('Legacy static TURN credentials are intentionally not exposed. Configure a TURN shared-secret provider for temporary credentials.');
  }

  return {
    iceServers,
    turn: { configured: turnConfigured, expiresAt },
    warnings
  };
}

module.exports = { createRtcConfig, DEFAULT_CREDENTIAL_TTL_SECONDS };
