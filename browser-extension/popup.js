const $ = id => document.getElementById(id);

function setStatus(message, state = 'info') {
  $('status').textContent = message;
  $('status').dataset.state = state;
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, response => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(response || {});
    });
  });
}

function requestOriginPermission(origin) {
  return new Promise(resolve => chrome.permissions.request({ origins: [`${origin}/*`] }, resolve));
}

function serverOrigin(value) {
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('Enter a valid MINECORD server URL.');
  }
  const origin = url.origin;
  if (!origin.startsWith('https://') && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
    throw new Error('Use HTTPS for an online server; HTTP is only allowed for localhost development.');
  }
  return origin;
}

async function refreshStatus() {
  try {
    const state = await sendMessage({ type: 'status' });
    if (state.serverUrl && !$('server').value) $('server').value = state.serverUrl;
    $('unpair').disabled = !state.paired;
    setStatus(
      state.paired
        ? 'Paired. Matching Eaglercraft tabs are detected automatically.'
        : 'Not paired. Enter the MINECORD server URL and one-time Settings code.',
      state.paired ? 'success' : 'info'
    );
  } catch (error) {
    $('unpair').disabled = true;
    setStatus(`Could not read extension status: ${error.message}`, 'error');
  }
}

$('pair').addEventListener('click', async () => {
  let origin;
  try {
    origin = serverOrigin($('server').value);
  } catch (error) {
    setStatus(error.message, 'error');
    return;
  }
  const code = $('code').value.trim();
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(code)) {
    setStatus('Enter the valid one-time pairing code generated in MINECORD Settings.', 'error');
    return;
  }

  setStatus('Requesting permission to contact this MINECORD server…');
  if (!await requestOriginPermission(origin)) {
    setStatus('Permission to contact the MINECORD server was not granted.', 'error');
    return;
  }

  setStatus('Validating the one-time code with MINECORD…');
  try {
    const result = await sendMessage({ type: 'pair', serverUrl: origin, code });
    if (result.error) throw new Error(result.error);
    $('code').value = '';
    await refreshStatus();
  } catch (error) {
    setStatus(error.message || 'Pairing failed. Check the server URL and code.', 'error');
  }
});

$('unpair').addEventListener('click', async () => {
  $('unpair').disabled = true;
  setStatus('Revoking the activity connection…');
  try {
    const result = await sendMessage({ type: 'unpair' });
    if (result.error) throw new Error(result.error);
    await refreshStatus();
  } catch (error) {
    $('unpair').disabled = false;
    setStatus(error.message || 'MINECORD could not revoke this activity connector.', 'error');
  }
});

$('options')?.addEventListener('click', event => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});

refreshStatus();
