const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

const publicDir = path.join(__dirname, '../public');
const script = readFileSync(path.join(publicDir, 'public-analytics.js'), 'utf8');
const preference = 'minecord-analytics-consent-v1';
const measurementId = 'G-SEMMPDBS1Y';

function element() {
  return { addEventListener(name, callback) { this[name] = callback; } };
}

function visit(pathname, { saved, search = '' } = {}) {
  const age = element();
  const allow = element();
  const decline = element();
  const status = {};
  const controls = {
    querySelector(selector) {
      return { select: age, '[data-analytics-allow]': allow,
        '[data-analytics-decline]': decline, '[role="status"]': status }[selector];
    }
  };
  const tags = [];
  const cookies = [];
  const storage = new Map([[preference, saved]]);
  const window = { ...element(), location: { pathname, search, hash: '' } };
  runInNewContext(script, {
    window,
    document: {
      querySelector: () => controls,
      createElement: () => ({}),
      head: { appendChild: tag => tags.push(tag) },
      set cookie(value) { cookies.push(value); }
    },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) }
  });
  return { age, allow, decline, status, tags, cookies, storage, window };
}

test('public analytics waits for adult opt-in and sends one sanitized page view', () => {
  const page = visit('/download');
  assert.equal(page.tags.length, 0);
  page.allow.click();
  page.age.value = 'minor';
  page.age.change();
  assert.equal(page.tags.length, 0);
  assert.equal(page.storage.get(preference), 'declined');
  page.age.value = 'adult';
  page.age.change();
  page.allow.click();
  page.allow.click();
  assert.equal(page.tags.length, 1);
  assert.equal(page.tags[0].src, 'https://www.googletagmanager.com/gtag/js?id=' + measurementId);
  const commands = Array.from(page.window.dataLayer, command => Array.from(command));
  const consent = commands.find(([command]) => command === 'consent')[2];
  assert.equal(consent.analytics_storage, 'granted');
  for (const key of ['ad_storage', 'ad_user_data', 'ad_personalization']) {
    assert.equal(consent[key], 'denied');
  }
  const config = commands.find(([command]) => command === 'config')[2];
  assert.equal(config.send_page_view, false);
  assert.equal(config.allow_google_signals, false);
  assert.equal(config.allow_ad_personalization_signals, false);
  const events = commands.filter(([command]) => command === 'event');
  assert.equal(events.length, 1);
  assert.equal(events[0][1], 'page_view');
  assert.equal(events[0][2].page_location, 'https://minecord-8vg2.onrender.com/download');
  assert.equal(events[0][2].page_referrer, '');
});

test('withdrawal disables analytics and clears its cookies', () => {
  const page = visit('/', { saved: 'allowed' });
  assert.equal(page.tags.length, 1);
  page.decline.click();
  assert.equal(page.window['ga-disable-' + measurementId], true);
  assert.equal(page.storage.get(preference), 'declined');
  assert.equal(page.cookies.length, 2);
  assert.equal(visit('/download', { saved: 'declined' }).tags.length, 0);
});

test('authenticated and query-bearing URLs cannot load the tag', () => {
  for (const url of ['/app', '/app/chat', '/privacy', '/landing.html']) {
    assert.equal(visit(url, { saved: 'allowed' }).tags.length, 0);
  }
  assert.equal(visit('/', { saved: 'allowed', search: '?oauth=example' }).tags.length, 0);
  assert.doesNotMatch(readFileSync(path.join(publicDir, 'index.html'), 'utf8'),
    /public-analytics\.js|googletagmanager\.com|G-SEMMPDBS1Y/);
});
