const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { createDevPortalAiRouter } = require('./dev-portal-ai');
const {
  createDeveloperHubRouter,
  isSecretContent,
  safeRepositoryPath
} = require('./developer-hub');

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 8;
const MAX_CONFIG_BYTES = 1024 * 1024;
const GITHUB_API = 'https://api.github.com';
const GITHUB_REPOSITORY = 'ZEY-CAT/MineCord';
const GITHUB_API_VERSION = '2022-11-28';
const DUMMY_CREDENTIAL = (() => {
  const passwordSalt = '00000000000000000000000000000000';
  return { passwordSalt, passwordHash: hashPassword('constant portal timing value', passwordSalt).toString('hex') };
})();
const DEFAULT_OPENAI_MODEL = 'gpt-4.1-mini';

function parseVaultEncryptionKey(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) return null;
  return Buffer.from(value, 'hex');
}

function encryptSecret(value, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return {
    version: 1,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64')
  };
}

function decryptSecret(value, key) {
  if (!key || !value || value.version !== 1 || value.algorithm !== 'aes-256-gcm') {
    throw new PortalError(503, 'Encrypted vault credentials are unavailable. Check the portal encryption key.');
  }
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(value.ciphertext, 'base64')),
      decipher.final()
    ]).toString('utf8');
  } catch {
    throw new PortalError(503, 'Encrypted vault credentials could not be opened. Check the portal encryption key.');
  }
}

class PortalError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

function validPassword(password, user) {
  if (typeof user.passwordHash !== 'string' || typeof user.passwordSalt !== 'string') return false;
  const expected = Buffer.from(user.passwordHash, 'hex');
  const actual = hashPassword(password, user.passwordSalt);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function normalizeConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1
      || !Array.isArray(value.users) || !Array.isArray(value.invitations || [])
      || (value.secrets !== undefined && (!value.secrets || typeof value.secrets !== 'object' || Array.isArray(value.secrets)))) {
    throw new Error('DEV-LOGINS.json must contain version 1, users, invitations, and an optional secrets object.');
  }
  const usernames = new Set();
  const ids = new Set();
  for (const user of value.users) {
    if (!user || typeof user !== 'object'
        || typeof user.id !== 'string' || !/^[a-f0-9-]{16,80}$/i.test(user.id)
        || typeof user.username !== 'string' || !/^[A-Za-z0-9_-]{3,32}$/.test(user.username)
        || typeof user.passwordSalt !== 'string' || !/^[a-f0-9]{32}$/i.test(user.passwordSalt)
        || typeof user.passwordHash !== 'string' || !/^[a-f0-9]{128}$/i.test(user.passwordHash)
        || !['owner', 'developer'].includes(user.role) || user.approved !== true) {
      throw new Error('DEV-LOGINS.json contains an invalid user entry.');
    }
    const username = user.username.toLowerCase();
    if (usernames.has(username) || ids.has(user.id)) throw new Error('DEV-LOGINS.json has duplicate users.');
    usernames.add(username);
    ids.add(user.id);
  }
  const invitations = value.invitations || [];
  for (const invitation of invitations) {
    if (!invitation || typeof invitation.id !== 'string'
        || typeof invitation.tokenHash !== 'string' || !/^[a-f0-9]{64}$/i.test(invitation.tokenHash)
        || !Number.isFinite(invitation.expiresAt) || invitation.role !== 'developer') {
      throw new Error('DEV-LOGINS.json contains an invalid invitation.');
    }
  }
  const secrets = value.secrets || {};
  if (Object.keys(secrets).length > 100 || Object.entries(secrets).some(([key, secret]) =>
    !/^[A-Za-z0-9_.-]{1,80}$/.test(key) || ['__proto__', 'prototype', 'constructor'].includes(key)
      || (typeof secret === 'string' ? secret.length > 32768
        : !secret || typeof secret !== 'object' || Array.isArray(secret) || secret.version !== 1
          || secret.algorithm !== 'aes-256-gcm' || typeof secret.iv !== 'string' || !/^[A-Za-z0-9+/=]{16,32}$/.test(secret.iv)
          || typeof secret.tag !== 'string' || !/^[A-Za-z0-9+/=]{20,24}$/.test(secret.tag)
          || typeof secret.ciphertext !== 'string' || secret.ciphertext.length > 50000
          || !/^[A-Za-z0-9+/=]*$/.test(secret.ciphertext)))) {
    throw new Error('DEV-LOGINS.json contains invalid vault entries.');
  }
  if (value.githubClientId !== undefined
      && (typeof value.githubClientId !== 'string' || !/^[A-Za-z0-9]{8,80}$/.test(value.githubClientId))) {
    throw new Error('DEV-LOGINS.json contains an invalid GitHub OAuth app client ID.');
  }
  const ai = value.ai || {};
  if (!ai || typeof ai !== 'object' || Array.isArray(ai)
      || (ai.openaiModel !== undefined && (typeof ai.openaiModel !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{1,79}$/.test(ai.openaiModel)))) {
    throw new Error('DEV-LOGINS.json contains invalid AI provider configuration.');
  }
  return { ...value, invitations, secrets, ai };
}

