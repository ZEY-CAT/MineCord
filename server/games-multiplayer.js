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

function broadcastGameState(session, extra = {}) {
  if (typeof session.toUser !== 'function') return;
  for (const player of session.players) {
    session.toUser(player.username, {
      type: 'game_state',
      gameId: session.id,
      gameType: session.gameType,
      state: session.state,
      gameData: session.gameData,
      players: session.players,
      yourColor: player.color,
      winner: session.winner || null,
      reason: session.finishReason || null,
      ...extra
    });
  }
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
  if (!Object.values(GAME_TYPES).includes(gameType)) {
    send({ type: 'error', message: 'Unsupported game type.' });
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
  session.toUser = toUser;
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
  if (session.state !== GAME_STATES.WAITING || player.ready) {
    send({ type: 'error', message: 'This game invitation is no longer awaiting acceptance.' });
    return;
  }
  player.ready = true;
  session.updatedAt = Date.now();
  session.toUser = toUser;

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
      yourColor: p.color,
      started: allReady
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
  if (session.state !== GAME_STATES.WAITING) {
    send({ type: 'error', message: 'This game has already started.' });
    return;
  }
  if (!session.players.some(p => p.username === username)) {
    send({ type: 'error', message: 'You are not invited to this game.' });
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
  session.toUser = toUser;
  if (!action || typeof action !== 'object' || Array.isArray(action)) {
    send({ type: 'error', message: 'Invalid game action.' });
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
    session.finishReason = result.reason || null;
    session.finishedAt = Date.now();
  }

  if (action.type !== 'controls' || session.gameType !== GAME_TYPES.PAINTBALL) {
    broadcastGameState(session, { lastAction: { by: username, action, result } });
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
      toUser(p.username, { type: 'game_leave', gameId, gameType: session.gameType, by: username });
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
        castlingRights: { wK: true, wQ: true, bK: true, bQ: true },
        enPassantTarget: null,
        halfmoveClock: 0,
        positionCounts: {},
        whiteTime: 600,
        blackTime: 600,
        lastMoveTime: Date.now(),
        timersRunning: true,
        selectedSquare: null,
        boardFlipped: false
      };
      session.gameData.positionCounts[chessPositionKey(session.gameData)] = 1;
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
        nextTickAt: session.updatedAt + 1500
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
        startsAt: session.updatedAt + 1500,
        gravity: 0.5,
        jumpForce: -8,
        pipeGap: 150,
        pipeWidth: 60,
        pipeSpeed: 3,
        pipeSpawnInterval: 120
      };
      break;
    case GAME_TYPES.PAINTBALL:
      session.paintballControls = new Map();
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
    const obstacle = {
      x: Math.random() * 700 + 50,
      y: Math.random() * 500 + 50,
      width: Math.random() * 80 + 40,
      height: Math.random() * 80 + 40
    };
    const blocksSpawn = [[100, 100], [700, 500]].some(([x, y]) =>
      x > obstacle.x - 16 && x < obstacle.x + obstacle.width + 16 &&
      y > obstacle.y - 16 && y < obstacle.y + obstacle.height + 16);
    if (!blocksSpawn) obstacles.push(obstacle);
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
  if (!action || typeof action !== 'object' || Array.isArray(action)) {
    return { error: 'Invalid chess move.' };
  }
  const { type, from, to, promotion } = action;
  const gameData = session.gameData;

  if (type === 'claim_draw') {
    const color = player.color === 'white' ? 'w' : 'b';
    const currentKey = chessPositionKey(gameData);
    if (gameData.currentTurn !== color || ((gameData.positionCounts?.[currentKey] || 0) < 3 && gameData.halfmoveClock < 100)) {
      return { error: 'A threefold-repetition or fifty-move draw cannot be claimed now.' };
    }
    return { success: true, finished: true, winner: 'draw', reason: gameData.halfmoveClock >= 100 ? 'fifty-move rule' : 'threefold repetition' };
  }

  if (type === 'resign') {
    const color = player.color === 'white' ? 'w' : 'b';
    return { success: true, finished: true, winner: color === 'w' ? 'black' : 'white', reason: 'resignation' };
  }

  if (type === 'move') {
    const validSquare = square => Number.isInteger(square?.row) && Number.isInteger(square?.col) &&
      square.row >= 0 && square.row < 8 && square.col >= 0 && square.col < 8;
    if (!validSquare(from) || !validSquare(to) || (from.row === to.row && from.col === to.col)) {
      return { error: 'Move coordinates are invalid.' };
    }
    const piece = gameData.board[from.row][from.col];
    if (!piece) return { error: 'No piece at source square.' };
    const pieceColor = piece[0];
    const expectedColor = player.color === 'white' ? 'w' : 'b';
    if (pieceColor !== expectedColor) return { error: 'Not your piece.' };
    if (gameData.currentTurn !== expectedColor) return { error: 'Not your turn.' };

    const valid = isValidChessMove(gameData.board, from, to, piece, gameData);
    if (!valid) return { error: 'Invalid move.' };
    if (isKingInCheck(applyChessMove(gameData.board, from, to, piece, gameData).board, pieceColor)) {
      return { error: 'That move would leave your king in check.' };
    }

    if (promotion !== undefined && !(piece[1] === 'p' && (to.row === 0 || to.row === 7))) {
      return { error: 'Promotion is only valid when a pawn reaches its last rank.' };
    }
    const promotionTypes = ['q', 'r', 'b', 'n'];
    const reachesPromotionRank = piece[1] === 'p' && (to.row === 0 || to.row === 7);
    if (reachesPromotionRank && promotion && !promotionTypes.includes(promotion)) {
      return { error: 'Invalid pawn promotion piece.' };
    }
    const applied = applyChessMove(gameData.board, from, to, piece, gameData, reachesPromotionRank ? pieceColor + (promotion || 'q') : piece);
    gameData.board = applied.board;
    updateCastlingRights(gameData, from, to, piece, applied.captured);
    gameData.enPassantTarget = piece[1] === 'p' && Math.abs(to.row - from.row) === 2
      ? { row: (from.row + to.row) / 2, col: from.col }
      : null;
    gameData.halfmoveClock = piece[1] === 'p' || applied.captured ? 0 : (gameData.halfmoveClock || 0) + 1;
    gameData.moveHistory.push({ from, to, piece, captured: applied.captured, promotion: reachesPromotionRank ? (promotion || 'q') : null, enPassant: applied.enPassant, castle: applied.castle });
    gameData.currentTurn = expectedColor === 'w' ? 'b' : 'w';
    gameData.lastMoveTime = Date.now();

    const key = chessPositionKey(gameData);
    gameData.positionCounts ||= {};
    gameData.positionCounts[key] = (gameData.positionCounts[key] || 0) + 1;
    const end = checkChessGameEnd(gameData);
    if (end) return { finished: true, winner: end.winner, reason: end.reason };

    return { success: true };
  }
  return { error: 'Unknown action type' };
}

function isValidChessMove(board, from, to, piece, gameData = {}) {
  if (!Array.isArray(board) || board.length !== 8 || !piece || piece.length !== 2) return false;
  const target = board[to.row][to.col];
  const color = piece[0];
  const type = piece[1];
  const dr = to.row - from.row;
  const dc = to.col - from.col;
  const absDr = Math.abs(dr);
  const absDc = Math.abs(dc);

  if (target && (target[0] === color || target[1] === 'k')) return false;

  if (type === 'k' && absDr === 0 && absDc === 2) {
    const homeRow = color === 'w' ? 7 : 0;
    const side = to.col > from.col ? 'K' : 'Q';
    const right = `${color}${side}`;
    const rookCol = side === 'K' ? 7 : 0;
    const between = side === 'K' ? [5, 6] : [1, 2, 3];
    if (from.row !== homeRow || from.col !== 4 || to.row !== homeRow || !gameData.castlingRights?.[right] || board[homeRow][rookCol] !== color + 'r') return false;
    if (between.some(col => board[homeRow][col])) return false;
    const enemy = color === 'w' ? 'b' : 'w';
    if ([4, side === 'K' ? 5 : 3, side === 'K' ? 6 : 2].some(col => isSquareAttacked(board, homeRow, col, enemy))) return false;
    return true;
  }

  if (type === 'p') {
    const dir = color === 'w' ? -1 : 1;
    const startRow = color === 'w' ? 6 : 1;
    if (dc === 0) {
      if (dr === dir && !target) return true;
      if (from.row === startRow && dr === 2 * dir && !board[from.row + dir][from.col] && !target) return true;
    }
    if (absDc === 1 && dr === dir && target && target[0] !== color) return true;
    if (absDc === 1 && dr === dir && !target && gameData.enPassantTarget?.row === to.row && gameData.enPassantTarget?.col === to.col) {
      return board[from.row][to.col] === (color === 'w' ? 'bp' : 'wp');
    }
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
  if (type === 'k' && absDr <= 1 && absDc <= 1) {
    return !isKingInCheck(applyChessMove(board, from, to, piece, gameData).board, color);
  }
  return false;
}

function applyChessMove(board, from, to, piece, gameData = {}, placedPiece = piece) {
  const next = board.map(row => row.slice());
  let captured = next[to.row][to.col];
  const enPassant = piece[1] === 'p' && from.col !== to.col && !captured;
  if (enPassant) {
    captured = next[from.row][to.col];
    next[from.row][to.col] = null;
  }
  next[from.row][from.col] = null;
  next[to.row][to.col] = placedPiece;
  const castle = piece[1] === 'k' && Math.abs(to.col - from.col) === 2;
  if (castle) {
    const rookFrom = to.col > from.col ? 7 : 0;
    const rookTo = to.col > from.col ? 5 : 3;
    next[from.row][rookTo] = next[from.row][rookFrom];
    next[from.row][rookFrom] = null;
  }
  return { board: next, captured, enPassant, castle };
}

function isSquareAttacked(board, row, col, byColor) {
  const pawnDirection = byColor === 'w' ? -1 : 1;
  const pawnRow = row - pawnDirection;
  for (const dc of [-1, 1]) if (board[pawnRow]?.[col + dc] === byColor + 'p') return true;
  for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
    if (board[row + dr]?.[col + dc] === byColor + 'n') return true;
  }
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue;
    if (board[row + dr]?.[col + dc] === byColor + 'k') return true;
  }
  for (const [dr, dc, types] of [[-1,0,['r','q']],[1,0,['r','q']],[0,-1,['r','q']],[0,1,['r','q']],[-1,-1,['b','q']],[-1,1,['b','q']],[1,-1,['b','q']],[1,1,['b','q']]]) {
    let r = row + dr, c = col + dc;
    while (r >= 0 && r < 8 && c >= 0 && c < 8) {
      const piece = board[r][c];
      if (piece) { if (piece[0] === byColor && types.includes(piece[1])) return true; break; }
      r += dr; c += dc;
    }
  }
  return false;
}

