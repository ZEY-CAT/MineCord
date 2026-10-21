const GAME_TYPES = {
  CHESS: 'chess',
  SNAKE: 'snake',
  FLAPPY: 'flappy',
  PAINTBALL: 'paintball'
};

const GAME_STATES = {
  WAITING: 'waiting',
  PLAYING: 'playing',
  FINISHED: 'finished'
};

const gameSessions = new Map();

function generateGameId() {
  return 'game-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function createGameSession(gameType, creator, opponent) {
  const id = generateGameId();
  const session = {
    id,
    gameType,
    players: [
      { username: creator, color: 'white', ready: true },
      { username: opponent, color: 'black', ready: false }
    ],
    state: GAME_STATES.WAITING,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    gameData: {}
  };
  gameSessions.set(id, session);
  return session;
}

function getGameSession(id) {
  return gameSessions.get(id);
}

function getGameSessionsForUser(username) {
  const sessions = [];
  for (const session of gameSessions.values()) {
    if (session.players.some(p => p.username === username)) {
      sessions.push(session);
    }
  }
  return sessions;
}

function deleteGameSession(id) {
  gameSessions.delete(id);
}

function cleanupOldSessions() {
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000;
  for (const [id, session] of gameSessions.entries()) {
    if (now - session.updatedAt > maxAge) {
      gameSessions.delete(id);
    }
  }
}

setInterval(cleanupOldSessions, 60 * 60 * 1000).unref();

function handleGameInvite(msg, context, username, send, toUser) {
  const { gameType, opponent } = msg;
  const { data, users, clients, isAcceptedFriend, clean } = context;
  if (!gameType || !opponent) {
    send({ type: 'error', message: 'Game type and opponent are required.' });
    return;
  }
  if (!data.users[opponent]) {
    send({ type: 'error', message: 'User not found.' });
    return;
  }
  if (opponent === username) {
    send({ type: 'error', message: 'You cannot invite yourself.' });
    return;
  }
  if (!isAcceptedFriend(username, opponent)) {
    send({ type: 'error', message: 'You can only invite accepted friends.' });
    return;
  }
  const opponentOnline = [...clients.values()].includes(opponent);
  if (!opponentOnline) {
    send({ type: 'error', message: 'That user is not online.' });
    return;
  }

  const session = createGameSession(gameType, username, opponent);
  const inviteId = 'invite-' + Date.now().toString(36);

  session.inviteId = inviteId;
  session.inviteExpires = Date.now() + 60000;

  toUser(opponent, {
    type: 'game_invite',
    inviteId,
    gameId: session.id,
    gameType,
    from: username
  });

  send({ type: 'game_invite_sent', inviteId, gameId: session.id, opponent });
}

function handleGameAccept(msg, context, username, send, toUser) {
  const { inviteId } = msg;
  const { data, users, clients, clean } = context;
  let session = null;
  for (const s of gameSessions.values()) {
    if (s.inviteId === inviteId) {
      session = s;
      break;
    }
  }
  if (!session) {
    send({ type: 'error', message: 'Invite not found or expired.' });
    return;
  }
  if (session.inviteExpires < Date.now()) {
    deleteGameSession(session.id);
    send({ type: 'error', message: 'Invite expired.' });
    return;
  }
  const player = session.players.find(p => p.username === username);
  if (!player) {
    send({ type: 'error', message: 'You are not invited to this game.' });
    return;
  }
  player.ready = true;
  session.updatedAt = Date.now();

  const allReady = session.players.every(p => p.ready);
  if (allReady) {
    session.state = GAME_STATES.PLAYING;
    initializeGameData(session);
  }

  for (const p of session.players) {
    toUser(p.username, {
      type: 'game_state',
      gameId: session.id,
      gameType: session.gameType,
      state: session.state,
      gameData: session.gameData,
      players: session.players,
      yourColor: p.color
    });
  }
}

function handleGameDecline(msg, context, username, send, toUser) {
  const { inviteId } = msg;
  const { data, users, clients, clean } = context;
  let session = null;
  for (const s of gameSessions.values()) {
    if (s.inviteId === inviteId) {
      session = s;
      break;
    }
  }
  if (!session) {
    send({ type: 'error', message: 'Invite not found.' });
    return;
  }
  for (const p of session.players) {
    toUser(p.username, { type: 'game_invite_declined', inviteId, by: username });
  }
  deleteGameSession(session.id);
}

