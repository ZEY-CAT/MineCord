const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

test('settings modal can be closed with Escape', () => {
  const html = readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(html, /event\.key === 'Escape'/);
  assert.match(html, /show\('settingsModal', false\)/);
});

test('settings modal has category navigation', () => {
  const html = readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(html, /id="settingsCategory"/);
  assert.match(html, /<option value="account">Account<\/option>/);
  assert.match(html, /<option value="minecraft">Minecraft<\/option>/);
  assert.match(html, /<option value="activity">Activity<\/option>/);
});