function isKingInCheck(board, color) {
  const king = findKing(board, color);
  return !king || isSquareAttacked(board, king.row, king.col, color === 'w' ? 'b' : 'w');
}

function hasLegalChessMove(gameData, color) {
  const board = gameData.board;
  for (let fromRow = 0; fromRow < 8; fromRow++) for (let fromCol = 0; fromCol < 8; fromCol++) {
    const piece = board[fromRow][fromCol];
    if (!piece || piece[0] !== color) continue;
    for (let toRow = 0; toRow < 8; toRow++) for (let toCol = 0; toCol < 8; toCol++) {
      const from = { row: fromRow, col: fromCol }, to = { row: toRow, col: toCol };
      if (!isValidChessMove(board, from, to, piece, gameData)) continue;
      const simulated = applyChessMove(board, from, to, piece, gameData).board;
      if (!isKingInCheck(simulated, color)) return true;
    }
  }
  return false;
}

function chessPositionKey(gameData) {
  const board = gameData.board || [];
  const boardKey = board.map(row => row.map(piece => piece || '--').join('')).join('/');
  const rights = ['wK','wQ','bK','bQ'].filter(key => gameData.castlingRights?.[key]).join('') || '-';
  const ep = gameData.enPassantTarget ? `${gameData.enPassantTarget.row},${gameData.enPassantTarget.col}` : '-';
  return `${boardKey} ${gameData.currentTurn || 'w'} ${rights} ${ep}`;
}

