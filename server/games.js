const crypto = require('crypto');
const https = require('https');

function validateEaglercraftUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return { valid: false, error: 'Eaglercraft links must use HTTPS.' };
    if (parsed.username || parsed.password) return { valid: false, error: 'Links with embedded credentials are not allowed.' };
    return { valid: true, hostname: parsed.hostname };
  } catch {
    return { valid: false, error: 'Invalid URL format.' };
  }
}

async function checkEaglercraftUrl(url, timeoutMs = 5000) {
  const { valid, error: validateError, hostname } = validateEaglercraftUrl(url);
  if (!valid) return { reachable: false, error: validateError };

  return new Promise((resolve) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      resolve({ reachable: res.statusCode < 400, statusCode: res.statusCode, hostname });
    });
    req.on('error', (err) => {
      resolve({ reachable: false, error: err.message });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ reachable: false, error: 'Connection timed out.' });
    });
    req.setTimeout(timeoutMs);
  });
}

function gamesRoutes(app, { data, save, requireAuth, createId, database }) {
  const EDITIONS = ['java', 'bedrock', 'eaglercraft'];

  function validateEdition(edition) {
    return EDITIONS.includes(edition);
  }

  function cleanServerEntry(entry, edition) {
    const name = String(entry?.name || '').trim().slice(0, 64);
    const address = String(entry?.address || '').trim().slice(0, 255);
    const port = entry?.port ? Number(entry.port) : null;
    const notes = String(entry?.notes || '').trim().slice(0, 500);
    const favorite = entry?.favorite === true || entry?.favorite === 1 || entry?.favorite === '1';

    if (!name || !address) return { valid: false, error: 'Name and address are required.' };

    if (edition === 'eaglercraft') {
      const { valid, error } = validateEaglercraftUrl(address);
      if (!valid) return { valid: false, error };
    } else {
      const hostPort = address.split(':');
      const host = hostPort[0];
      if (!/^[a-zA-Z0-9.-]+$/.test(host)) {
        return { valid: false, error: 'Invalid server address format.' };
      }
      if (port !== null && (port < 1 || port > 65535 || !Number.isInteger(port))) {
        return { valid: false, error: 'Port must be between 1 and 65535.' };
      }
    }

    return { valid: true, name, address, port, notes, favorite };
  }

  // Get all game servers for the current user (owned only)
  app.get('/api/games/servers', requireAuth, (req, res) => {
    const edition = req.query.edition;

    if (edition && !validateEdition(edition)) {
      return res.status(400).json({ error: 'Invalid edition.' });
    }

    let servers = data.gameServers || [];
    servers = servers.filter(s => s.owner === req.minecordUser.username);
    if (edition) servers = servers.filter(s => s.edition === edition);

    res.json({ servers: servers.map(s => ({
      id: s.id,
      edition: s.edition,
      name: s.name,
      address: s.address,
      port: s.port,
      notes: s.notes,
      favorite: Boolean(s.favorite),
      createdAt: s.createdAt,
      updatedAt: s.updatedAt
    })) });
  });

  // Discover worlds: user's own servers + friends' shared servers
  app.get('/api/games/worlds/discover', requireAuth, (req, res) => {
    const edition = req.query.edition;
    const username = req.minecordUser.username;

    if (edition && !validateEdition(edition)) {
      return res.status(400).json({ error: 'Invalid edition.' });
    }

    const servers = data.gameServers || [];
    const friends = Object.values(data.friends || {}).filter(f =>
      f.status === 'accepted' &&
      (f.a === username || f.b === username)
    ).map(f => f.a === username ? f.b : f.a);

    // User's own servers (all visibilities)
    let visible = servers.filter(s => s.owner === username);

    // Friends' shared servers (shared with current user)
    const sharedWithMe = servers.filter(s =>
      s.sharedFrom && s.sharedBy &&
      friends.includes(s.owner) &&
      s.sharedBy === s.owner // the owner of the shared copy is the recipient
    );

    // Also include servers shared by friends where the current user is the sharedBy target
    // Actually, the shared copy has owner=recipient, sharedBy=sharer
    // So we need to find servers where the current user owns a shared copy
    const sharedCopies = servers.filter(s =>
      s.owner === username && s.sharedFrom && s.sharedBy
    );

    // Combine: owned + shared copies + friends' original servers that were shared with this user
    let discoverable = [...visible, ...sharedCopies];

    // Add friends' original servers that were shared with this user
    // These are servers where sharedBy is the friend and sharedFrom points to friend's original
    friends.forEach(friend => {
      const friendsShared = servers.filter(s =>
        s.owner === friend && s.sharedFrom && s.sharedBy === username
      );
      discoverable.push(...friendsShared);
    });

    // Deduplicate by ID
    const seen = new Set();
    discoverable = discoverable.filter(s => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });

    if (edition) discoverable = discoverable.filter(s => s.edition === edition);

    // Add join info to each
    const withJoinInfo = discoverable.map(s => {
      const base = {
        id: s.id,
        edition: s.edition,
        name: s.name,
        address: s.address,
        port: s.port,
        notes: s.notes,
        favorite: Boolean(s.favorite),
        owner: s.owner,
        sharedFrom: s.sharedFrom || null,
        sharedBy: s.sharedBy || null,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt
      };

      // Add join info based on edition
      if (s.edition === 'eaglercraft') {
        base.joinInfo = {
          edition: s.edition,
          address: s.address,
          openUrl: s.address,
          instructions: 'This will open the Eaglercraft server in your browser.'
        };
      } else if (s.edition === 'java') {
        const connectString = s.port ? `${s.address}:${s.port}` : s.address;
        base.joinInfo = {
          edition: s.edition,
          address: s.address,
          port: s.port,
          connectString,
          instructions: 'Copy this address and use "Direct Connect" in Minecraft Java Edition multiplayer menu.'
        };
      } else if (s.edition === 'bedrock') {
        const connectString = s.port ? `${s.address}:${s.port}` : s.address;
        base.joinInfo = {
          edition: s.edition,
          address: s.address,
          port: s.port,
          connectString,
          instructions: 'Use this address and port in the Bedrock Edition "Add Server" screen. Works on Nintendo Switch by entering the address and port separately.'
        };
      }

      return base;
    });

    res.json({ worlds: withJoinInfo });
  });

  // Create a new game server entry
  app.post('/api/games/servers', requireAuth, (req, res) => {
    if (!originAllowed(req)) return res.status(403).json({ error: 'Request origin is not allowed.' });

    const edition = req.body?.edition;
    if (!validateEdition(edition)) {
      return res.status(400).json({ error: 'Invalid or missing edition. Must be java, bedrock, or eaglercraft.' });
    }

    const validation = cleanServerEntry(req.body, edition);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    const server = {
      id: id('gs'),
      edition,
      name: validation.name,
      address: validation.address,
      port: validation.port,
      notes: validation.notes,
      favorite: validation.favorite,
      owner: req.minecordUser.username,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    data.gameServers = data.gameServers || [];
    data.gameServers.push(server);
    save();

    res.status(201).json({ server });
  });

  // Update a game server entry
  app.patch('/api/games/servers/:serverId', requireAuth, (req, res) => {
    if (!originAllowed(req)) return res.status(403).json({ error: 'Request origin is not allowed.' });

    const serverId = req.params.serverId;
    const server = (data.gameServers || []).find(s => s.id === serverId && s.owner === req.minecordUser.username);
    if (!server) return res.status(404).json({ error: 'Server not found.' });

    const edition = server.edition;
    const validation = cleanServerEntry(req.body, edition);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    server.name = validation.name;
    server.address = validation.address;
    server.port = validation.port;
    server.notes = validation.notes;
    server.favorite = validation.favorite;
    server.updatedAt = Date.now();

    save();
    res.json({ server });
  });

  // Toggle favorite status
  app.post('/api/games/servers/:serverId/favorite', requireAuth, (req, res) => {
    if (!originAllowed(req)) return res.status(403).json({ error: 'Request origin is not allowed.' });

    const serverId = req.params.serverId;
    const server = (data.gameServers || []).find(s => s.id === serverId && s.owner === req.minecordUser.username);
    if (!server) return res.status(404).json({ error: 'Server not found.' });

    server.favorite = !server.favorite;
    server.updatedAt = Date.now();
    save();

    res.json({ server });
  });

  // Delete a game server entry
  app.delete('/api/games/servers/:serverId', requireAuth, (req, res) => {
    if (!originAllowed(req)) return res.status(403).json({ error: 'Request origin is not allowed.' });

    const serverId = req.params.serverId;
    const index = (data.gameServers || []).findIndex(s => s.id === serverId && s.owner === req.minecordUser.username);
    if (index === -1) return res.status(404).json({ error: 'Server not found.' });

    data.gameServers.splice(index, 1);
    save();
    res.json({ ok: true });
  });

  // Share a server with a friend
  app.post('/api/games/servers/:serverId/share', requireAuth, (req, res) => {
    if (!originAllowed(req)) return res.status(403).json({ error: 'Request origin is not allowed.' });

    const serverId = req.params.serverId;
    const server = (data.gameServers || []).find(s => s.id === serverId && s.owner === req.minecordUser.username);
    if (!server) return res.status(404).json({ error: 'Server not found.' });

    const targetUsername = clean(req.body?.username, 32);
    if (!targetUsername) return res.status(400).json({ error: 'Username is required.' });

    const targetUser = Object.values(data.users).find(u => u.username.toLowerCase() === targetUsername.toLowerCase());
    if (!targetUser) return res.status(404).json({ error: 'User not found.' });
    if (targetUser.username === req.minecordUser.username) return res.status(400).json({ error: 'You cannot share with yourself.' });

    // Check if they are friends
    const friendship = data.friends[pair(req.minecordUser.username, targetUsername)];
    if (!friendship || friendship.status !== 'accepted') {
      return res.status(403).json({ error: 'You can only share servers with accepted friends.' });
    }

    // Create a copy for the friend
    const newServer = {
      id: id('gs'),
      edition: server.edition,
      name: server.name,
      address: server.address,
      port: server.port,
      notes: server.notes,
      favorite: false,
      owner: targetUser.username,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sharedFrom: server.id,
      sharedBy: req.minecordUser.username
    };

    data.gameServers = data.gameServers || [];
    data.gameServers.push(newServer);
    save();

    res.json({ server: newServer });
  });

  // Get user's game accounts
  app.get('/api/games/accounts', requireAuth, (req, res) => {
    const userId = req.minecordUser.id;
    const accounts = (data.gameAccounts || []).filter(a => a.owner === req.minecordUser.username);
    res.json({ accounts: accounts.map(a => ({
      edition: a.edition,
      username: a.username,
      uuid: a.uuid,
      xuid: a.xuid,
      linkedAt: a.linkedAt
    })) });
  });

  // Link Minecraft Java account (via existing Microsoft OAuth flow)
  app.post('/api/games/accounts/java', requireAuth, (req, res) => {
    const username = clean(req.body?.username, 32);
    const uuid = clean(req.body?.uuid, 80);
    if (!username || !/^[A-Za-z0-9_]{1,16}$/.test(username)) {
      return res.status(400).json({ error: 'Valid Minecraft username is required.' });
    }
    if (uuid && !/^[a-f0-9]{32}$/i.test(uuid)) {
      return res.status(400).json({ error: 'Invalid UUID format.' });
    }

    const existing = (data.gameAccounts || []).find(a => a.owner === req.minecordUser.username && a.edition === 'java');
    if (existing) {
      existing.username = username;
      existing.uuid = uuid || null;
      existing.linkedAt = Date.now();
      existing.rawData = JSON.stringify({ manuallyLinked: true });
    } else {
      (data.gameAccounts || []).push({
        owner: req.minecordUser.username,
        edition: 'java',
        username,
        uuid: uuid || null,
        linkedAt: Date.now(),
        rawData: JSON.stringify({ manuallyLinked: true })
      });
    }
    save();
    res.json({ account: { edition: 'java', username, uuid, linkedAt: Date.now() } });
  });

  // Link Minecraft Bedrock account
  app.post('/api/games/accounts/bedrock', requireAuth, (req, res) => {
    const username = clean(req.body?.username, 32);
    const xuid = clean(req.body?.xuid, 80);
    if (!username || !/^[A-Za-z0-9_]{1,16}$/.test(username)) {
      return res.status(400).json({ error: 'Valid Bedrock username (Xbox Gamertag) is required.' });
    }
    if (xuid && !/^[0-9]{16}$/.test(xuid)) {
      return res.status(400).json({ error: 'XUID must be a 16-digit number.' });
    }

    // Ensure gameAccounts array exists
    if (!Array.isArray(data.gameAccounts)) data.gameAccounts = [];

    const existing = data.gameAccounts.find(a => a.owner === req.minecordUser.username && a.edition === 'bedrock');
    if (existing) {
      existing.username = username;
      existing.xuid = xuid || null;
      existing.linkedAt = Date.now();
      existing.rawData = JSON.stringify({ manuallyLinked: true });
    } else {
      data.gameAccounts.push({
        owner: req.minecordUser.username,
        edition: 'bedrock',
        username,
        xuid: xuid || null,
        linkedAt: Date.now(),
        rawData: JSON.stringify({ manuallyLinked: true })
      });
    }
    save();
    res.json({ account: { edition: 'bedrock', username, xuid: xuid || null, linkedAt: Date.now() } });
  });

  // Link Eaglercraft URL
  app.post('/api/games/accounts/eaglercraft', requireAuth, async (req, res) => {
    const url = clean(req.body?.url, 255);
    if (!url) return res.status(400).json({ error: 'Eaglercraft URL is required.' });

    const { valid, error } = validateEaglercraftUrl(url);
    if (!valid) return res.status(400).json({ error });

    const { reachable, error: reachError } = await checkEaglercraftUrl(url);
    if (!reachable) {
      return res.status(400).json({ error: `Could not verify Eaglercraft URL: ${reachError || 'Connection failed.'}` });
    }

    const existing = (data.gameAccounts || []).find(a => a.owner === req.minecordUser.username && a.edition === 'eaglercraft');
    if (existing) {
      existing.username = url;
      existing.linkedAt = Date.now();
      existing.rawData = JSON.stringify({ url, manuallyLinked: true });
    } else {
      (data.gameAccounts || []).push({
        owner: req.minecordUser.username,
        edition: 'eaglercraft',
        username: url,
        linkedAt: Date.now(),
        rawData: JSON.stringify({ url, manuallyLinked: true })
      });
    }
    save();
    res.json({ account: { edition: 'eaglercraft', username: url, linkedAt: Date.now() } });
  });

  // Remove a game account
  app.delete('/api/games/accounts/:edition', requireAuth, (req, res) => {
    const edition = req.params.edition;
    if (!validateEdition(edition)) return res.status(400).json({ error: 'Invalid edition.' });

    const index = (data.gameAccounts || []).findIndex(a => a.owner === req.minecordUser.username && a.edition === edition);
    if (index === -1) return res.status(404).json({ error: 'Account not found.' });

    data.gameAccounts.splice(index, 1);
    save();
    res.json({ ok: true });
  });

  // Eaglercraft links management
  app.get('/api/games/eaglercraft/links', requireAuth, (req, res) => {
    const links = (data.eaglercraftLinks || []).filter(l => l.owner === req.minecordUser.username);
    res.json({ links: links.map(l => ({
      url: l.url,
      validated: Boolean(l.validated),
      lastChecked: l.lastChecked,
      createdAt: l.createdAt
    })) });
  });

  app.post('/api/games/eaglercraft/links', requireAuth, async (req, res) => {
    if (!originAllowed(req)) return res.status(403).json({ error: 'Request origin is not allowed.' });

    const url = clean(req.body?.url, 255);
    if (!url) return res.status(400).json({ error: 'URL is required.' });

    const { valid, error: validateError } = validateEaglercraftUrl(url);
    if (!valid) return res.status(400).json({ error: validateError });

    const { reachable, error: checkError } = await checkEaglercraftUrl(url);
    if (!reachable) {
      return res.status(400).json({ error: `Could not verify Eaglercraft URL: ${checkError || 'Connection failed.'}` });
    }

    const existing = (data.eaglercraftLinks || []).find(l => l.owner === req.minecordUser.username && l.url === url);
    if (existing) {
      existing.validated = 1;
      existing.lastChecked = Date.now();
    } else {
      (data.eaglercraftLinks || []).push({
        owner: req.minecordUser.username,
        url,
        validated: 1,
        lastChecked: Date.now(),
        createdAt: Date.now()
      });
    }
    save();
    res.json({ link: { url, validated: true, lastChecked: Date.now(), createdAt: Date.now() } });
  });

  app.delete('/api/games/eaglercraft/links', requireAuth, (req, res) => {
    if (!originAllowed(req)) return res.status(403).json({ error: 'Request origin is not allowed.' });

    const url = clean(req.body?.url, 255);
    if (!url) return res.status(400).json({ error: 'URL is required.' });

    const index = (data.eaglercraftLinks || []).findIndex(l => l.owner === req.minecordUser.username && l.url === url);
    if (index === -1) return res.status(404).json({ error: 'Link not found.' });

    data.eaglercraftLinks.splice(index, 1);
    save();
    res.json({ ok: true });
  });

  // Get join info for a server (for the join/open buttons)
  app.get('/api/games/servers/:serverId/join', requireAuth, (req, res) => {
    const serverId = req.params.serverId;
    const username = req.minecordUser.username;
    const servers = data.gameServers || [];

    // Find server where user is owner OR has a shared copy
    const server = servers.find(s =>
      s.id === serverId &&
      (s.owner === username ||
        (s.sharedFrom && s.owner === username && s.sharedBy) || // shared copy owned by user
        (s.owner !== username && s.sharedFrom && s.sharedBy === username) // friend's original shared with user
      )
    );

    if (!server) return res.status(404).json({ error: 'Server not found.' });

    let joinInfo = { edition: server.edition, address: server.address, port: server.port };

    if (server.edition === 'eaglercraft') {
      joinInfo.openUrl = server.address;
      joinInfo.instructions = 'This will open the Eaglercraft server in your browser.';
    } else if (server.edition === 'java') {
      const hostPort = server.address.split(':');
      joinInfo.connectString = server.port ? `${hostPort[0]}:${server.port}` : hostPort[0];
      joinInfo.instructions = 'Copy this address and use "Direct Connect" in Minecraft Java Edition multiplayer menu.';
    } else if (server.edition === 'bedrock') {
      const hostPort = server.address.split(':');
      joinInfo.connectString = server.port ? `${hostPort[0]}:${server.port}` : hostPort[0];
      joinInfo.instructions = 'Use this address and port in the Bedrock Edition "Add Server" screen. Works on Nintendo Switch by entering the address and port separately.';
    }

    res.json({ server, joinInfo });
  });
}

module.exports = { gamesRoutes };

function originAllowed(req) {
  const APP_URL = process.env.APP_URL || 'http://localhost:3000';
  return !req.headers.origin || req.headers.origin === new URL(APP_URL).origin;
}

function id(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
}

function clean(x, n = 100) {
  return String(x ?? '').trim().slice(0, n);
}

function pair(a, b) {
  return [a, b].sort().join('::');
}