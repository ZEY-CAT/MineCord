function browserStateCookieOptions(provider, appUrl) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: appUrl.startsWith('https://'),
    path: `/auth/${provider}/callback`,
    maxAge: 10 * 60 * 1000
  };
}

function bindBrowserToOAuthState(res, provider, state, appUrl) {
  res.cookie('mc_oauth_state', state, browserStateCookieOptions(provider, appUrl));
}

function hasBrowserOAuthState(req, provider, state) {
  const cookie = String(req.headers.cookie || '')
    .split(';')
    .map(part => part.trim())
    .find(part => part.startsWith('mc_oauth_state='));
  if (!cookie || req.originalUrl?.split('?', 1)[0] !== `/auth/${provider}/callback`) return false;
  try {
    return decodeURIComponent(cookie.slice('mc_oauth_state='.length)) === state;
  } catch {
    return false;
  }
}

function clearBrowserOAuthState(res, provider, appUrl) {
  res.clearCookie('mc_oauth_state', browserStateCookieOptions(provider, appUrl));
}

module.exports = {
  browserStateCookieOptions,
  bindBrowserToOAuthState,
  hasBrowserOAuthState,
  clearBrowserOAuthState
};
