(() => {
  'use strict';

  const pendingKey = 'minecord.native-oauth.pending.v1';
  const providerNames = { google: 'Google', microsoft: 'Microsoft', github: 'GitHub' };
  const errorMessages = {
    cancelled: 'Sign-in was cancelled.',
    provider_failed: 'The identity provider could not complete sign-in. Try again.',
    account_banned: 'This account cannot sign in to MINECORD.',
    invalid_response: 'The app could not verify the sign-in response. Start again.',
    expired: 'This sign-in link expired or was already used. Start again.'
  };
  const processing = new Set();

  function randomBase64Url(byteCount) {
    const bytes = crypto.getRandomValues(new Uint8Array(byteCount));
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function readPending() {
    try {
      const value = JSON.parse(localStorage.getItem(pendingKey) || 'null');
      if (!value || typeof value.state !== 'string' || typeof value.verifier !== 'string'
          || Date.now() - value.createdAt > 10 * 60 * 1000 || Date.now() < value.createdAt) {
        localStorage.removeItem(pendingKey);
        return null;
      }
      return value;
    } catch {
      localStorage.removeItem(pendingKey);
      return null;
    }
  }

  function clearPending(state) {
    const current = readPending();
    if (!state || current?.state === state) localStorage.removeItem(pendingKey);
  }

  function showLoginMessage(message) {
    const node = document.getElementById('loginError');
    if (node) node.textContent = message;
  }

  async function finishSignIn(user) {
    me = user;
    const invite = new URLSearchParams(location.search).get('invite');
    if (invite) {
      location.replace('/invite/' + encodeURIComponent(invite));
      return;
    }
    show('login', false);
    connect();
  }

  async function beginOAuth(provider) {
    if (!Object.hasOwn(providerNames, provider)) return;
    const button = [...document.querySelectorAll('#login .oauthButton')]
      .find(node => node.textContent.includes(providerNames[provider]));
    if (button) button.disabled = true;
    showLoginMessage('Opening secure ' + providerNames[provider] + ' sign-in…');
    try {
      const state = randomBase64Url(32);
      const verifier = randomBase64Url(32);
      const challengeBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
      let challengeBinary = '';
      for (const byte of new Uint8Array(challengeBytes)) challengeBinary += String.fromCharCode(byte);
      const challenge = btoa(challengeBinary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
      const pending = { state, verifier, createdAt: Date.now() };
      localStorage.setItem(pendingKey, JSON.stringify(pending));

      const startUrl = new URL('/auth/' + provider, location.origin);
      startUrl.searchParams.set('native', '1');
      startUrl.searchParams.set('client_state', state);
      startUrl.searchParams.set('code_challenge', challenge);
      const tauriOpener = window.__TAURI__?.opener?.openUrl;
      if (typeof tauriOpener === 'function') {
        await tauriOpener(startUrl.toString());
      } else if (typeof window.minecordDesktop?.openExternalAuth === 'function') {
        await window.minecordDesktop.openExternalAuth(startUrl.toString());
      } else {
        clearPending(state);
        location.assign('/auth/' + provider + '?returnTo=' + encodeURIComponent('/app' + location.search));
      }
    } catch (error) {
      clearPending();
      showLoginMessage(error?.message || 'Could not open the secure sign-in window. Please try again.');
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function handleReturn(rawUrl) {
    let url;
    try { url = new URL(String(rawUrl)); } catch { return; }
    if (url.protocol !== 'minecord:' || url.hostname !== 'oauth' || url.username || url.password || url.port) return;
    if (!['/complete', '/error'].includes(url.pathname)) return;
    const state = url.searchParams.get('state') || '';
    const pending = readPending();
    if (!pending || !state || pending.state !== state || processing.has(state)) return;
    processing.add(state);
    try {
      if (url.pathname === '/error') {
        clearPending(state);
        const reason = url.searchParams.get('error') || 'provider_failed';
        showLoginMessage(errorMessages[reason] || errorMessages.provider_failed);
        return;
      }
      const code = url.searchParams.get('code') || '';
      if (!/^[A-Za-z0-9_-]{43}$/.test(code)) {
        clearPending(state);
        showLoginMessage(errorMessages.invalid_response);
        return;
      }
      const response = await fetch('/api/auth/native/exchange', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, state, verifier: pending.verifier })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        clearPending(state);
        showLoginMessage(response.status === 401 ? errorMessages.expired : (result.error || errorMessages.provider_failed));
        return;
      }
      clearPending(state);
      await finishSignIn(result.user);
    } catch (error) {
      clearPending(state);
      showLoginMessage(error?.message || 'Could not finish sign-in. Please try again.');
    } finally {
      processing.delete(state);
    }
  }

  window.minecordBeginOAuth = beginOAuth;

  for (const button of document.querySelectorAll('#login .oauthButton')) {
    const provider = Object.keys(providerNames).find(name => button.textContent.includes(providerNames[name]));
    if (!provider) continue;
    button.removeAttribute('onclick');
    button.addEventListener('click', event => {
      event.preventDefault();
      beginOAuth(provider);
    });
  }

  const tauriDeepLink = window.__TAURI__?.deepLink;
  if (tauriDeepLink) {
    Promise.resolve(tauriDeepLink.getCurrent?.()).then(urls => {
      for (const url of urls || []) handleReturn(url);
    }).catch(() => {});
    Promise.resolve(tauriDeepLink.onOpenUrl?.(urls => {
      for (const url of urls || []) handleReturn(url);
    })).catch(() => {});
  }

  if (typeof window.minecordDesktop?.onOAuthUrl === 'function') {
    window.minecordDesktop.getInitialOAuthUrl?.().then(url => { if (url) handleReturn(url); }).catch(() => {});
    window.minecordDesktop.onOAuthUrl(handleReturn);
  }
})();
