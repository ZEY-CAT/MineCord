const net = require('node:net');

function normalizeOrigin(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== '/' && url.pathname !== '') return null;
  return url.origin;
}

function normalizeCallbackUrl(value, provider) {
  if (typeof value !== 'string' || !value.trim()) return null;
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== `/auth/${provider}/callback`) return null;
  return url.href;
}

function hostIsLocal(hostname) {
  const host = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host === '::1') return true;
  if (!net.isIPv4(host)) return false;
  const [first, second] = host.split('.').map(Number);
  return first === 10
    || first === 127
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
}

function originIsLocal(value) {
  const origin = normalizeOrigin(value);
  if (!origin) return false;
  return hostIsLocal(new URL(origin).hostname);
}

function effectivePort(url) {
  if (url.port) return url.port;
  return url.protocol === 'https:' ? '443' : '80';
}

function configuredOrigins(options = {}) {
  const origins = new Set();
  const appOrigin = normalizeOrigin(options.appUrl);
  if (appOrigin) origins.add(appOrigin);
  const raw = options.allowedOrigins ?? process.env.OAUTH_ALLOWED_ORIGINS ?? '';
  const entries = Array.isArray(raw) ? raw : String(raw).split(',');
  for (const entry of entries) {
    const origin = normalizeOrigin(String(entry).trim());
    if (origin) origins.add(origin);
  }
  return origins;
}

function localDevelopmentEnabled(options = {}) {
  const appOrigin = normalizeOrigin(options.appUrl);
  if (!appOrigin) return false;
  const url = new URL(appOrigin);
  return url.protocol === 'http:' && hostIsLocal(url.hostname);
}

function isAllowedOrigin(value, options = {}) {
  const origin = normalizeOrigin(value);
  if (!origin) return false;
  if (configuredOrigins(options).has(origin)) return true;
  if (!localDevelopmentEnabled(options)) return false;
  const url = new URL(origin);
  if (url.protocol !== 'http:' || !hostIsLocal(url.hostname)) return false;
  const appUrl = new URL(normalizeOrigin(options.appUrl));
  const port = String(options.port || effectivePort(appUrl));
  return effectivePort(url) === port;
}

function originFromHost(req, options = {}) {
  const fallback = normalizeOrigin(options.appUrl);
  if (!fallback) return null;
  const host = String(req?.headers?.host || '').trim();
  if (!host || /[\/\\\s,]/.test(host)) return fallback;
  const appUrl = new URL(fallback);
  const scheme = localDevelopmentEnabled(options) ? 'http:' : appUrl.protocol;
  const candidate = `${scheme}//${host}`;
  return isAllowedOrigin(candidate, options) ? normalizeOrigin(candidate) : fallback;
}

function originAllowed(req, options = {}) {
  const raw = req?.headers?.origin;
  if (!raw) return true;
  const origin = normalizeOrigin(raw);
  if (!origin) return false;
  if (configuredOrigins(options).has(origin)) return true;
  const requestOrigin = originFromHost(req, options);
  return Boolean(requestOrigin && origin === requestOrigin);
}

function configuredCallbackUrl(provider, options = {}) {
  const prefix = String(provider || '').toUpperCase();
  const raw = options.env?.[`${prefix}_CALLBACK_URL`]
    ?? process.env[`${prefix}_CALLBACK_URL`]
    ?? '';
  return normalizeCallbackUrl(raw, provider);
}

function callbackUrl(provider, origin, options = {}) {
  const safeOrigin = normalizeOrigin(origin) || normalizeOrigin(options.appUrl);
  if (!safeOrigin) throw new Error('A valid OAuth callback origin is required.');
  const configured = configuredCallbackUrl(provider, options);
  if (configured) {
    const configuredOrigin = new URL(configured).origin;
    // A localhost callback override must not send a LAN request back to the
    // device that started OAuth. Ignore local overrides that do not match the
    // origin that initiated this flow; public overrides remain authoritative.
    if (!originIsLocal(configuredOrigin) || configuredOrigin === safeOrigin) return configured;
  }
  return new URL(`/auth/${provider}/callback`, safeOrigin).href;
}

function callbackUrlFromState(provider, state, req, options = {}) {
  const saved = normalizeCallbackUrl(state?.redirectUri, provider);
  if (saved) return saved;
  const origin = normalizeOrigin(state?.origin) || originFromHost(req, options);
  return callbackUrl(provider, origin, options);
}

module.exports = {
  normalizeOrigin,
  normalizeCallbackUrl,
  hostIsLocal,
  originIsLocal,
  configuredOrigins,
  isAllowedOrigin,
  originFromHost,
  originAllowed,
  configuredCallbackUrl,
  callbackUrl,
  callbackUrlFromState
};