function updateCastlingRights(gameData, from, to, piece, captured) {
  gameData.castlingRights ||= { wK: false, wQ: false, bK: false, bQ: false };
  const color = piece[0];
  if (piece[1] === 'k') { gameData.castlingRights[`${color}K`] = false; gameData.castlingRights[`${color}Q`] = false; }
  const revokeRook = (rook, row, col) => {
    const side = col === 7 ? 'K' : 'Q';
    gameData.castlingRights[`${rook[0]}${side}`] = false;
  };
  if (piece[1] === 'r' && (from.row === 0 || from.row === 7) && (from.col === 0 || from.col === 7)) revokeRook(piece, from.row, from.col);
  if (captured?.[1] === 'r' && (to.row === 0 || to.row === 7) && (to.col === 0 || to.col === 7)) revokeRook(captured, to.row, to.col);
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
  const whiteKing = findKing(gameData.board, 'w');
  const blackKing = findKing(gameData.board, 'b');
  if (!whiteKing) return { winner: 'black', reason: 'king missing' };
  if (!blackKing) return { winner: 'white', reason: 'king missing' };
  const color = gameData.currentTurn;
  if (!hasLegalChessMove(gameData, color)) {
    if (isKingInCheck(gameData.board, color)) return { winner: color === 'w' ? 'black' : 'white', reason: 'checkmate' };
    return { winner: 'draw', reason: 'stalemate' };
  }
  if ((gameData.positionCounts?.[chessPositionKey(gameData)] || 0) >= 5) return { winner: 'draw', reason: 'fivefold repetition' };
  if (gameData.halfmoveClock >= 150) return { winner: 'draw', reason: 'seventy-five-move rule' };
  if (isInsufficientChessMaterial(gameData.board)) return { winner: 'draw', reason: 'insufficient material' };
  return null;
}

