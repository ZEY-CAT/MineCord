(() => {
  const pages = {
    '/': 'MineCord',
    '/download': 'Download MineCord'
  };
  const path = window.location.pathname;
  if (!Object.hasOwn(pages, path) || window.location.search || window.location.hash) return;

  const measurementId = 'G-SEMMPDBS1Y';
  const preference = 'minecord-analytics-consent-v1';
  const disabled = 'ga-disable-' + measurementId;
  const controls = document.querySelector('#analytics-settings');
  const age = controls.querySelector('select');
  const allow = controls.querySelector('[data-analytics-allow]');
  const decline = controls.querySelector('[data-analytics-decline]');
  const status = controls.querySelector('[role="status"]');
  let choice;
  let tag;

  function readChoice() {
    try { return localStorage.getItem(preference); } catch { return null; }
  }

  function updateConsent(next) {
    choice = next;
    window[disabled] = choice !== 'allowed';
    decline.textContent = choice === 'allowed' ? 'Turn off analytics' : 'Keep analytics off';
    status.textContent = choice === 'allowed' ? 'Analytics is on.' : 'Analytics is off.';
    if (choice !== 'allowed') {
      if (tag) {
        for (const name of ['_ga', '_ga_SEMMPDBS1Y']) {
          document.cookie = name + '=; Max-Age=0; Path=/; Secure; SameSite=Lax';
        }
      }
      return;
    }
    if (tag) return;

    window.dataLayer = window.dataLayer || [];
    function gtag() { window.dataLayer.push(arguments); }

    gtag('consent', 'default', {
      analytics_storage: 'granted',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied'
    });
    const pageLocation = 'https://minecord-8vg2.onrender.com' + path;
    gtag('js', new Date());
    gtag('config', measurementId, {
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      cookie_domain: 'none',
      cookie_expires: 2592000,
      cookie_update: false,
      page_location: pageLocation,
      page_referrer: ''
    });
    gtag('event', 'page_view', {
      send_to: measurementId,
      page_title: pages[path],
      page_location: pageLocation,
      page_referrer: ''
    });

    tag = document.createElement('script');
    tag.async = true;
    tag.referrerPolicy = 'no-referrer';
    tag.src = 'https://www.googletagmanager.com/gtag/js?id=' + measurementId;
    document.head.appendChild(tag);
  }

  function saveChoice(next) {
    try { localStorage.setItem(preference, next); } catch {}
    updateConsent(next);
  }

  controls.hidden = false;
  age.addEventListener('change', () => {
    allow.disabled = age.value !== 'adult';
    if (age.value === 'minor' || (age.value === 'unspecified' && choice === 'allowed')) saveChoice('declined');
  });
  allow.addEventListener('click', () => {
    if (age.value === 'adult') saveChoice('allowed');
  });
  decline.addEventListener('click', () => saveChoice('declined'));
  window.addEventListener('storage', event => {
    if (event.key === preference || event.key === null) updateConsent(readChoice());
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted) updateConsent(readChoice());
  });
  updateConsent(readChoice());
})();
