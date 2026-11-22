const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.join(__dirname, '..');

test('account settings expose an accessible password-change form', () => {
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'public/password-settings.js'), 'utf8');
  assert.match(html, /id="passwordChangeForm"/);
  assert.match(html, /id="currentAccountPassword"[^>]*autocomplete="current-password"/);
  assert.match(html, /id="newAccountPassword"[^>]*minlength="8"[^>]*maxlength="200"/);
  assert.match(html, /id="confirmAccountPassword"/);
  assert.match(html, /id="passwordChangeStatus"[^>]*aria-live="polite"/);
  assert.match(script, /newPassword !== confirmPassword/);
  assert.match(script, /\/api\/auth\/password\/change/);
  assert.match(script, /credentials: 'same-origin'/);
});

test('password change persists a new scrypt hash and transactionally invalidates other sessions', () => {
  const server = fs.readFileSync(path.join(root, 'server/server.js'), 'utf8');
  const database = fs.readFileSync(path.join(root, 'server/database.js'), 'utf8');
  assert.match(server, /app\.post\('\/api\/auth\/password\/change',requireAuth/);
  assert.match(server, /validPassword\(currentPassword,q\.minecordUser\)/);
  assert.match(server, /localUser\(q\.minecordUser\.username,newPassword\)/);
  assert.match(server, /save\(\{invalidateOtherSessions:/);
  assert.match(server, /Cache-Control','no-store'/);
  assert.match(database, /DELETE FROM sessions WHERE user_id = \? AND token_hash <> \?/);
});