function isInsufficientChessMaterial(board) {
  const pieces = [];
  for (const row of board) for (const piece of row) if (piece && piece[1] !== 'k') pieces.push(piece);
  if (pieces.length === 0) return true;
  if (pieces.some(piece => piece[1] === 'p' || piece[1] === 'r' || piece[1] === 'q')) return false;
  if (pieces.length === 1) return true;
  if (pieces.every(piece => piece[1] === 'b')) {
    const bishopSquares = [];
    for (let r=0;r<8;r++) for (let c=0;c<8;c++) if (board[r][c]?.[1] === 'b') bishopSquares.push((r+c)%2);
    return bishopSquares.every(square => square === bishopSquares[0]);
  }
  return false;
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
    if (!Object.hasOwn(opposites, action.direction)) return { error: 'Invalid snake direction.' };
    if (action.direction !== opposites[snake.direction]) {
      snake.nextDirection = action.direction;
    }
    return { success: true };
  }
  return { error: 'Unknown snake action.' };
}

function processFlappyAction(session, player, action) {
  const gameData = session.gameData;
  const bird = gameData.birds[player.username];
  if (!bird || !bird.alive) return { error: 'You are not alive.' };

  if (action.type !== 'flap') return { error: 'Unknown Flappy action.' };
  bird.velocity = gameData.jumpForce;
  return { success: true };
}

function processPaintballAction(session, player, action, now = Date.now()) {
  const gameData = session.gameData;
  const p = gameData.players[player.username];
  if (!p || !p.alive) return { error: 'You are not alive.' };

  if (action.type === 'controls') {
    const fields = ['up', 'down', 'left', 'right', 'shoot', 'reload'];
    if (fields.some(key => action[key] !== undefined && typeof action[key] !== 'boolean') ||
        !Number.isFinite(action.angle)) return { error: 'Invalid Paintball controls.' };
    const previous = session.paintballControls.get(player.username);
    const recent = previous && now - previous.receivedAt <= 250;
    session.paintballControls.set(player.username, {
      receivedAt: now,
      angle: action.angle,
      queuedShot: Boolean(action.shoot || (recent && previous.queuedShot)),
      queuedReload: Boolean(action.reload || (recent && previous.queuedReload)),
      ...Object.fromEntries(fields.map(key => [key, Boolean(action[key])]))
    });
    return { success: true };
  }
  if (action.type === 'move') {
    if (['up', 'down', 'left', 'right'].some(key => action[key] !== undefined && typeof action[key] !== 'boolean')) {
      return { error: 'Invalid movement input.' };
    }
    if (now - (p.lastMoveAt || 0) < 45) return { success: true };
    p.lastMoveAt = now;
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
    if (typeof action.angle !== 'number' || !Number.isFinite(action.angle)) return { error: 'Invalid aim angle.' };
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
  } else {
    return { error: 'Unknown Paintball action.' };
  }
  return { success: true };
}

function updateGameLoops(now = Date.now()) {
  for (const session of gameSessions.values()) {
    if (session.state !== GAME_STATES.PLAYING) continue;

    if (session.gameType === GAME_TYPES.SNAKE) {
      if (now < session.gameData.nextTickAt) continue;
      session.gameData.nextTickAt = now + 100;
      updateSnakeLoop(session, now);
      if (session.state === GAME_STATES.PLAYING) broadcastGameState(session, { lastAction: null });
    } else if (session.gameType === GAME_TYPES.FLAPPY) {
      if (now < session.gameData.startsAt) continue;
      updateFlappyLoop(session, now);
      if (session.state === GAME_STATES.PLAYING) broadcastGameState(session, { lastAction: null });
    } else if (session.gameType === GAME_TYPES.PAINTBALL) {
      updatePaintballLoop(session, now);
      if (session.state === GAME_STATES.PLAYING) broadcastGameState(session, { lastAction: null });
    }

    if (session.state === GAME_STATES.FINISHED) {
      session.finishReason ||= 'game over';
      session.finishedAt ||= now;
      broadcastGameState(session, { lastAction: null });
    }
  }
}