function handleGameAction(msg, context, username, send, toUser) {
  const { gameId, action } = msg;
  const { data, users, clients, clean } = context;
  const session = gameSessions.get(gameId);
  if (!session) {
    send({ type: 'error', message: 'Game not found.' });
    return;
  }
  if (session.state !== GAME_STATES.PLAYING) {
    send({ type: 'error', message: 'Game is not in progress.' });
    return;
  }
  const player = session.players.find(p => p.username === username);
  if (!player) {
    send({ type: 'error', message: 'You are not a player in this game.' });
    return;
  }

  const result = processGameAction(session, player, action);
  if (result.error) {
    send({ type: 'error', message: result.error });
    return;
  }

  session.updatedAt = Date.now();

  if (result.finished) {
    session.state = GAME_STATES.FINISHED;
    session.winner = result.winner;
    session.finishedAt = Date.now();
  }

  for (const p of session.players) {
    toUser(p.username, {
      type: 'game_state',
      gameId: session.id,
      gameType: session.gameType,
      state: session.state,
      gameData: session.gameData,
      players: session.players,
      yourColor: p.color,
      lastAction: { by: username, action, result }
    });
  }
}

function handleGameLeave(msg, context, username, send, toUser) {
  const { gameId } = msg;
  const { data, users, clients, clean } = context;
  const session = gameSessions.get(gameId);
  if (!session) return;
  const player = session.players.find(p => p.username === username);
  if (!player) return;

  for (const p of session.players) {
    if (p.username !== username) {
      toUser(p.username, { type: 'game_left', gameId, by: username });
    }
  }
  deleteGameSession(gameId);
}

function initializeGameData(session) {
  switch (session.gameType) {
    case GAME_TYPES.CHESS:
      session.gameData = {
        board: [
          ['br','bn','bb','bq','bk','bb','bn','br'],
          ['bp','bp','bp','bp','bp','bp','bp','bp'],
          [null,null,null,null,null,null,null,null],
          [null,null,null,null,null,null,null,null],
          [null,null,null,null,null,null,null,null],
          [null,null,null,null,null,null,null,null],
          ['wp','wp','wp','wp','wp','wp','wp','wp'],
          ['wr','wn','wb','wq','wk','wb','wn','wr']
        ],
        currentTurn: 'w',
        moveHistory: [],
        whiteTime: 600,
        blackTime: 600,
        lastMoveTime: Date.now(),
        timersRunning: true,
        selectedSquare: null,
        boardFlipped: false
      };
      break;
    case GAME_TYPES.SNAKE:
      session.gameData = {
        snakes: {
          [session.players[0].username]: { body: [{x:5,y:5}], direction: 'right', nextDirection: 'right', color: '#4ade80', score: 0, alive: true },
          [session.players[1].username]: { body: [{x:25,y:25}], direction: 'left', nextDirection: 'left', color: '#f87171', score: 0, alive: true }
        },
        food: { x: 15, y: 15 },
        gridSize: 30,
        cellSize: 16,
        gameLoop: null
      };
      break;
    case GAME_TYPES.FLAPPY:
      session.gameData = {
        birds: {
          [session.players[0].username]: { x: 80, y: 300, velocity: 0, score: 0, alive: true },
          [session.players[1].username]: { x: 80, y: 350, velocity: 0, score: 0, alive: true }
        },
        pipes: [],
        frameCount: 0,
        gravity: 0.5,
        jumpForce: -8,
        pipeGap: 150,
        pipeWidth: 60,
        pipeSpeed: 3,
        pipeSpawnInterval: 120
      };
      break;
    case GAME_TYPES.PAINTBALL:
      session.gameData = {
        players: {
          [session.players[0].username]: { x: 100, y: 100, angle: 0, hp: 100, ammo: 10, color: '#4ade80', score: 0, alive: true, lastShot: 0 },
          [session.players[1].username]: { x: 700, y: 500, angle: Math.PI, hp: 100, ammo: 10, color: '#f87171', score: 0, alive: true, lastShot: 0 }
        },
        projectiles: [],
        obstacles: generatePaintballObstacles(),
        mapWidth: 800,
        mapHeight: 600,
        respawnTimer: null
      };
      break;
  }
}

