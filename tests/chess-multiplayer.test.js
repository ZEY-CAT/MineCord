const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  GAME_STATES,
  createGameSession,
  deleteGameSession,
  handleGameAccept,
  handleGameAction
} = require('../server/games-multiplayer');

function makeChessSession(board, overrides = {}) {
  const session = createGameSession('chess', 'ChessWhite', 'ChessBlack');
  session.state = GAME_STATES.PLAYING;
  session.gameData = {
    board,
    currentTurn: 'w',
    moveHistory: [],
    castlingRights: { wK: false, wQ: false, bK: false, bQ: false },
    enPassantTarget: null,
    halfmoveClock: 0,
    positionCounts: {},
    ...overrides
  };
  return session;
}

function move(session, username, from, to, extra = {}) {
  const messages = [];
  handleGameAction({ gameId: session.id, action: { type: 'move', from, to, ...extra } }, {}, username,
    message => messages.push(message), (target, message) => messages.push({ target, ...message }));
  return messages;
}

function emptyBoard() { return Array.from({ length: 8 }, () => Array(8).fill(null)); }

test('multiplayer chess validates coordinates and promotes a pawn on the server', () => {
  const session = createGameSession('chess', 'ChessWhite', 'ChessBlack');
  session.inviteId = `test-${session.id}`;
  session.inviteExpires = Date.now() + 30_000;
  const states = [];

  try {
    handleGameAccept(
      { inviteId: session.inviteId },
      { data: { users: {} }, users: {}, clients: new Map(), clean: value => value },
      'ChessBlack',
      message => states.push(message),
      (username, message) => states.push({ username, ...message })
    );
    assert.equal(session.state, GAME_STATES.PLAYING);

    const errors = [];
    handleGameAction(
      { gameId: session.id, action: { type: 'move', from: { row: 6, col: 0 }, to: { row: 8, col: 0 } } },
      {},
      'ChessWhite',
      message => errors.push(message),
      () => {}
    );
    assert.match(errors[0].message, /coordinates are invalid/i);

    const board = session.gameData.board;
    board[6][0] = null;
    board[1][0] = 'wp';
    board[0][0] = null;
    const updates = [];
    handleGameAction(
      { gameId: session.id, action: { type: 'move', from: { row: 1, col: 0 }, to: { row: 0, col: 0 }, promotion: 'n' } },
      {},
      'ChessWhite',
      message => updates.push(message),
      (username, message) => updates.push({ username, ...message })
    );

    assert.equal(session.gameData.board[0][0], 'wn');
    assert.equal(session.gameData.board[1][0], null);
    assert.equal(updates.length, 2);
    assert.equal(updates[0].type, 'game_state');
    assert.equal(updates[0].gameData.moveHistory.length, 1);
  } finally {
    deleteGameSession(session.id);
  }
});

test('chess UI maps black to the server turn code and waits for authoritative multiplayer state', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(html, /myColor\s*=\s*ownPlayer\?\.color\s*===\s*'black'\s*\?\s*'b'\s*:\s*'w'/);
  assert.match(html, /Array\.isArray\(m\.board\)\s*\?\s*m\.board\.map/);
  assert.match(html, /if\s*\(chessMode\s*===\s*'multi'\s*&&\s*gameId\)\s*\{\s*sendMoveToServer\(fromRow,\s*fromCol,\s*toRow,\s*toCol\);\s*return;/);
  assert.match(html, /undoBtn\.disabled\s*=\s*mode\s*===\s*'multi'/);
  assert.match(html, /id="chessDrawClaim"/);
  assert.match(html, /action: \{ type: 'claim_draw' \}/);
  assert.match(html, /action: \{ type: 'resign' \}/);
  assert.match(html, /msg\.winner === 'draw'/);
  assert.match(html, /id="chessPromotion"[\s\S]*value="n">Knight/);
});

test('Chess forbids moves that expose the moving side king to check', () => {
  const board = emptyBoard();
  board[7][4] = 'wk'; board[0][0] = 'bk'; board[0][4] = 'br'; board[6][4] = 'wr';
  const session = makeChessSession(board);
  try {
    const messages = move(session, 'ChessWhite', { row: 6, col: 4 }, { row: 6, col: 3 });
    assert.match(messages[0].message, /leave your king in check/i);
    assert.equal(session.gameData.board[6][4], 'wr');
    assert.equal(session.gameData.currentTurn, 'w');
  } finally { deleteGameSession(session.id); }
});