function updateSnakeLoop(session, now) {
  const gameData = session.gameData;
  const snakes = Object.entries(gameData.snakes);
  let foodEaten = false;
  for (const [, snake] of snakes) {
    if (!snake.alive) continue;
    snake.direction = snake.nextDirection;
    const head = { ...snake.body[0] };
    switch (snake.direction) {
      case 'up': head.y--; break;
      case 'down': head.y++; break;
      case 'left': head.x--; break;
      case 'right': head.x++; break;
    }
    const eating = !foodEaten && head.x === gameData.food.x && head.y === gameData.food.y;
    const occupied = eating ? snake.body : snake.body.slice(0, -1);
    if (head.x < 0 || head.x >= gameData.gridSize || head.y < 0 || head.y >= gameData.gridSize ||
        occupied.some(segment => segment.x === head.x && segment.y === head.y)) {
      snake.alive = false;
      continue;
    }
    snake.body.unshift(head);
    if (eating) {
      snake.score += 10;
      foodEaten = true;
    } else {
      snake.body.pop();
    }
  }
  if (foodEaten) gameData.food = findFreeSnakeCell(gameData);
  if (!gameData.food || snakes.every(([, snake]) => !snake.alive)) {
    session.state = GAME_STATES.FINISHED;
    session.finishedAt = now;
    const [first, second] = snakes.sort(([, a], [, b]) => b.score - a.score);
    session.winner = first[1].score === second[1].score ? null : first[0];
  }
}

function findFreeSnakeCell({ snakes, gridSize }) {
  const occupied = new Set(Object.values(snakes).flatMap(snake =>
    snake.body.map(({ x, y }) => y * gridSize + x)));
  const free = [];
  for (let cell = 0; cell < gridSize * gridSize; cell++) {
    if (!occupied.has(cell)) free.push(cell);
  }
  if (free.length === 0) return null;
  const cell = free[Math.floor(Math.random() * free.length)];
  return { x: cell % gridSize, y: Math.floor(cell / gridSize) };
}

function updateFlappyLoop(session, now) {
  const gameData = session.gameData;
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
    bird.velocity += gameData.gravity;
    bird.y += bird.velocity;

    if (bird.y - 15 < 0 || bird.y + 15 > 600) {
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
          break;
        }
      }
    }
  }
  const birds = Object.entries(gameData.birds);
  if (birds.every(([, bird]) => !bird.alive)) {
    session.state = GAME_STATES.FINISHED;
    session.finishedAt = now;
    const [first, second] = birds.sort(([, a], [, b]) => b.score - a.score);
    session.winner = first[1].score === second[1].score ? null : first[0];
  }
}

function updatePaintballLoop(session, now) {
  const gameData = session.gameData;
  let aliveCount = 0;
  let lastAlive = null;

  for (const player of session.players) {
    const controls = session.paintballControls.get(player.username);
    const data = gameData.players[player.username];
    if (!controls || now - controls.receivedAt > 250 || !data.alive) continue;
    data.angle = controls.angle;
    if (controls.up || controls.down || controls.left || controls.right) {
      processPaintballAction(session, player, { ...controls, type: 'move' }, now);
    }
    if (controls.reload || controls.queuedReload) processPaintballAction(session, player, { type: 'reload' }, now);
    if (controls.shoot || controls.queuedShot) processPaintballAction(session, player, { type: 'shoot' }, now);
    controls.queuedReload = false;
    controls.queuedShot = false;
  }

  for (const proj of gameData.projectiles) {
    proj.x += Math.cos(proj.angle) * proj.speed;
    proj.y += Math.sin(proj.angle) * proj.speed;
  }

  for (const proj of gameData.projectiles) {
    if (proj.x < 0 || proj.x > gameData.mapWidth || proj.y < 0 || proj.y > gameData.mapHeight) {
      proj.expired = true;
      continue;
    }
    for (const obs of gameData.obstacles) {
      if (proj.x > obs.x && proj.x < obs.x + obs.width && proj.y > obs.y && proj.y < obs.y + obs.height) {
        proj.expired = true;
        break;
      }
    }
    if (proj.expired) continue;
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
    session.winner = lastAlive;
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
  updateGameLoops,
  handleGameInvite,
  handleGameAccept,
  handleGameDecline,
  handleGameAction,
  handleGameLeave,
  handleFriendInvite,
  handleFriendInviteAccept,
  handleFriendInviteDecline
};