function generatePaintballObstacles() {
  const obstacles = [];
  for (let i = 0; i < 15; i++) {
    obstacles.push({
      x: Math.random() * 700 + 50,
      y: Math.random() * 500 + 50,
      width: Math.random() * 80 + 40,
      height: Math.random() * 80 + 40
    });
  }
  return obstacles;
}

function processGameAction(session, player, action) {
  switch (session.gameType) {
    case GAME_TYPES.CHESS:
      return processChessAction(session, player, action);
    case GAME_TYPES.SNAKE:
      return processSnakeAction(session, player, action);
    case GAME_TYPES.FLAPPY:
      return processFlappyAction(session, player, action);
    case GAME_TYPES.PAINTBALL:
      return processPaintballAction(session, player, action);
  }
  return { error: 'Unknown game type' };
}

function processChessAction(session, player, action) {
  const { type, from, to, promotion } = action;
  const gameData = session.gameData;

  if (type === 'move') {
    const piece = gameData.board[from.row][from.col];
    if (!piece) return { error: 'No piece at source square.' };
    const pieceColor = piece[0];
    const expectedColor = player.color === 'white' ? 'w' : 'b';
    if (pieceColor !== expectedColor) return { error: 'Not your piece.' };
    if (gameData.currentTurn !== expectedColor) return { error: 'Not your turn.' };

    const valid = isValidChessMove(gameData.board, from, to, piece);
    if (!valid) return { error: 'Invalid move.' };

    const captured = gameData.board[to.row][to.col];
    gameData.board[to.row][to.col] = piece;
    gameData.board[from.row][from.col] = null;

    if (type === 'promotion' && promotion) {
      gameData.board[to.row][to.col] = pieceColor + promotion;
    }

    gameData.moveHistory.push({ from, to, piece, captured, promotion });
    gameData.currentTurn = expectedColor === 'w' ? 'b' : 'w';
    gameData.lastMoveTime = Date.now();

    const winner = checkChessGameEnd(gameData);
    if (winner) return { finished: true, winner };

    return { success: true };
  }
  return { error: 'Unknown action type' };
}

function isValidChessMove(board, from, to, piece) {
  const target = board[to.row][to.col];
  const color = piece[0];
  const type = piece[1];
  const dr = to.row - from.row;
  const dc = to.col - from.col;
  const absDr = Math.abs(dr);
  const absDc = Math.abs(dc);

  if (target && target[0] === color) return false;

  if (type === 'p') {
    const dir = color === 'w' ? -1 : 1;
    const startRow = color === 'w' ? 6 : 1;
    if (dc === 0) {
      if (dr === dir && !target) return true;
      if (from.row === startRow && dr === 2 * dir && !board[from.row + dir][from.col] && !target) return true;
    }
    if (absDc === 1 && dr === dir && target && target[0] !== color) return true;
    return false;
  }
  if (type === 'r') {
    if (dr === 0 || dc === 0) return isPathClear(board, from, to);
    return false;
  }
  if (type === 'n') {
    return (absDr === 2 && absDc === 1) || (absDr === 1 && absDc === 2);
  }
  if (type === 'b') {
    if (absDr === absDc) return isPathClear(board, from, to);
    return false;
  }
  if (type === 'q') {
    if (dr === 0 || dc === 0 || absDr === absDc) return isPathClear(board, from, to);
    return false;
  }
  if (type === 'k') {
    if (absDr <= 1 && absDc <= 1) return true;
    return false;
  }
  return false;
}

function isPathClear(board, from, to) {
  const dr = to.row > from.row ? 1 : to.row < from.row ? -1 : 0;
  const dc = to.col > from.col ? 1 : to.col < from.col ? -1 : 0;
  let r = from.row + dr;
  let c = from.col + dc;
  while (r !== to.row || c !== to.col) {
    if (board[r][c]) return false;
    r += dr;
    c += dc;
  }
  return true;
}

