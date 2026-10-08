(() => {
  let lastState = null;
  let timer = null;

  function inspectPage() {
    const canvases = [...document.querySelectorAll('canvas')];
    const running = document.visibilityState !== 'unloaded' && canvases.some(canvas => {
      const rect = canvas.getBoundingClientRect();
      return rect.width >= 200 && rect.height >= 150 && canvas.width >= 200 && canvas.height >= 150;
    });
    if (running === lastState) return;
    lastState = running;
    chrome.runtime.sendMessage({ type: 'eaglercraft-state', active: running }).catch(() => {});
  }

  const observer = new MutationObserver(inspectPage);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('visibilitychange', inspectPage);
  window.addEventListener('pagehide', () => {
    clearInterval(timer);
    observer.disconnect();
    chrome.runtime.sendMessage({ type: 'eaglercraft-state', active: false }).catch(() => {});
  }, { once: true });

  inspectPage();
  timer = setInterval(inspectPage, 3000);
})();
