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
});
