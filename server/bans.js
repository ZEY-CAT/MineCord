const MIN_TEMP_BAN_MS = 60 * 1000;
const MAX_TEMP_BAN_MS = 365 * 24 * 60 * 60 * 1000;

function ensureBans(data) {
  data.bans ||= [];
  data.banAudit ||= [];
}

function activeBan(data, userOrId) {
  const userId = typeof userOrId === 'string' ? userOrId : userOrId?.id;
  if (!userId) return null;
  ensureBans(data);
  const now = Date.now();
  return data.bans.find(entry =>
    entry.userId === userId
    && !entry.revokedAt
    && (entry.expiresAt === null || entry.expiresAt > now)
  ) || null;
}

function publicBan(ban) {
  if (!ban) return null;
  return {
    reason: ban.reason,
    createdAt: ban.createdAt,
    expiresAt: ban.expiresAt,
    permanent: ban.expiresAt === null,
    expired: ban.expiresAt !== null && ban.expiresAt <= Date.now()
  };
}

function banMessage(ban) {
  if (!ban) return '';
  if (ban.expiresAt === null) return `This account is permanently banned. Reason: ${ban.reason}`;
  return `This account is temporarily banned until ${new Date(ban.expiresAt).toLocaleString()}. Reason: ${ban.reason}`;
}

function parseDuration(value) {
  const match = String(value || '').trim().match(/^(\d{1,4})(s|m|h|d|w)$/i);
  if (!match) throw new Error('Duration must look like 30m, 2h, 7d, or 1w.');
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier = unit === 's' ? 1000 : unit === 'm' ? 60 * 1000 : unit === 'h' ? 60 * 60 * 1000 : unit === 'd' ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
  const duration = amount * multiplier;
  if (!Number.isSafeInteger(duration) || duration < MIN_TEMP_BAN_MS) throw new Error('Temporary bans must last at least 60 seconds.');
  if (duration > MAX_TEMP_BAN_MS) throw new Error('Temporary bans cannot last longer than 365 days.');
  return duration;
}

function cleanReason(value) {
  const reason = String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (reason.length < 3) throw new Error('Give a reason of at least 3 characters.');
  return reason;
}

function parseCommand(text) {
  const command = String(text || '').trim();
  let match = command.match(/^\/apptempban\s+(\S+)\s+(\S+)\s+(.+)$/i);
  if (match) return { action: 'tempban', username: match[1], durationMs: parseDuration(match[2]), reason: cleanReason(match[3]) };
  match = command.match(/^\/appban\s+(\S+)\s+(.+)$/i);
  if (match) return { action: 'ban', username: match[1], durationMs: null, reason: cleanReason(match[2]) };
  match = command.match(/^\/appunban\s+(\S+)\s*$/i);
  if (match) return { action: 'unban', username: match[1], durationMs: null, reason: '' };
  throw new Error('Use /appban <username> <reason>, /apptempban <username> <duration> <reason>, or /appunban <username>.');
}

function findUser(data, username) {
  const normalized = String(username || '').trim().toLowerCase();
  if (!normalized) return null;
  const matches = Object.values(data.users || {}).filter(user => String(user.username || '').toLowerCase() === normalized);
  return matches.length === 1 ? matches[0] : null;
}

function authorizeAdmin(user, ownerUserId) {
  return Boolean(user && (user.id === ownerUserId || user.role === 'app_owner' || user.role === 'administrator'));
}

function applyBan(data, { target, actor, reason, durationMs, createId }) {
  ensureBans(data);
  if (!target) throw new Error('Account not found. Check the exact username.');
  if (!actor) throw new Error('Administrator account is required.');
  if (target.id === actor.id) throw new Error('You cannot ban your own account.');
  const existing = activeBan(data, target);
  if (existing) throw new Error(`That account is already banned. ${banMessage(existing)}`);
  const now = Date.now();
  const record = {
    id: createId('ban'),
    userId: target.id,
    username: target.username,
    reason: cleanReason(reason),
    createdAt: now,
    expiresAt: durationMs === null ? null : now + durationMs,
    byUserId: actor.id,
    byUsername: actor.username,
    revokedAt: null,
    revokedByUserId: null,
    revokedByUsername: null
  };
  data.bans.push(record);
  data.banAudit.push({ id: createId('banaudit'), action: durationMs === null ? 'ban' : 'tempban', ...record });
  return record;
}