function checkChessGameEnd(gameData) {
  const whiteKing = findKing(gameData, 'w');
  const blackKing = findKing(gameData, 'b');
  if (!whiteKing) return 'black';
  if (!blackKing) return 'white';
  return null;
}

function findKing(board, color) {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (board[r][c] === color + 'k') return { row: r, col: c };
    }
  }
  return null;
}

function processSnakeAction(session, player, action) {
  const gameData = session.gameData;
  const snake = gameData.snakes[player.username];
  if (!snake || !snake.alive) return { error: 'You are not alive.' };

  if (action.type === 'direction') {
    const opposites = { up: 'down', down: 'up', left: 'right', right: 'left' };
    if (action.direction !== opposites[snake.direction]) {
      snake.nextDirection = action.direction;
    }
  }
  return { success: true };
}

function processFlappyAction(session, player, action) {
  const gameData = session.gameData;
  const bird = gameData.birds[player.username];
  if (!bird || !bird.alive) return { error: 'You are not alive.' };

  if (action.type === 'flap') {
    bird.velocity = gameData.jumpForce;
  }
  return { success: true };
}

function processPaintballAction(session, player, action) {
  const gameData = session.gameData;
  const p = gameData.players[player.username];
  if (!p || !p.alive) return { error: 'You are not alive.' };
  const now = Date.now();

  if (action.type === 'move') {
    const speed = 4;
    let nx = p.x, ny = p.y;
    if (action.up) ny -= speed;
    if (action.down) ny += speed;
    if (action.left) nx -= speed;
    if (action.right) nx += speed;

    const margin = 16;
    if (nx < margin) nx = margin;
    if (nx > gameData.mapWidth - margin) nx = gameData.mapWidth - margin;
    if (ny < margin) ny = margin;
    if (ny > gameData.mapHeight - margin) ny = gameData.mapHeight - margin;

    for (const obs of gameData.obstacles) {
      if (nx > obs.x - margin && nx < obs.x + obs.width + margin &&
          ny > obs.y - margin && ny < obs.y + obs.height + margin) {
        return { error: 'Blocked by obstacle.' };
      }
    }
    p.x = nx;
    p.y = ny;
  } else if (action.type === 'aim') {
    p.angle = action.angle;
  } else if (action.type === 'shoot') {
    if (p.ammo <= 0) return { error: 'No ammo.' };
    if (now - p.lastShot < 500) return { error: 'Reloading...' };
    p.lastShot = now;
    p.ammo--;
    const projectile = {
      id: `proj-${now}-${Math.random().toString(36).slice(2,6)}`,
      x: p.x,
      y: p.y,
      angle: p.angle,
      speed: 20,
      owner: player.username,
      color: p.color,
      damage: 25,
      createdAt: now
    };
    gameData.projectiles.push(projectile);
  } else if (action.type === 'reload') {
    if (p.ammo < 10 && now - p.lastShot > 2000) {
      p.ammo = 10;
    }
  }
  return { success: true };
}

function updateGameLoops() {
  const now = Date.now();
  for (const session of gameSessions.values()) {
    if (session.state !== GAME_STATES.PLAYING) continue;
    session.updatedAt = now;

    if (session.gameType === GAME_TYPES.SNAKE) {
      updateSnakeLoop(session, now);
    } else if (session.gameType === GAME_TYPES.FLAPPY) {
      updateFlappyLoop(session, now);
    } else if (session.gameType === GAME_TYPES.PAINTBALL) {
      updatePaintballLoop(session, now);
    }
  }
}

