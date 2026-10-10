const PROVIDERS = new Set(['google', 'microsoft', 'github']);
function oauthAccounts(user) {
  const accounts = Array.isArray(user.oauthAccounts) ? user.oauthAccounts : [];
  const normalized = accounts.filter(account =>
    PROVIDERS.has(account?.provider) && typeof account.id === 'string' && account.id
  );
  if (PROVIDERS.has(user.oauth?.provider) && typeof user.oauth.id === 'string' && user.oauth.id
      && !normalized.some(account => account.provider === user.oauth.provider && account.id === user.oauth.id)) {
    normalized.push({ provider: user.oauth.provider, id: user.oauth.id });
  }
  return normalized;
}

function buildAuthorizationUrl(provider, state, appUrl) {
  const prefix = provider.toUpperCase();
  const clientId = process.env[`${prefix}_CLIENT_ID`];
  const redirectUri = process.env[`${prefix}_CALLBACK_URL`] || `${appUrl}/auth/${provider}/callback`;
  const query = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', state });
  if (provider === 'google') {
    query.set('scope', 'openid email profile');
    query.set('access_type', 'offline');
    query.set('prompt', 'select_account');
    return `https://accounts.google.com/o/oauth2/v2/auth?${query}`;
  }
  if (provider === 'github') {
    query.set('scope', 'read:user user:email');
    return `https://github.com/login/oauth/authorize?${query}`;
  }
  query.set('scope', 'openid email profile User.Read');
  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${query}`;
}

function findLinkedUser(users, provider, externalId) {
  return Object.values(users).find(user =>
    oauthAccounts(user).some(account => account.provider === provider && account.id === externalId)
  );
}

function accountLinkRoutes(app, context) {
  const { data, save, authUser, requireAuth, setSession, appUrl, ownerUserId, originAllowed } = context;
  const { ASSIGNABLE_ROLES, can, ROLE_LABELS } = require('./roles');
  const ownerFor = user => Boolean(ownerUserId && user?.id === ownerUserId);
  const publicAccount = user => ({
    username: user.username,
    displayName: user.displayName,
    role: user.role || 'member',
    roleLabel: ROLE_LABELS[user.role] || ROLE_LABELS.member
  });

  app.get('/api/auth/links', requireAuth, (req, res) => {
    const user = req.minecordUser;
    const identities = oauthAccounts(user);
    res.json({
      accounts: identities.map(account => ({ provider: account.provider, linkedAt: account.linkedAt || null })),
      hasLocalPassword: Boolean(user.passwordHash && user.passwordSalt),
      providers: Object.fromEntries([...PROVIDERS].map(provider => [
        provider,
        Boolean(process.env[`${provider.toUpperCase()}_CLIENT_ID`] && process.env[`${provider.toUpperCase()}_CLIENT_SECRET`])
      ]))
    });
  });

  app.post('/api/auth/links/:provider/start', requireAuth, (req, res) => {
    if (!originAllowed(req)) return res.status(403).json({ error: 'Request origin is not allowed.' });
    const { provider } = req.params;
    if (!PROVIDERS.has(provider)) return res.status(404).json({ error: 'Unsupported account provider.' });
    const prefix = provider.toUpperCase();
    const clientId = process.env[`${prefix}_CLIENT_ID`];
    const clientSecret = process.env[`${prefix}_CLIENT_SECRET`];
    if (!clientId || !clientSecret) return res.status(503).json({ error: `${provider} linking is not configured on this MINECORD server.` });

    const state = require('node:crypto').randomBytes(24).toString('hex');
    saveOAuthState(context, state, {
      provider,
      purpose: 'account-link',
      userId: req.minecordUser.id,
      createdAt: Date.now()
    });
    context.bindBrowserToOAuthState(res, provider, state, appUrl);
    const redirectUri = process.env[`${prefix}_CALLBACK_URL`] || `${appUrl}/auth/${provider}/callback`;
    const query = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', state });
    let authorizeUrl;
    if (provider === 'google') {
      query.set('scope', 'openid email profile');
      query.set('access_type', 'offline');
      query.set('prompt', 'select_account');
      authorizeUrl = `https://accounts.google.com/o/oauth2/v2/auth?${query}`;
    } else if (provider === 'github') {
      query.set('scope', 'read:user user:email');
      authorizeUrl = `https://github.com/login/oauth/authorize?${query}`;
    } else {
      query.set('scope', 'openid email profile User.Read');
      authorizeUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${query}`;
    }
    res.json({ authorizeUrl });
  });

  app.delete('/api/auth/links/:provider', requireAuth, (req, res) => {
    if (!originAllowed(req)) return res.status(403).json({ error: 'Request origin is not allowed.' });
    const { provider } = req.params;
    if (!PROVIDERS.has(provider)) return res.status(404).json({ error: 'Unsupported account provider.' });
    const user = req.minecordUser;
    const accounts = oauthAccounts(user);
    const remaining = accounts.filter(account => account.provider !== provider);
    if (remaining.length === accounts.length) return res.status(404).json({ error: 'That provider is not linked.' });
    if (!remaining.length && !(user.passwordHash && user.passwordSalt)) {
      return res.status(400).json({ error: 'Add a local password or another sign-in provider before unlinking the last sign-in method.' });
    }
    user.oauthAccounts = remaining;
    user.oauth = remaining[0] ? { provider: remaining[0].provider, id: remaining[0].id } : null;
    save();
    res.json({ ok: true, accounts: remaining.map(account => ({ provider: account.provider, linkedAt: account.linkedAt || null })) });
  });

  app.get('/api/admin/users', requireAuth, (req, res) => {
    if (!can(req.minecordUser, 'manage_roles', ownerUserId)) return res.status(403).json({ error: 'App Owner access is required.' });
    res.json({ users: Object.values(data.users).map(publicAccount).sort((a, b) => a.username.localeCompare(b.username)) });
  });

  app.get('/api/admin/roles/audit', requireAuth, (req, res) => {
    if (!can(req.minecordUser, 'manage_roles', ownerUserId)) return res.status(403).json({ error: 'App Owner access is required.' });
    const userById = new Map(Object.values(data.users).map(user => [user.id, user.username]));
    res.json({
      entries: (data.roleAudit || []).slice(-100).reverse().map(entry => ({
        account: userById.get(entry.accountId) || 'Merged account',
        actor: userById.get(entry.actorId) || 'Former account',
        previousRole: ROLE_LABELS[entry.previousRole] || entry.previousRole,
        newRole: ROLE_LABELS[entry.newRole] || entry.newRole,
        createdAt: entry.createdAt
      }))
    });
  });

  app.post('/api/admin/users/:username/role', requireAuth, (req, res) => {
    if (!originAllowed(req)) return res.status(403).json({ error: 'Request origin is not allowed.' });
    if (!can(req.minecordUser, 'manage_roles', ownerUserId)) return res.status(403).json({ error: 'App Owner access is required.' });
    const role = req.body?.role;
    if (!ASSIGNABLE_ROLES.has(role)) return res.status(400).json({ error: 'That account role cannot be assigned through this endpoint.' });
    const username = req.params.username.toLowerCase();
    const user = Object.values(data.users).find(candidate => candidate.username.toLowerCase() === username);
    if (!user) return res.status(404).json({ error: 'MINECORD account not found.' });
    if (ownerFor(user)) return res.status(400).json({ error: 'The configured App Owner role cannot be changed here.' });
    const previousRole = user.role || 'member';
    if (previousRole === role) return res.json({ user: publicAccount(user), changed: false });
    user.role = role;
    if (role === 'member') user.onboardingCompletedAt ||= Date.now();
    data.roleAudit ||= [];
    data.roleAudit.push({
      id: context.createId('role'),
      accountId: user.id,
      actorId: req.minecordUser.id,
      previousRole,
      newRole: role,
      createdAt: Date.now()
    });
    save();
    res.json({ user: publicAccount(user), changed: true });
  });

  app.use('/auth/:provider/callback', oauthCallback(context));
}

function saveOAuthState(context, key, value) {
  context.database.createOAuthState(key, value, value.createdAt + 10 * 60 * 1000);
}

function oauthCallback(context) {
  const { data, save, authUser, setSession, database, hasBrowserOAuthState, clearBrowserOAuthState, appUrl } = context;
  return async (req, res, next) => {
    const provider = req.params.provider;
    if (!PROVIDERS.has(provider)) return next();
    const stateKey = typeof req.query.state === 'string' ? req.query.state : '';
    const pendingState = database.getOAuthState(stateKey);
    if (pendingState?.purpose !== 'account-link') return next();
    if (!hasBrowserOAuthState(req, provider, stateKey)) {
      clearBrowserOAuthState(res, provider, appUrl);
      return res.status(400).send('OAuth state is invalid or expired. Please restart sign-in.');
    }
    const state = database.consumeOAuthState(stateKey, provider);
    if (!state || state.purpose !== 'account-link') {
      return res.status(400).send('OAuth state is invalid or expired. Please try again.');
    }
    clearBrowserOAuthState(res, provider, appUrl);

    if (req.query.error) {
      return res.redirect(state.purpose === 'account-link'
        ? '/?account_link_error=cancelled'
        : `/?auth_error=${encodeURIComponent('Sign-in was not completed.')}`);
    }
    if (typeof req.query.code !== 'string' || !req.query.code) {
      return res.status(400).send('The identity provider did not return an authorization code.');
    }
    if (state.purpose === 'account-link') {
      const user = authUser(req);
      if (!user || user.id !== state.userId) return res.status(401).send('Sign in to the same MINECORD account before linking this provider.');
    } else if (state.purpose) {
      return res.status(400).send('Unsupported OAuth operation.');
    }

    try {
      const identity = await fetchIdentity(provider, req.query.code, context.appUrl);
      if (state.purpose === 'account-link') {
        const user = authUser(req);
        const linkedTo = findLinkedUser(data.users, provider, identity.id);
        if (linkedTo && linkedTo.id !== user.id) return res.redirect('/?account_link_error=already_linked');
        const accounts = oauthAccounts(user);
        const sameProvider = accounts.find(account => account.provider === provider);
        if (sameProvider && sameProvider.id !== identity.id) return res.redirect('/?account_link_error=provider_already_linked');
        if (!sameProvider) accounts.push({ provider, id: identity.id, linkedAt: Date.now() });
        user.oauthAccounts = accounts;
        if (!user.oauth) user.oauth = { provider, id: identity.id };
        save();
        return res.redirect('/?account_link=success');
      }

      let user = findLinkedUser(data.users, provider, identity.id);
      if (!user) {
        const base = identity.name.replace(/[^A-Za-z0-9_ -]/g, '').slice(0, 24).trim() || 'Player';
        let username = base, suffix = 2;
        while (Object.keys(data.users).some(existing => existing.toLowerCase() === username.toLowerCase())) {
          username = `${base.slice(0, Math.max(1, 24 - String(suffix).length - 1))}_${suffix++}`;
        }
        user = {
          id: context.createId('usr'),
          username,
          displayName: base,
          avatar: identity.avatar,
          oauth: { provider, id: identity.id },
          oauthAccounts: [{ provider, id: identity.id, linkedAt: Date.now() }],
          role: 'new_member',
          onboardingCompletedAt: null,
          minecraft: null,
          createdAt: Date.now()
        };
        data.users[username] = user;
        save();
      }
      setSession(res, user);
      return res.redirect('/?oauth=success');
    } catch {
      return res.redirect(state.purpose === 'account-link'
        ? '/?account_link_error=provider_failed'
        : `/?auth_error=${encodeURIComponent('OAuth sign-in failed. Check the provider app registration and callback URL.')}`);
    }
  };
}

async function fetchIdentity(provider, code, appUrl) {
  const prefix = provider.toUpperCase();
  const clientId = process.env[`${prefix}_CLIENT_ID`];
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`];
  const redirectUri = process.env[`${prefix}_CALLBACK_URL`] || `${appUrl}/auth/${provider}/callback`;
  const fetchJson = async (url, options) => {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
    let body;
    try { body = await response.json(); } catch { throw new Error('Identity provider returned invalid data.'); }
    if (!response.ok) throw new Error('Identity provider rejected the OAuth request.');
    return body;
  };

  if (provider === 'github') {
    const token = await fetchJson('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri })
    });
    if (typeof token.access_token !== 'string') throw new Error('GitHub token exchange failed.');
    const profile = await fetchJson('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/vnd.github+json' }
    });
    if (profile.id == null) throw new Error('GitHub account ID is missing.');
    return { id: String(profile.id), name: profile.name || profile.login || 'GitHub Player', avatar: profile.avatar_url || '' };
  }

  const google = provider === 'google';
  const token = await fetchJson(google ? 'https://oauth2.googleapis.com/token' : 'https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri, grant_type: 'authorization_code' })
  });
  if (typeof token.access_token !== 'string') throw new Error('OAuth token is missing.');
  const profile = await fetchJson(google ? 'https://openidconnect.googleapis.com/v1/userinfo' : 'https://graph.microsoft.com/v1.0/me', {
    headers: { Authorization: `Bearer ${token.access_token}` }
  });
  const externalId = profile.sub || profile.id;
  if (typeof externalId !== 'string' || !externalId) throw new Error('Provider account ID is missing.');
  return {
    id: externalId,
    name: profile.name || profile.displayName || profile.email || 'Player',
    avatar: profile.picture || ''
  };
}

module.exports = { accountLinkRoutes, oauthAccounts, findLinkedUser, buildAuthorizationUrl, fetchIdentity };
