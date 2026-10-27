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
  assert.match(html, /id="settingsPanelAccount"/);
  assert.match(html, /id="settingsPanelMinecraft"/);
  assert.match(html, /<option value="account">Account<\/option>/);
  assert.match(html, /<option value="minecraft">Minecraft<\/option>/);
});

test('settings modal has activity panel', () => {
  const html = readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(html, /id="settingsPanelActivity"/);
  assert.match(html, /<option value="activity">Activity<\/option>/);
});

test('settings modal has search input', () => {
  const html = readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(html, /id="settingsSearch"/);
  assert.match(html, /oninput=/);
});

test('settings modal has polished card styling', () => {
  const html = readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(html, /box-shadow:0 12px 32px/);
});

test('app uses gaming gradient background', () => {
  const html = readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(html, /linear-gradient\(135deg,#1e1f22 0%,#2b2d31 100%\)/);
});

test('gamer ui toggle exists and persists', () => {
  const html = readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(html, /id="gamerUiToggle"/);
  assert.match(html, /localStorage\.setItem\('gamerUi'/);
});

test('first login prompts for gamer ui', () => {
  const html = readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(html, /localStorage\.getItem\('gamerUi'\)===null/);
  assert.match(html, /showConfirm\('Enable Gamer UI\?/);
});









test('minecraft linking result switches to minecraft category', () => {
  const html = readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(html, /settingsCategory\.value = 'minecraft'/);
});



test('eaglercraft extension download link exists', () => {
  const html = readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(html, /href="\/eaglercraft-extension\.zip"/);
});



test('settings category persists to localStorage', () => {
  const html = readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(html, /localStorage\.setItem\('settingsCategory',v\)/);
  assert.match(html, /localStorage\.getItem\('settingsCategory'\)/);
});








