const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  GAME_TYPES,
  createGameSession,
  deleteGameSession,
  handleGameAccept,
  handleGameAction,
  updateGameLoops
} = require('../server/games-multiplayer');

function startGame(gameType) {
  const session = createGameSession(gameType, 'GameAlice', 'GameBob');
  session.inviteId = `test-${session.id}`;
  session.inviteExpires = Date.now() + 60_000;
  const context = { data: { users: { GameAlice: {}, GameBob: {} } }, users: {}, clients: new Map(), clean: value => value };
  const events = [];
  handleGameAccept({ inviteId: session.inviteId }, context, 'GameBob', () => {}, (username, payload) => events.push({ username, payload }));
  assert.equal(session.state, 'playing');
  return { session, context, events };
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

test('server-tick game endings notify both players and stale games keep an activity-based expiry', () => {
  const { session, events } = startGame(GAME_TYPES.SNAKE);
  try {
    events.length = 0;
    const lastActionAt = session.updatedAt;
    const snakes = session.gameData.snakes;
    Object.assign(snakes.GameAlice, { body: [{ x: 0, y: 0 }], direction: 'up', nextDirection: 'up', score: 10 });
    Object.assign(snakes.GameBob, { body: [{ x: 29, y: 29 }], direction: 'down', nextDirection: 'down' });

    updateGameLoops(session.gameData.nextTickAt - 1);
    assert.equal(session.state, 'playing');
    updateGameLoops(session.gameData.nextTickAt);

    assert.equal(session.state, 'finished');
    assert.equal(session.updatedAt, lastActionAt, 'simulation ticks must not keep an idle session alive forever');
    const ended = events.filter(event => event.payload.type === 'game_state' && event.payload.state === 'finished');
    assert.deepEqual(ended.map(event => event.username).sort(), ['GameAlice', 'GameBob']);
    assert.ok(ended.every(event => event.payload.winner === 'GameAlice'));
    assert.ok(ended.every(event => event.payload.reason === 'game over'));
  } finally {
    deleteGameSession(session.id);
  }
});

test('Snake food consumption grows the snake and broadcasts the authoritative tick to both players', () => {
  const { session, events } = startGame(GAME_TYPES.SNAKE);
  try {
    const { snakes, nextTickAt } = session.gameData;
    session.gameData.food = { x: 6, y: 5 };
    events.length = 0;

    updateGameLoops(nextTickAt);
    assert.deepEqual(snakes.GameAlice.body, [{ x: 6, y: 5 }, { x: 5, y: 5 }]);
    assert.equal(snakes.GameAlice.score, 10);
    for (const snake of Object.values(snakes)) {
      assert.ok(!snake.body.some(cell => cell.x === session.gameData.food.x && cell.y === session.gameData.food.y));
    }
    assert.deepEqual(events.map(event => event.username).sort(), ['GameAlice', 'GameBob']);
    assert.ok(events.every(event => event.payload.type === 'game_state' && event.payload.state === 'playing'));
    updateGameLoops(nextTickAt + 50);
    assert.equal(events.length, 2, 'no extra simulation step between Snake ticks');
  } finally {
    deleteGameSession(session.id);
  }
});

test('Snake clients render the server board and send named directions from touch and keyboard', () => {
  const html = readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const start = html.indexOf('function renderSnake(');
  const end = html.indexOf('function renderPaintball(', start);
  assert.ok(start >= 0 && end > start);
  const nodes = new Map();
  const sent = [];
  const pressed = [];
  const touch = { dataset: { snakeDirection: 'left' } };
  const drawing = new Proxy({}, { get: () => () => {} });
  let handler;
  const context = {
    me: { username: 'GameBob' },
    cleanupGame() {},
    document: { addEventListener: (_type, listener) => pressed.push(listener) },
    localStorage: { getItem: () => null },
    registerGameHandler: (_game, callbacks) => { handler = callbacks; },
    $: id => {
      if (!nodes.has(id)) nodes.set(id, {
        classList: { toggle() {} },
        getContext: () => drawing,
        width: 400,
        height: 400
      });
      return nodes.get(id);
    },
    send: message => sent.push(JSON.parse(JSON.stringify(message))),
    currentGameKeyHandler: null,
    currentGame: null,
    gameLoopId: null
  };
  vm.runInNewContext(html.slice(start, end), context);
  context.renderSnake({ querySelectorAll: () => [touch] });
  const { session } = startGame(GAME_TYPES.SNAKE);
  try {
    const info = { gameType: 'snake', gameId: session.id, state: 'playing', gameData: session.gameData, players: session.players };
    handler.onGameState({ ...info, started: true });
    assert.equal(nodes.get('snakeStart').hidden, true);
    assert.equal(nodes.get('snakeMatchStatus').textContent, 'Playing against GameAlice');
    touch.onclick();
    pressed[0]({ key: 'ArrowUp', preventDefault() {} });
    assert.deepEqual(sent.map(message => message.action), [
      { type: 'direction', direction: 'left' },
      { type: 'direction', direction: 'up' }
    ]);
    handler.onGameState({ ...info, state: 'finished', winner: null });
    assert.equal(nodes.get('snakeMatchStatus').textContent, 'Draw');
    touch.onclick();
    assert.equal(sent.length, 2, 'a completed match should stop sending controls');
  } finally {
    deleteGameSession(session.id);
  }
});

test('Flappy broadcasts the same authoritative simulation tick and tied result to both players', () => {
  const { session, events } = startGame(GAME_TYPES.FLAPPY);
  try {
    events.length = 0;
    const { birds, startsAt } = session.gameData;
    updateGameLoops(startsAt - 1);
    assert.equal(events.length, 0);
    updateGameLoops(startsAt);
    assert.equal(events.length, 2);
    assert.ok(events.every(event => event.payload.state === 'playing'));
    assert.ok(birds.GameAlice.y > 300);

    birds.GameAlice.y = 5;
    birds.GameBob.y = 595;
    events.length = 0;
    updateGameLoops(startsAt + 50);
    assert.deepEqual(events.map(event => event.username).sort(), ['GameAlice', 'GameBob']);
    assert.ok(events.every(event => event.payload.state === 'finished' && event.payload.winner === null));
  } finally {
    deleteGameSession(session.id);
  }
});

test('the Flappy client sends flap input and displays the server score and outcome', () => {
  const html = readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const start = html.indexOf('function renderFlappyBird(');
  const end = html.indexOf('function renderChess(', start);
  assert.ok(start >= 0 && end > start);
  const nodes = new Map();
  const sent = [];
  const input = new Map();
  const drawing = new Proxy({}, { get: () => () => {} });
  let handler;
  vm.runInNewContext(html.slice(start, end) + '\nrenderFlappyBird({});', {
    me: { username: 'GameBob' },
    cleanupGame() {},
    document: { addEventListener: (type, listener) => input.set(type, listener) },
    localStorage: { getItem: () => null },
    registerGameHandler: (_game, callbacks) => { handler = callbacks; },
    $: id => {
      if (!nodes.has(id)) nodes.set(id, {
        classList: { toggle() {} },
        getContext: () => drawing,
        addEventListener() {},
        width: 400,
        height: 600
      });
      return nodes.get(id);
    },
    send: message => sent.push(JSON.parse(JSON.stringify(message))),
    currentGameKeyHandler: null,
    currentGame: null,
    gameLoopId: null
  });
  const { session } = startGame(GAME_TYPES.FLAPPY);
  try {
    const info = { gameType: 'flappy', gameId: session.id, state: 'playing', gameData: session.gameData, players: session.players };
    session.gameData.birds.GameBob.score = 2;
    handler.onGameState({ ...info, started: true });
    assert.equal(nodes.get('flappyScore').textContent, 2);
    input.get('keydown')({ code: 'Space', preventDefault() {} });
    assert.deepEqual(sent[0].action, { type: 'flap' });
    handler.onGameState({ ...info, state: 'finished', winner: 'GameBob' });
    assert.equal(nodes.get('flappyInviteStatus').textContent, 'You won!');
    input.get('keydown')({ code: 'Space', preventDefault() {} });
    assert.equal(sent.length, 1);
  } finally {
    deleteGameSession(session.id);
  }
});