function updateSnakeLoop(session, now) {
  const gameData = session.gameData;
  let anyAlive = false;
  for (const snake of Object.values(gameData.snakes)) {
    if (!snake.alive) continue;
    anyAlive = true;
    snake.direction = snake.nextDirection;
    const head = { ...snake.body[0] };
    switch (snake.direction) {
      case 'up': head.y--; break;
      case 'down': head.y++; break;
      case 'left': head.x--; break;
      case 'right': head.x++; break;
    }
    if (head.x < 0 || head.x >= gameData.gridSize || head.y < 0 || head.y >= gameData.gridSize) {
      snake.alive = false;
      continue;
    }
    for (const seg of snake.body) {
      if (seg.x === head.x && seg.y === head.y) {
        snake.alive = false;
        break;
      }
    }
    if (!snake.alive) continue;
    snake.body.unshift(head);
    if (head.x === gameData.food.x && head.y === gameData.food.y) {
      snake.score += 10;
      spawnFood(gameData, snake.body);
    } else {
      snake.body.pop();
    }
  }
  if (!anyAlive) {
    session.state = GAME_STATES.FINISHED;
    session.finishedAt = Date.now();
    const scores = Object.entries(gameData.snakes).map(([u,s])=>({username:u,score:s.score})).sort((a,b)=>b.score-a.score);
    session.winner = scores[0].username;
  }
}

function spawnFood(gameData, excludeBodies = []) {
  let x, y, valid;
  do {
    x = Math.floor(Math.random() * gameData.gridSize);
    y = Math.floor(Math.random() * gameData.gridSize);
    valid = true;
    for (const body of excludeBodies) {
      if (body.some(seg => seg.x === x && seg.y === y)) { valid = false; break; }
    }
  } while (!valid);
  gameData.food = { x, y };
}

function updateFlappyLoop(session, now) {
  const gameData = session.gameData;
  let anyAlive = false;
  gameData.frameCount++;

  if (gameData.frameCount % gameData.pipeSpawnInterval === 0) {
    const minHeight = 50;
    const maxHeight = 600 - gameData.pipeGap - minHeight;
    const topHeight = Math.random() * (maxHeight - minHeight) + minHeight;
    gameData.pipes.push({
      x: 400,
      topHeight,
      bottomY: topHeight + gameData.pipeGap,
      passed: new Set()
    });
  }

  for (const pipe of gameData.pipes) {
    pipe.x -= gameData.pipeSpeed;
  }
  gameData.pipes = gameData.pipes.filter(pipe => pipe.x + gameData.pipeWidth > 0);

  for (const [username, bird] of Object.entries(gameData.birds)) {
    if (!bird.alive) continue;
    anyAlive = true;
    bird.velocity += gameData.gravity;
    bird.y += bird.velocity;

    if (bird.y < 0 || bird.y > 600) {
      bird.alive = false;
      continue;
    }

    for (const pipe of gameData.pipes) {
      if (!pipe.passed.has(username) && pipe.x + gameData.pipeWidth < bird.x) {
        pipe.passed.add(username);
        bird.score++;
      }
      if (bird.x + 15 > pipe.x && bird.x - 15 < pipe.x + gameData.pipeWidth) {
        if (bird.y - 15 < pipe.topHeight || bird.y + 15 > pipe.bottomY) {
          bird.alive = false;
        }
      }
    }
  }
  if (!anyAlive) {
    session.state = GAME_STATES.FINISHED;
    session.finishedAt = Date.now();
    const scores = Object.entries(gameData.birds).map(([u,b])=>({username:u,score:b.score})).sort((a,b)=>b.score-a.score);
    session.winner = scores[0].username;
  }
}

function updatePaintballLoop(session, now) {
  const gameData = session.gameData;
  let aliveCount = 0;
  let lastAlive = null;

  for (const proj of gameData.projectiles) {
    proj.x += Math.cos(proj.angle) * proj.speed;
    proj.y += Math.sin(proj.angle) * proj.speed;
  }

  for (const proj of gameData.projectiles) {
    if (proj.x < 0 || proj.x > gameData.mapWidth || proj.y < 0 || proj.y > gameData.mapHeight) {
      proj.expired = true;
      continue;
    }
    for (const [username, player] of Object.entries(gameData.players)) {
      if (!player.alive || username === proj.owner) continue;
      const dx = proj.x - player.x;
      const dy = proj.y - player.y;
      if (dx*dx + dy*dy < 16*16) {
        player.hp -= proj.damage;
        proj.expired = true;
        if (player.hp <= 0) {
          player.alive = false;
          gameData.players[proj.owner].score += 100;
        }
        break;
      }
    }
    for (const obs of gameData.obstacles) {
      if (proj.x > obs.x && proj.x < obs.x + obs.width && proj.y > obs.y && proj.y < obs.y + obs.height) {
        proj.expired = true;
        break;
      }
    }
  }
  gameData.projectiles = gameData.projectiles.filter(p => !p.expired);

  for (const [username, player] of Object.entries(gameData.players)) {
    if (player.alive) {
      aliveCount++;
      lastAlive = username;
    } else if (player.respawnAt && now > player.respawnAt) {
      player.alive = true;
      player.hp = 100;
      player.ammo = 10;
      player.x = Math.random() < 0.5 ? 100 : 700;
      player.y = Math.random() < 0.5 ? 100 : 500;
    }
  }

  if (aliveCount <= 1) {
    session.state = GAME_STATES.FINISHED;
    session.finishedAt = Date.now();
    session.winner = lastAlive || Object.keys(gameData.players)[0];
  }
}

