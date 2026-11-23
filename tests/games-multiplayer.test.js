const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  GAME_TYPES,
  createGameSession,
  deleteGameSession,
  handleGameAccept,
  handleGameAction
} = require('../server/games-multiplayer');

function startGame(gameType) {
  const session = createGameSession(gameType, 'GameAlice', 'GameBob');
  session.inviteId = `test-${session.id}`;
  session.inviteExpires = Date.now() + 60_000;
  const context = { data: { users: { GameAlice: {}, GameBob: {} } }, users: {}, clients: new Map(), clean: value => value };
  handleGameAccept({ inviteId: session.inviteId }, context, 'GameBob', () => {}, () => {});
  assert.equal(session.state, 'playing');
  return { session, context };
}

function submit(session, context, username, action) {
  const messages = [];
  handleGameAction({ gameId: session.id, action }, context, username, message => messages.push(message), () => {});
  return messages;
}

test('all multiplayer games reject missing and non-object actions without changing game state', () => {
  for (const gameType of Object.values(GAME_TYPES)) {
    const { session, context } = startGame(gameType);
    try {
      const before = structuredClone(session.gameData);
      for (const action of [undefined, null, 'move', []]) {
        const [error] = submit(session, context, 'GameAlice', action);
        assert.equal(error.type, 'error', `${gameType} should reject ${String(action)}`);
        assert.match(error.message, /invalid game action/i);
        assert.deepEqual(session.gameData, before, `${gameType} state should not change`);
      }
    } finally {
      deleteGameSession(session.id);
    }
  }
});

test('Snake accepts only legal direction names and known action types', () => {
  const { session, context } = startGame(GAME_TYPES.SNAKE);
  try {
    const snake = session.gameData.snakes.GameAlice;
    const originalDirection = snake.nextDirection;
    let [error] = submit(session, context, 'GameAlice', { type: 'direction', direction: 'teleport' });
    assert.equal(error.type, 'error');
    assert.equal(snake.nextDirection, originalDirection);

    [error] = submit(session, context, { type: 'direction', direction: 'up' });
    assert.equal(error.type, 'error', 'non-player actions must be rejected');

    const [unknownAction] = submit(session, context, 'GameAlice', { type: 'teleport' });
    assert.equal(unknownAction.type, 'error');
    assert.match(unknownAction.message, /unknown snake action/i);

    assert.equal(submit(session, context, 'GameAlice', { type: 'direction', direction: 'up' }).length, 0);
    assert.equal(snake.nextDirection, 'up');
  } finally {
    deleteGameSession(session.id);
  }
});

test('Flappy and Paintball reject unsupported or malformed controls', () => {
  const flappy = startGame(GAME_TYPES.FLAPPY);
  try {
    const [error] = submit(flappy.session, flappy.context, 'GameAlice', { type: 'cheat' });
    assert.equal(error.type, 'error');
    assert.match(error.message, /unknown flappy action/i);
    assert.equal(submit(flappy.session, flappy.context, 'GameAlice', { type: 'flap' }).length, 0);
    assert.equal(flappy.session.gameData.birds.GameAlice.velocity, flappy.session.gameData.jumpForce);
  } finally {
    deleteGameSession(flappy.session.id);
  }

  const paintball = startGame(GAME_TYPES.PAINTBALL);
  try {
    const player = paintball.session.gameData.players.GameAlice;
    const originalAngle = player.angle;
    let [error] = submit(paintball.session, paintball.context, 'GameAlice', { type: 'aim', angle: 'north' });
    assert.equal(error.type, 'error');
    assert.equal(player.angle, originalAngle);

    [error] = submit(paintball.session, paintball.context, 'GameAlice', { type: 'move', up: 'yes' });
    assert.equal(error.type, 'error');

    [error] = submit(paintball.session, paintball.context, 'GameAlice', { type: 'emote' });
    assert.equal(error.type, 'error');
    assert.match(error.message, /unknown paintball action/i);

    assert.equal(submit(paintball.session, paintball.context, 'GameAlice', { type: 'aim', angle: Math.PI / 2 }).length, 0);
    assert.equal(player.angle, Math.PI / 2);
  } finally {
    deleteGameSession(paintball.session.id);
  }
});
