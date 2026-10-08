const $ = id => document.getElementById(id);
chrome.runtime.sendMessage({ type: 'status' }, state => {
  if (state?.paired) {
    $('server').value = state.serverUrl;
    $('status').textContent = 'Paired. Matching Eaglercraft tabs are detected automatically.';
  }
});
$('pair').addEventListener('click', () => {
  $('status').textContent = 'Pairing…';
  let origin;
  try {
    origin = new URL($('server').value).origin;
  } catch {
    $('status').textContent = 'Enter a valid MINECORD server URL.';
    return;
  }
  if (!origin.startsWith('https://') && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
    $('status').textContent = 'Use HTTPS for an online server; HTTP is only allowed for localhost development.';
    return;
  }
  chrome.permissions.request({ origins: [`${origin}/*`] }, granted => {
    if (!granted) {
      $('status').textContent = 'Permission to contact the MINECORD server was not granted.';
      return;
    }
    chrome.runtime.sendMessage({ type: 'pair', serverUrl: $('server').value, code: $('code').value }, result => {
      $('status').textContent = result?.error || 'Paired. Eaglercraft activity sharing is ready.';
    });
  });
});
$('unpair').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'unpair' }, () => {
    $('status').textContent = 'Unpaired. No Eaglercraft activity will be sent.';
  });
});
