(() => {
  const url = new URL(location.href);
  const legacyPage = url.origin === 'https://eaglercraft-26-2-u1-cdn.u2471966200.workers.dev' &&
    url.pathname === '/eaglercraft-26.2-u1.html';
  const currentPage = url.origin === 'https://eaglercraft.com' &&
    url.pathname === '/play' && url.searchParams.get('version') === '26.2';
  if (!legacyPage && !currentPage) return;

  let lastState = null;
  let lastReportedAt = 0;
  let timer = null;

  function report(running, force = false) {
    const now = Date.now();
    if (!force && running === lastState && (!running || now - lastReportedAt < 20000)) return;
    lastState = running;
    lastReportedAt = now;
    chrome.runtime.sendMessage({ type: 'eaglercraft-state', active: running }).catch(() => {});
  }

  function inspectPage() {
    const canvases = [...document.querySelectorAll('canvas')];
    const running = document.visibilityState !== 'unloaded' && canvases.some(canvas => {
      const rect = canvas.getBoundingClientRect();
      return rect.width >= 200 && rect.height >= 150 && canvas.width >= 200 && canvas.height >= 150;
    });
    report(running);
  }

  const observer = new MutationObserver(inspectPage);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('visibilitychange', inspectPage);
  window.addEventListener('pagehide', () => {
    clearInterval(timer);
    observer.disconnect();
    report(false, true);
  }, { once: true });

  inspectPage();
  timer = setInterval(inspectPage, 3000);
})();