function createDevPortalRouter({
  publicDirectory,
  repositoryRoot,
  workspaceRoot,
  configPath,
  originAllowed,
  audit = () => {},
  fetchImpl = globalThis.fetch,
  vaultEncryptionKey = process.env.MINECORD_DEV_VAULT_KEY
}) {
  const router = express.Router();
  const portalFile = path.join(publicDirectory, 'dev-portal.html');
  const loginAttempts = new Map();
  const sessions = new Map();
  const rateLimits = new Map();
  const githubDeviceFlows = new Map();
  const encryptionKey = parseVaultEncryptionKey(vaultEncryptionKey);
  const sweepExpiredState = () => {
    const now = Date.now();
    for (const [key, entry] of loginAttempts) if (entry.resetAt <= now) loginAttempts.delete(key);
    for (const [key, session] of sessions) if (session.expiresAt <= now) {
      sessions.delete(key);
      githubDeviceFlows.delete(key);
    }
  };

  function readConfig() {
    try {
      const info = fs.lstatSync(configPath);
      if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_CONFIG_BYTES) {
        throw new PortalError(503, 'Developer portal login configuration is unavailable.');
      }
      const config = normalizeConfig(JSON.parse(fs.readFileSync(configPath, 'utf8')));
      const hasLegacySecrets = Object.values(config.secrets).some(secret => typeof secret === 'string');
      if (hasLegacySecrets && encryptionKey) {
        config.secrets = Object.fromEntries(Object.entries(config.secrets).map(([name, secret]) => [
          name, typeof secret === 'string' ? encryptSecret(secret, encryptionKey) : secret
        ]));
        writeConfig(config);
      }
      return config;
    } catch (error) {
      if (error instanceof PortalError) throw error;
      if (error.code === 'ENOENT') throw new PortalError(503, 'Developer portal logins are not configured.');
      throw new PortalError(503, 'Developer portal login configuration is invalid.');
    }
  }

  function writeConfig(config) {
    const normalized = normalizeConfig(config);
    const directory = path.dirname(configPath);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporary = `${configPath}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    let descriptor;
    try {
      descriptor = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(descriptor, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      fs.renameSync(temporary, configPath);
      try { fs.chmodSync(configPath, 0o600); } catch (error) {
        if (process.platform !== 'win32') throw error;
      }
    } catch (error) {
      if (descriptor !== undefined) fs.closeSync(descriptor);
      try { fs.unlinkSync(temporary); } catch (cleanupError) {
        if (cleanupError.code !== 'ENOENT') throw cleanupError;
      }
      throw error;
    }
    return normalized;
  }

  function getProviderConfig() {
    const config = readConfig();
    const storedKey = config.secrets.OPENAI_API_KEY;
    return {
      openaiConfigured: Boolean(encryptionKey && storedKey && typeof storedKey === 'object'),
      model: config.ai.openaiModel || DEFAULT_OPENAI_MODEL,
      vaultEncryptionConfigured: Boolean(encryptionKey)
    };
  }

  function getOpenAiKey() {
    if (!encryptionKey) return null;
    const storedKey = readConfig().secrets.OPENAI_API_KEY;
    if (!storedKey || typeof storedKey !== 'object') return null;
    return decryptSecret(storedKey, encryptionKey);
  }

  function updateOpenAiConfig(input, actor) {
    const model = input.model === undefined ? undefined : String(input.model).trim();
    const hasApiKey = Object.prototype.hasOwnProperty.call(input, 'apiKey');
    const clearApiKey = input.clearApiKey === true;
    if (model !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._:-]{1,79}$/.test(model)) {
      throw new PortalError(400, 'Enter a valid OpenAI model identifier.');
    }
    if (hasApiKey && (typeof input.apiKey !== 'string' || !/^sk-[A-Za-z0-9_-]{20,2048}$/.test(input.apiKey))) {
      throw new PortalError(400, 'Enter a valid OpenAI API key, or leave the key field empty.');
    }
    if (hasApiKey && clearApiKey) throw new PortalError(400, 'Choose either replacing or removing the OpenAI API key.');
    if ((hasApiKey || clearApiKey) && !encryptionKey) {
      throw new PortalError(503, 'Set MINECORD_DEV_VAULT_KEY to a private 32-byte hexadecimal key before configuring credentials.');
    }
    const config = readConfig();
    if (!encryptionKey && Object.values(config.secrets).some(secret => typeof secret === 'string')) {
      throw new PortalError(503, 'Legacy vault entries need encryption-key migration before portal configuration can be changed.');
    }
    if (model !== undefined) config.ai.openaiModel = model;
    if (hasApiKey) config.secrets.OPENAI_API_KEY = encryptSecret(input.apiKey, encryptionKey);
    if (clearApiKey) delete config.secrets.OPENAI_API_KEY;
    writeConfig(config);
    const result = getProviderConfig();
    audit({ actor: actor?.id, action: 'openai_configuration_updated', model: result.model, credentialConfigured: result.openaiConfigured });
    return result;
  }

  function sessionForRequest(req) {
    const token = String(req.headers.cookie || '').split(';')
      .map(value => value.trim()).find(value => value.startsWith('mc_dev_session='))
      ?.slice('mc_dev_session='.length);
    if (!token) return null;
    const key = crypto.createHash('sha256').update(token).digest('hex');
    const session = sessions.get(key);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      sessions.delete(key);
      githubDeviceFlows.delete(key);
      return null;
    }
    const config = readConfig();
    const user = config.users.find(entry => entry.id === session.userId && entry.approved);
    if (!user) {
      sessions.delete(key);
      githubDeviceFlows.delete(key);
      return null;
    }
    session.user = user;
    session.key = key;
    return session;
  }

  function safeUser(user) {
    return { id: user.id, username: user.username, role: user.role };
  }

  function requireSession(req, res, next) {
    try {
      const session = sessionForRequest(req);
      if (!session) return res.status(401).json({ error: 'Sign in to the developer portal.' });
      req.portalSession = session;
      req.portalUser = session.user;
      req.minecordUser = { id: session.user.id, username: session.user.username, role: session.user.role };
      next();
    } catch (error) {
      next(error);
    }
  }

  function requireOwner(req, res, next) {
    if (req.portalUser?.role !== 'owner') return res.status(403).json({ error: 'Owner access is required.' });
    next();
  }

  function requireSameOrigin(req, res, next) {
    if (!req.headers.origin || !originAllowed(req)) return res.status(403).json({ error: 'Request origin is not allowed.' });
    next();
  }

  function limitRequest(req, res, next) {
    const now = Date.now();
    const key = `${req.portalSession.key}:${req.method}`;
    let entry = rateLimits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + 60_000 };
      rateLimits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > (req.method === 'GET' ? 120 : 40)) {
      return res.status(429).json({ error: 'Developer portal rate limit exceeded.' });
    }
    next();
  }

  function githubToken(req) {
    const token = req.portalSession.githubToken;
    if (!token) throw new PortalError(409, 'Connect your own GitHub account first.');
    return token;
  }

  async function githubRequest(req, endpoint, options = {}) {
    const response = await fetchImpl(`${GITHUB_API}${endpoint}`, {
      ...options,
      signal: AbortSignal.timeout(20000),
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${githubToken(req)}`,
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
        'User-Agent': 'MineCord-Developer-Portal',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers
      }
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401) {
        delete req.portalSession.githubToken;
        throw new PortalError(409, 'GitHub authorization expired. Reconnect your account.');
      }
      const message = response.status === 404 ? 'GitHub resource is unavailable to this account.'
        : response.status === 409 ? 'GitHub reported a branch or commit conflict.'
          : 'GitHub request failed. Check repository permissions and try again.';
      throw new PortalError(response.status === 404 ? 404 : response.status === 409 ? 409 : 502, message);
    }
    return body;
  }

  async function publicGitHubRequest(endpoint) {
    const response = await fetchImpl(`${GITHUB_API}${endpoint}`, {
      signal: AbortSignal.timeout(15000),
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': GITHUB_API_VERSION, 'User-Agent': 'MineCord-Developer-Portal' }
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new PortalError(502, 'The public MineCord repository could not be reached.');
    return body;
  }

  const api = express.Router();
  api.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });

  api.get('/session', (req, res, next) => {
    try {
      const session = sessionForRequest(req);
      if (!session) return res.json({ user: null });
      res.json({ user: safeUser(session.user) });
    } catch (error) {
      next(error);
    }
  });

  api.post('/login', requireSameOrigin, (req, res, next) => {
    try {
      const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      sweepExpiredState();
      const key = req.ip || req.socket.remoteAddress || 'unknown';
      const attempt = loginAttempts.get(key);
      if (attempt && attempt.resetAt > Date.now() && attempt.count >= LOGIN_MAX_FAILURES) {
        return res.status(429).json({ error: 'Too many sign-in attempts. Try again later.' });
      }
      const config = readConfig();
      const user = config.users.find(entry => entry.username.toLowerCase() === username.toLowerCase() && entry.approved);
      const passwordMatches = password.length <= 256 && validPassword(password, user || DUMMY_CREDENTIAL);
      const valid = Boolean(user && passwordMatches);
      if (!valid) {
        const current = attempt && attempt.resetAt > Date.now() ? attempt : { count: 0, resetAt: Date.now() + LOGIN_WINDOW_MS };
        current.count += 1;
        loginAttempts.set(key, current);
        return res.status(401).json({ error: 'Invalid developer login.' });
      }
      loginAttempts.delete(key);
      if (sessions.size >= 10000) return res.status(503).json({ error: 'Developer portal sessions are temporarily full.' });
      const token = crypto.randomBytes(32).toString('base64url');
      const sessionKey = crypto.createHash('sha256').update(token).digest('hex');
      sessions.set(sessionKey, { userId: user.id, expiresAt: Date.now() + SESSION_TTL_MS });
      res.cookie('mc_dev_session', token, {
        httpOnly: true, sameSite: 'strict', secure: req.secure || req.get('x-forwarded-proto') === 'https',
        path: '/dev', maxAge: SESSION_TTL_MS
      });
      audit({ actor: user.id, action: 'portal_login' });
      res.json({ user: safeUser(user) });
    } catch (error) {
      next(error);
    }
  });

  api.post('/logout', requireSameOrigin, (req, res) => {
    const session = sessionForRequest(req);
    if (session) {
      sessions.delete(session.key);
      githubDeviceFlows.delete(session.key);
      audit({ actor: session.user.id, action: 'portal_logout' });
    }
    res.clearCookie('mc_dev_session', { httpOnly: true, sameSite: 'strict', path: '/dev', secure: req.secure || req.get('x-forwarded-proto') === 'https' });
    res.json({ ok: true });
  });

  api.post('/invitations/redeem', requireSameOrigin, (req, res, next) => {
    try {
      const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const token = typeof req.body?.token === 'string' ? req.body.token : '';
      if (!/^[A-Za-z0-9_-]{3,32}$/.test(username) || password.length < 8 || password.length > 200
          || !/^[a-f0-9]{64}$/i.test(token)) {
        return res.status(400).json({ error: 'Use a valid invite, username, and 8–200 character portal password.' });
      }
      const config = readConfig();
      if (config.users.some(user => user.username.toLowerCase() === username.toLowerCase())) {
        return res.status(409).json({ error: 'That developer username is already in use.' });
      }
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const invitation = config.invitations.find(item => item.tokenHash === tokenHash && item.expiresAt > Date.now());
      if (!invitation) return res.status(400).json({ error: 'Invitation is invalid or expired.' });
      const salt = crypto.randomBytes(16).toString('hex');
      config.users.push({
        id: crypto.randomUUID(),
        username,
        passwordSalt: salt,
        passwordHash: hashPassword(password, salt).toString('hex'),
        role: 'developer',
        approved: true,
        invitedAt: invitation.createdAt
      });
      config.invitations = config.invitations.filter(item => item.id !== invitation.id);
      writeConfig(config);
      audit({ action: 'invitation_redeemed', username: username.toLowerCase() });
      res.status(201).json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  api.use(requireSession, limitRequest);
  api.post('/password', requireSameOrigin, (req, res, next) => {
    try {
      const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
      const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
      if (currentPassword.length > 200 || newPassword.length < 8 || newPassword.length > 200) {
        return res.status(400).json({ error: 'Portal passwords must be 8–200 characters.' });
      }
      if (currentPassword.length < 1 || !validPassword(currentPassword, req.portalUser)) {
        return res.status(403).json({ error: 'Current portal password is incorrect.' });
      }
      const config = readConfig();
      const user = config.users.find(entry => entry.id === req.portalUser.id);
      if (!user) return res.status(401).json({ error: 'Portal account is no longer available.' });
      const salt = crypto.randomBytes(16).toString('hex');
      user.passwordSalt = salt;
      user.passwordHash = hashPassword(newPassword, salt).toString('hex');
      writeConfig(config);
      for (const [key, session] of sessions) {
        if (session.userId === user.id && key !== req.portalSession.key) {
          sessions.delete(key);
          githubDeviceFlows.delete(key);
        }
      }
      audit({ actor: user.id, action: 'portal_password_changed' });
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  api.put('/users/:id/role', requireOwner, requireSameOrigin, (req, res, next) => {
    try {
      const role = req.body?.role;
      const ownerPassword = typeof req.body?.ownerPassword === 'string' ? req.body.ownerPassword : '';
      if (!['owner', 'developer'].includes(role)) {
        return res.status(400).json({ error: 'Choose owner or developer.' });
      }
      if (ownerPassword.length < 1 || ownerPassword.length > 200 || !validPassword(ownerPassword, req.portalUser)) {
        return res.status(403).json({ error: 'Re-enter the current owner password to change account roles.' });
      }
      const config = readConfig();
      const target = config.users.find(entry => entry.id === req.params.id);
      if (!target) return res.status(404).json({ error: 'Developer account not found.' });
      if (target.username.toLowerCase() === 'zey-cat' && role !== 'owner') {
        return res.status(403).json({ error: 'ZEY-CAT must remain a portal owner.' });
      }
      if (target.id === req.portalUser.id && role !== 'owner') {
        return res.status(400).json({ error: 'You cannot remove your own owner role.' });
      }
      if (target.role === 'owner' && role !== 'owner'
          && config.users.filter(user => user.role === 'owner').length <= 1) {
        return res.status(409).json({ error: 'At least one owner account must remain.' });
      }
      if (target.role !== role) {
        target.role = role;
        writeConfig(config);
        audit({ actor: req.portalUser.id, action: 'portal_role_changed', target: target.id, role });
      }
      res.json({ ok: true, user: safeUser(target) });
    } catch (error) {
      next(error);
    }
  });

  api.use('/ai', createDevPortalAiRouter({
    repositoryRoot,
    workspaceRoot,
    originAllowed,
    getProviderConfig,
    getOpenAiKey,
    updateOpenAiConfig,
    fetchImpl,
    audit
  }));

  api.get('/users', requireOwner, (_req, res, next) => {
    try {
      const config = readConfig();
      res.json({ users: config.users.map(user => ({ ...safeUser(user), approved: user.approved })) });
    } catch (error) {
      next(error);
    }
  });

  api.post('/invitations', requireOwner, requireSameOrigin, (req, res, next) => {
    try {
      const lifetimeHours = Number(req.body?.lifetimeHours ?? 72);
      if (!Number.isInteger(lifetimeHours) || lifetimeHours < 1 || lifetimeHours > 168) {
        return res.status(400).json({ error: 'Invitation lifetime must be 1–168 hours.' });
      }
      const config = readConfig();
      const token = crypto.randomBytes(32).toString('hex');
      const invitation = {
        id: crypto.randomUUID(),
        tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
        role: 'developer',
        createdAt: Date.now(),
        expiresAt: Date.now() + lifetimeHours * 60 * 60 * 1000
      };
      config.invitations = [...config.invitations.filter(item => item.expiresAt > Date.now()), invitation];
      writeConfig(config);
      audit({ actor: req.portalUser.id, action: 'developer_invite_created' });
      res.status(201).json({ token, expiresAt: invitation.expiresAt, url: `/dev?invite=${token}` });
    } catch (error) {
      next(error);
    }
  });

  api.delete('/users/:id', requireOwner, requireSameOrigin, (req, res, next) => {
    try {
      const config = readConfig();
      const target = config.users.find(user => user.id === req.params.id);
      if (!target || target.role === 'owner') return res.status(404).json({ error: 'Developer account not found.' });
      config.users = config.users.filter(user => user.id !== target.id);
      writeConfig(config);
      for (const [key, session] of sessions) if (session.userId === target.id) {
        sessions.delete(key);
        githubDeviceFlows.delete(key);
      }
      audit({ actor: req.portalUser.id, action: 'developer_access_revoked', target: target.id });
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  api.get('/secrets', requireOwner, (_req, res, next) => {
    try {
      const config = readConfig();
      res.set('Cache-Control', 'no-store').json({
        keys: Object.keys(config.secrets).sort(),
        encryptionConfigured: Boolean(encryptionKey),
        legacyEntriesNeedMigration: Object.values(config.secrets).some(secret => typeof secret === 'string')
      });
    } catch (error) {
      next(error);
    }
  });

  api.put('/secrets', requireOwner, requireSameOrigin, (req, res, next) => {
    try {
      const entries = req.body?.set;
      const removals = req.body?.remove;
      if ((entries !== undefined && (!entries || typeof entries !== 'object' || Array.isArray(entries)
          || Object.keys(entries).length > 100
          || Object.entries(entries).some(([key, value]) => !/^[A-Za-z0-9_.-]{1,80}$/.test(key)
            || ['__proto__', 'prototype', 'constructor'].includes(key) || typeof value !== 'string' || value.length > 32768)))
          || (removals !== undefined && (!Array.isArray(removals) || removals.length > 100
            || removals.some(key => typeof key !== 'string' || !/^[A-Za-z0-9_.-]{1,80}$/.test(key)
              || ['__proto__', 'prototype', 'constructor'].includes(key))))
          || (entries === undefined && removals === undefined)) {
        return res.status(400).json({ error: 'Provide valid secret entries to set or names to remove.' });
      }
      const config = readConfig();
      if ((Object.keys(entries || {}).length || (removals || []).length) && !encryptionKey) {
        return res.status(503).json({ error: 'Set MINECORD_DEV_VAULT_KEY to a private 32-byte hexadecimal key before changing credentials.' });
      }
      if (!encryptionKey && Object.values(config.secrets).some(secret => typeof secret === 'string')) {
        return res.status(503).json({ error: 'Legacy vault entries need encryption-key migration before credentials can be changed.' });
      }
      for (const [key, value] of Object.entries(entries || {})) config.secrets[key] = encryptSecret(value, encryptionKey);
      for (const key of removals || []) delete config.secrets[key];
      writeConfig(config);
      const keys = Object.keys(config.secrets).sort();
      audit({ actor: req.portalUser.id, action: 'vault_updated', keys });
      res.set('Cache-Control', 'no-store').json({ ok: true, keys });
    } catch (error) {
      next(error);
    }
  });

  api.get('/github/status', async (req, res, next) => {
    try {
      if (!req.portalSession.githubToken) return res.json({ connected: false, configured: Boolean(readConfig().githubClientId) });
      const account = await githubRequest(req, '/user');
      const repository = await githubRequest(req, `/repos/${GITHUB_REPOSITORY}`);
      res.json({
        connected: true,
        login: account.login,
        repository: repository.full_name,
        canPush: Boolean(repository.permissions?.push)
      });
    } catch (error) {
      next(error);
    }
  });

  api.post('/github/device', requireSameOrigin, async (req, res, next) => {
    try {
      const clientId = readConfig().githubClientId;
      if (!clientId) return res.status(503).json({ error: 'GitHub device authorization is not configured in DEV-LOGINS.json.' });
      const response = await fetchImpl('https://github.com/login/device/code', {
        method: 'POST',
        signal: AbortSignal.timeout(15000),
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, scope: 'public_repo' })
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.device_code || !body?.user_code || !body?.verification_uri) {
        throw new PortalError(502, 'GitHub could not start device authorization.');
      }
      req.portalSession.githubDevice = {
        deviceCode: body.device_code,
        interval: Math.max(5, Number(body.interval) || 5),
        expiresAt: Date.now() + Math.min(Number(body.expires_in) || 900, 1800) * 1000
      };
      res.json({ userCode: body.user_code, verificationUri: body.verification_uri, expiresIn: body.expires_in });
    } catch (error) {
      next(error);
    }
  });

  api.post('/github/device/poll', requireSameOrigin, async (req, res, next) => {
    try {
      const flow = req.portalSession.githubDevice;
      if (!flow || flow.expiresAt <= Date.now()) return res.status(410).json({ error: 'GitHub device authorization expired. Start again.' });
      const { githubClientId } = readConfig();
      const response = await fetchImpl('https://github.com/login/oauth/access_token', {
        method: 'POST',
        signal: AbortSignal.timeout(15000),
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: githubClientId,
          device_code: flow.deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        })
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result) throw new PortalError(502, 'GitHub authorization could not be checked.');
      if (result.error === 'authorization_pending' || result.error === 'slow_down') {
        return res.json({ pending: true, interval: flow.interval + (result.error === 'slow_down' ? 5 : 0) });
      }
      if (result.error) {
        delete req.portalSession.githubDevice;
        return res.status(400).json({ error: 'GitHub authorization was denied or expired.' });
      }
      if (typeof result.access_token !== 'string') throw new PortalError(502, 'GitHub did not return an access token.');
      req.portalSession.githubToken = result.access_token;
      delete req.portalSession.githubDevice;
      const account = await githubRequest(req, '/user');
      audit({ actor: req.portalUser.id, action: 'github_account_connected', githubLogin: account.login });
      res.json({ connected: true, login: account.login });
    } catch (error) {
      next(error);
    }
  });

  api.get('/github/branches', async (req, res, next) => {
    try {
      const branches = await githubRequest(req, `/repos/${GITHUB_REPOSITORY}/branches?per_page=100`);
      res.json({ branches: branches.map(branch => ({ name: branch.name, sha: branch.commit.sha })) });
    } catch (error) {
      next(error);
    }
  });

  api.get('/github/commits', async (req, res, next) => {
    try {
      const branch = typeof req.query.branch === 'string' ? req.query.branch : 'main';
      if (!/^[A-Za-z0-9._/-]{1,120}$/.test(branch) || branch.includes('..')) {
        return res.status(400).json({ error: 'Invalid branch name.' });
      }
      const commits = await githubRequest(req, `/repos/${GITHUB_REPOSITORY}/commits?sha=${encodeURIComponent(branch)}&per_page=20`);
      res.json({ commits: commits.map(item => ({
        sha: item.sha,
        message: String(item.commit?.message || '').slice(0, 500),
        author: String(item.commit?.author?.name || '').slice(0, 100),
        date: item.commit?.author?.date || null,
        url: item.html_url
      })) });
    } catch (error) {
      next(error);
    }
  });

  api.get('/github/checks', async (req, res, next) => {
    try {
      const branch = typeof req.query.branch === 'string' ? req.query.branch : 'main';
      if (!/^[A-Za-z0-9._/-]{1,120}$/.test(branch) || branch.includes('..')) {
        return res.status(400).json({ error: 'Invalid branch name.' });
      }
      const ref = await githubRequest(req, `/repos/${GITHUB_REPOSITORY}/git/ref/heads/${encodeURIComponent(branch)}`);
      const response = await githubRequest(req, `/repos/${GITHUB_REPOSITORY}/commits/${ref.object.sha}/check-runs?per_page=50`);
      res.json({
        branch,
        checks: (response.check_runs || []).map(check => ({
          name: String(check.name || 'Check').slice(0, 100),
          status: String(check.status || 'unknown').slice(0, 40),
          conclusion: check.conclusion ? String(check.conclusion).slice(0, 40) : null,
          url: typeof check.html_url === 'string' ? check.html_url : null
        }))
      });
    } catch (error) {
      next(error);
    }
  });

  api.post('/github/push', requireSameOrigin, async (req, res, next) => {
    try {
      if (req.body?.confirmPush !== true || req.body?.createPullRequest !== true) {
        return res.status(400).json({ error: 'Explicitly confirm branch push and pull-request creation.' });
      }
      const files = req.body?.files;
      const baseBranch = typeof req.body?.baseBranch === 'string' ? req.body.baseBranch.trim() : 'main';
      const branchName = typeof req.body?.branchName === 'string' ? req.body.branchName.trim() : '';
      const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
      if (!Array.isArray(files) || files.length < 1 || files.length > 40
          || new Set(files).size !== files.length || files.some(file => typeof file !== 'string' || !safeRepositoryPath(file))
          || !/^[A-Za-z0-9._/-]{1,120}$/.test(baseBranch) || baseBranch.includes('..')
          || !/^[A-Za-z0-9][A-Za-z0-9._-]{1,40}$/.test(branchName)
          || message.length < 5 || message.length > 200) {
        return res.status(400).json({ error: 'Choose 1–40 authorized files, a valid feature branch name, and a 5–200 character commit message.' });
      }
      const repository = await githubRequest(req, `/repos/${GITHUB_REPOSITORY}`);
      if (!repository.permissions?.push) return res.status(403).json({ error: 'Your GitHub account cannot push to this repository.' });
      const ref = await githubRequest(req, `/repos/${GITHUB_REPOSITORY}/git/ref/heads/${encodeURIComponent(baseBranch)}`);
      const baseCommit = await githubRequest(req, `/repos/${GITHUB_REPOSITORY}/git/commits/${ref.object.sha}`);
      const userRoot = path.join(workspaceRoot, crypto.createHash('sha256').update(req.portalUser.id).digest('hex'));
      const entries = [];
      for (const relativePath of files) {
        const workingFile = path.resolve(userRoot, ...relativePath.split('/'));
        const baselineFile = path.resolve(userRoot, '.base', ...relativePath.split('/'));
        if (!workingFile.startsWith(`${userRoot}${path.sep}`) || !baselineFile.startsWith(`${userRoot}${path.sep}`)) {
          return res.status(400).json({ error: 'A selected workspace path is invalid.' });
        }
        let workingInfo;
        let baselineInfo;
        try {
          workingInfo = fs.lstatSync(workingFile);
          baselineInfo = fs.lstatSync(baselineFile);
        } catch {
          return res.status(409).json({ error: 'A selected file has no saved baseline. Save and review it again.' });
        }
        if (!workingInfo.isFile() || workingInfo.isSymbolicLink() || workingInfo.size > 128 * 1024
            || !baselineInfo.isFile() || baselineInfo.isSymbolicLink()) {
          return res.status(400).json({ error: 'A selected file is unsafe or exceeds the file-size limit.' });
        }
        const content = fs.readFileSync(workingFile, 'utf8');
        const baseline = fs.readFileSync(baselineFile, 'utf8');
        if (isSecretContent(content)) {
          return res.status(400).json({ error: 'Secret scanning blocked a selected file.' });
        }
        const remote = await githubRequest(req, `/repos/${GITHUB_REPOSITORY}/contents/${relativePath.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(baseBranch)}`);
        const remoteContent = Buffer.from(String(remote.content || '').replace(/\s/g, ''), 'base64').toString('utf8');
        if (remoteContent !== baseline) {
          return res.status(409).json({ error: `${relativePath} changed on main since the workspace baseline. Review and rebase before pushing.` });
        }
        entries.push({ path: relativePath, content });
      }
      const branch = `dev/${branchName}-${crypto.randomBytes(4).toString('hex')}`;
      await githubRequest(req, `/repos/${GITHUB_REPOSITORY}/git/refs`, {
        method: 'POST',
        body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: ref.object.sha })
      });
      const treeEntries = [];
      for (const file of entries) {
        const blob = await githubRequest(req, `/repos/${GITHUB_REPOSITORY}/git/blobs`, {
          method: 'POST',
          body: JSON.stringify({ content: file.content, encoding: 'utf-8' })
        });
        treeEntries.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
      }
      const tree = await githubRequest(req, `/repos/${GITHUB_REPOSITORY}/git/trees`, {
        method: 'POST',
        body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree: treeEntries })
      });
      const commit = await githubRequest(req, `/repos/${GITHUB_REPOSITORY}/git/commits`, {
        method: 'POST',
        body: JSON.stringify({ message, tree: tree.sha, parents: [ref.object.sha] })
      });
      await githubRequest(req, `/repos/${GITHUB_REPOSITORY}/git/refs/heads/${branch}`, {
        method: 'PATCH',
        body: JSON.stringify({ sha: commit.sha, force: false })
      });
      let pullRequest;
      try {
        pullRequest = await githubRequest(req, `/repos/${GITHUB_REPOSITORY}/pulls`, {
          method: 'POST',
          body: JSON.stringify({ title: message, head: branch, base: baseBranch, body: 'Created from the MineCord Developer Portal. Please review before merging.' })
        });
      } catch {
        audit({ actor: req.portalUser.id, action: 'github_branch_pushed_pr_failed', branch, commit: commit.sha });
        return res.status(502).json({ error: 'The feature branch was pushed, but the pull request could not be opened. Create it from GitHub.', branch, commit: commit.sha });
      }
      audit({ actor: req.portalUser.id, action: 'github_feature_branch_pushed', branch, commit: commit.sha, pullRequest: pullRequest.number, files: entries.map(file => file.path) });
      res.status(201).json({ branch, commit: commit.sha, pullRequest: { number: pullRequest.number, url: pullRequest.html_url } });
    } catch (error) {
      next(error);
    }
  });

  const sourceWorkspaceRoot = workspaceRoot;
  const sourceApprovals = new Set();
  const sourceRouter = createDeveloperHubRouter({
    repositoryRoot,
    workspaceRoot: sourceWorkspaceRoot,
    approvedUserIds: sourceApprovals,
    authenticate(_request, _response, continuation) { continuation(); },
    originAllowed,
    audit
  });
  api.use('/source', (req, res, next) => {
    try {
      sourceApprovals.clear();
      for (const user of readConfig().users.filter(entry => entry.approved)) sourceApprovals.add(user.id);
    } catch (error) {
      return next(error);
    }
    req.minecordUser = { id: req.portalUser.id, username: req.portalUser.username, role: req.portalUser.role };
    next();
  }, sourceRouter);

  api.use((_req, res) => res.status(404).json({ error: 'Developer portal endpoint not found.' }));
  api.use((error, _req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof PortalError) return res.status(error.status).json({ error: error.message });
    if (error.status === 400 && error.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large.' });
    console.error('[dev-portal] Request failed:', error.message);
    res.status(500).json({ error: 'Developer portal request failed.' });
  });

  router.use('/api', api);
  router.get(['/', '/login'], (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(portalFile);
  });
  router.get('*splat', (req, res) => {
    if (req.path.endsWith('.html')) return res.status(404).send('Portal page not found.');
    res.set('Cache-Control', 'no-store');
    res.sendFile(portalFile);
  });
  return router;
}

module.exports = {
  SESSION_TTL_MS,
  createDevPortalRouter,
  hashPassword,
  normalizeConfig
};