function revokeBan(data, { target, actor }) {
  ensureBans(data);
  if (!target) throw new Error('Account not found. Check the exact username.');
  const active = activeBan(data, target);
  if (!active) throw new Error('That account does not have an active ban.');
  active.revokedAt = Date.now();
  active.revokedByUserId = actor.id;
  active.revokedByUsername = actor.username;
  data.banAudit.push({ id: `banaudit-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`, action: 'unban', banId: active.id, userId: target.id, username: target.username, reason: active.reason, createdAt: active.createdAt, expiresAt: active.expiresAt, byUserId: actor.id, byUsername: actor.username, revokedAt: active.revokedAt });
  return active;
}

function banRoutes(app, context) {
  const { data, save, requireAuth, originAllowed, ownerUserId, createId, database, disconnectUser } = context;
  ensureBans(data);

  function admin(req, res) {
    if (!originAllowed(req)) {
      res.status(403).json({ error: 'Request origin is not allowed.' });
      return false;
    }
    if (!authorizeAdmin(req.minecordUser, ownerUserId)) {
      res.status(403).json({ error: 'Administrator access is required.' });
      return false;
    }
    return true;
  }

  function perform(req, res, parsed) {
    const target = findUser(data, parsed.username);
    if (!target) return res.status(404).json({ error: 'Account not found. Check the exact username.' });
    if (target.id === ownerUserId) return res.status(400).json({ error: 'The configured App Owner account cannot be banned.' });
    if (target.id === req.minecordUser.id) return res.status(400).json({ error: 'You cannot ban your own account.' });
    if (parsed.action === 'unban') {
      const record = revokeBan(data, { target, actor: req.minecordUser });
      save();
      return res.json({ ok: true, action: 'unban', username: target.username, ban: publicBan(record) });
    }
    const record = applyBan(data, { target, actor: req.minecordUser, reason: parsed.reason, durationMs: parsed.durationMs, createId });
    try {
      save();
    } catch (error) {
      data.bans = data.bans.filter(entry => entry.id !== record.id);
      data.banAudit = data.banAudit.filter(entry => entry.id !== record.id);
      throw error;
    }
    database.deleteSessionsForUser(target.id);
    disconnectUser(target.username, 'Account banned.');
    return res.json({
      ok: true,
      action: record.expiresAt === null ? 'ban' : 'tempban',
      username: target.username,
      ban: publicBan(record)
    });
  }

  app.get('/api/admin/bans', requireAuth, (req, res) => {
    if (!admin(req, res)) return;
    ensureBans(data);
    const now = Date.now();
    const entries = [...data.bans].sort((a, b) => b.createdAt - a.createdAt).slice(0, 200).map(entry => ({
      id: entry.id,
      username: entry.username,
      userId: entry.userId,
      reason: entry.reason,
      createdAt: entry.createdAt,
      expiresAt: entry.expiresAt,
      permanent: entry.expiresAt === null,
      active: !entry.revokedAt && (entry.expiresAt === null || entry.expiresAt > now),
      revokedAt: entry.revokedAt || null,
      byUsername: entry.byUsername,
      revokedByUsername: entry.revokedByUsername || null
    }));
    res.json({ bans: entries, active: entries.filter(entry => entry.active) });
  });

  app.post('/api/admin/command', requireAuth, (req, res) => {
    if (!admin(req, res)) return;
    let parsed;
    try {
      parsed = parseCommand(req.body?.command);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    try {
      return perform(req, res, parsed);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/admin/bans', requireAuth, (req, res) => {
    if (!admin(req, res)) return;
    try {
      const permanent = req.body?.permanent === true || req.body?.duration === undefined || req.body?.duration === null;
      const durationMs = permanent ? null : parseDuration(req.body?.duration);
      return perform(req, res, { action: permanent ? 'ban' : 'tempban', username: req.body?.username, durationMs, reason: req.body?.reason });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.delete('/api/admin/bans/:username', requireAuth, (req, res) => {
    if (!admin(req, res)) return;
    try {
      return perform(req, res, { action: 'unban', username: req.params.username, durationMs: null, reason: '' });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });
}

module.exports = {
  MIN_TEMP_BAN_MS,
  MAX_TEMP_BAN_MS,
  ensureBans,
  activeBan,
  publicBan,
  banMessage,
  parseDuration,
  parseCommand,
  findUser,
  authorizeAdmin,
  applyBan,
  revokeBan,
  banRoutes
};