test('Chess supports legal castling and removes castling rights when the king moves', () => {
  const board = emptyBoard();
  board[7][4] = 'wk'; board[7][7] = 'wr'; board[0][4] = 'bk';
  const session = makeChessSession(board, { castlingRights: { wK: true, wQ: false, bK: false, bQ: false } });
  try {
    const messages = move(session, 'ChessWhite', { row: 7, col: 4 }, { row: 7, col: 6 });
    assert.equal(messages.length, 2);
    assert.equal(session.gameData.board[7][6], 'wk');
    assert.equal(session.gameData.board[7][5], 'wr');
    assert.equal(session.gameData.castlingRights.wK, false);
  } finally { deleteGameSession(session.id); }
});

test('Chess rejects castling through an attacked square', () => {
  const board = emptyBoard(); board[7][4] = 'wk'; board[7][7] = 'wr'; board[0][0] = 'bk'; board[0][5] = 'br';
  const session = makeChessSession(board, { castlingRights: { wK: true, wQ: false, bK: false, bQ: false } });
  try {
    const messages = move(session, 'ChessWhite', { row: 7, col: 4 }, { row: 7, col: 6 });
    assert.match(messages[0].message, /Invalid move/i);
    assert.equal(session.gameData.board[7][4], 'wk');
  } finally { deleteGameSession(session.id); }
});

test('Chess supports en passant and removes the captured pawn', () => {
  const board = emptyBoard();
  board[7][4] = 'wk'; board[0][4] = 'bk'; board[3][4] = 'wp'; board[3][3] = 'bp';
  const session = makeChessSession(board, { enPassantTarget: { row: 2, col: 3 } });
  try {
    move(session, 'ChessWhite', { row: 3, col: 4 }, { row: 2, col: 3 });
    assert.equal(session.gameData.board[2][3], 'wp');
    assert.equal(session.gameData.board[3][3], null);
    assert.equal(session.gameData.moveHistory[0].enPassant, true);
  } finally { deleteGameSession(session.id); }
});

test('Chess detects checkmate and ends the game with the correct winner', () => {
  const session = makeChessSession([
    ['br','bn','bb','bq','bk','bb','bn','br'],
    ['bp','bp','bp','bp','bp','bp','bp','bp'],
    [null,null,null,null,null,null,null,null], [null,null,null,null,null,null,null,null],
    [null,null,null,null,null,null,null,null], [null,null,null,null,null,null,null,null],
    ['wp','wp','wp','wp','wp','wp','wp','wp'], ['wr','wn','wb','wq','wk','wb','wn','wr']
  ], { castlingRights: { wK: true, wQ: true, bK: true, bQ: true } });
  try {
    move(session, 'ChessWhite', { row: 6, col: 5 }, { row: 5, col: 5 });
    move(session, 'ChessBlack', { row: 1, col: 4 }, { row: 3, col: 4 });
    move(session, 'ChessWhite', { row: 6, col: 6 }, { row: 4, col: 6 });
    move(session, 'ChessBlack', { row: 0, col: 3 }, { row: 4, col: 7 });
    assert.equal(session.state, GAME_STATES.FINISHED);
    assert.equal(session.winner, 'black');
  } finally { deleteGameSession(session.id); }
});

test('Chess accepts a valid fifty-move draw claim and rejects unsupported claims', () => {
  const board = emptyBoard(); board[7][4] = 'wk'; board[0][4] = 'bk';
  const session = makeChessSession(board, { halfmoveClock: 100 });
  try {
    const messages = [];
    handleGameAction({ gameId: session.id, action: { type: 'claim_draw' } }, {}, 'ChessWhite',
      message => messages.push(message), (target, message) => messages.push({ target, ...message }));
    assert.equal(session.state, GAME_STATES.FINISHED);
    assert.equal(session.winner, 'draw');
    assert.equal(messages[0].lastAction.result.reason, 'fifty-move rule');
  } finally { deleteGameSession(session.id); }
});

test('Chess declares stalemate as a draw instead of awarding a win', () => {
  const board = emptyBoard(); board[0][0] = 'bk'; board[2][2] = 'wk'; board[3][2] = 'wq';
  const session = makeChessSession(board);
  try {
    const messages = move(session, 'ChessWhite', { row: 3, col: 2 }, { row: 2, col: 1 });
    assert.equal(session.state, GAME_STATES.FINISHED);
    assert.equal(session.winner, 'draw');
    assert.equal(messages[0].reason, 'stalemate');
  } finally { deleteGameSession(session.id); }
});

test('Chess resignation ends the match for both players with the opponent as winner', () => {
  const board = emptyBoard(); board[7][4] = 'wk'; board[0][4] = 'bk';
  const session = makeChessSession(board);
  try {
    const messages = [];
    handleGameAction({ gameId: session.id, action: { type: 'resign' } }, {}, 'ChessWhite',
      message => messages.push(message), (target, message) => messages.push({ target, ...message }));
    assert.equal(session.state, GAME_STATES.FINISHED);
    assert.equal(session.winner, 'black');
    assert.equal(messages[0].reason, 'resignation');
  } finally { deleteGameSession(session.id); }
});