setInterval(updateGameLoops, 50).unref();

function handleFriendInvite(msg, context, username, send, toUser) {
  const { target, serverId } = msg;
  const { data, users, clients, isAcceptedFriend, clean, toUser: toUserFn } = context;
  if (!target || !serverId) {
    send({ type: 'error', message: 'Target and server required.' });
    return;
  }
  if (target === username) {
    send({ type: 'error', message: 'You cannot invite yourself.' });
    return;
  }
  if (!data.users[target]) {
    send({ type: 'error', message: 'User not found.' });
    return;
  }
  if (target === username) {
    send({ type: 'error', message: 'You cannot invite yourself.' });
    return;
  }
  if (!isAcceptedFriend(username, target)) {
    send({ type: 'error', message: 'You can only invite accepted friends.' });
    return;
  }
  const s = data.servers.find(x => x.id === serverId);
  if (!s || !s.members?.includes(username)) {
    send({ type: 'error', message: 'You are not a member of this server.' });
    return;
  }
  if (s.members.includes(target)) {
    send({ type: 'error', message: 'User is already a member of this server.' });
    return;
  }
  const code = crypto.randomBytes(6).toString('base64url');
  data.invites[code] = { serverId: s.id, createdBy: username, expires: Date.now() + 604800000 };
  save();
  toUserFn(target, {
    type: 'friend_invite',
    code,
    serverId: s.id,
    serverName: s.name,
    from: username
  });
  send({ type: 'friend_invite_sent', code, serverId: s.id, target });
}

function handleFriendInviteAccept(msg, context, username, send, toUser) {
  const { code } = msg;
  const { data, users, clients, clean, toUser: toUserFn } = context;
  const inv = data.invites[code];
  if (!inv) {
    send({ type: 'error', message: 'Invite not found or expired.' });
    return;
  }
  if (inv.expires < Date.now()) {
    delete data.invites[code];
    send({ type: 'error', message: 'Invite expired.' });
    return;
  }
  const s = data.servers.find(x => x.id === inv.serverId);
  if (!s) return send({ type: 'error', message: 'Server not found.' });
  if (!s.members.includes(username)) s.members.push(username);
  save();
  toUserFn(inv.createdBy, { type: 'friend_invite_accepted', code, by: username });
  send({ type: 'friend_invite_accepted', code, serverId: s.id });
  send({ type: 'server_joined', server: s });
}

function handleFriendInviteDecline(msg, context, username, send, toUser) {
  const { code } = msg;
  const { data, users, clients, clean, toUser: toUserFn } = context;
  const inv = data.invites[code];
  if (!inv) return send({ type: 'error', message: 'Invite not found.' });
  toUserFn(inv.createdBy, { type: 'friend_invite_declined', code, by: username });
  delete data.invites[code];
  save();
  send({ type: 'friend_invite_declined', code });
}

module.exports = {
  GAME_TYPES,
  GAME_STATES,
  gameSessions,
  createGameSession,
  getGameSession,
  getGameSessionsForUser,
  deleteGameSession,
  handleGameInvite,
  handleGameAccept,
  handleGameDecline,
  handleGameAction,
  handleGameLeave,
  handleFriendInvite,
  handleFriendInviteAccept,
  handleFriendInviteDecline
};