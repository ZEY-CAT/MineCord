const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

test('settings modal can be closed with Escape', () => {
  const html = readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(html, /event\.key === 'Escape'/);
  assert.match(html, /show\('settingsModal', false\)/);
});

test('shared responsive MineCord theme loads with reduced-motion and touch adaptations', () => {
  const html = readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const theme = readFileSync(path.join(__dirname, '..', 'public', 'app-theme.css'), 'utf8');
  assert.match(html, /href="\/app-theme\.css"/);
  assert.match(theme, /--canvas:\s*#101812/);
  assert.match(theme, /@media\s*\(max-width:\s*768px\)/);
  assert.match(theme, /@media\s*\(hover:\s*none\)/);
  assert.match(theme, /prefers-reduced-motion:\s*reduce/);
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

test('account settings expose an accessible password-change form without storing credentials in the browser', () => {
  const html = readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const client = readFileSync(path.join(__dirname, '..', 'public', 'password-settings.js'), 'utf8');
  const server = readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
  assert.match(html, /id="passwordChangeForm"/);
  assert.match(html, /autocomplete="current-password"/);
  assert.match(html, /autocomplete="new-password"/);
  assert.match(client, /newPassword !== confirmPassword/);
  assert.match(client, /fetch\('\/api\/auth\/password\/change'/);
  assert.doesNotMatch(client, /localStorage|sessionStorage/);
  assert.match(server, /if\(!validPassword\(currentPassword,q\.minecordUser\)\)/);
  assert.match(server, /localUser\(q\.minecordUser\.username,newPassword\)/);
  assert.match(server, /invalidateOtherSessions:\[\{userId:q\.minecordUser\.id,keepTokenHash\}\]/);
});








