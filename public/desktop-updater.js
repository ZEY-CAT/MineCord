(() => {
  const invoke = window.__TAURI__?.core?.invoke;
  if (typeof invoke !== 'function') return;

  const style = document.createElement('style');
  style.textContent = `
    #minecordDesktopUpdate{position:fixed;right:20px;bottom:20px;z-index:10000;width:min(420px,calc(100vw - 24px));padding:18px;background:#1e1f22;color:#f2f4f7;border:1px solid #5865f2;border-radius:10px;box-shadow:0 12px 40px #0009;font:18px VT323,Consolas,monospace}
    #minecordDesktopUpdate[hidden]{display:none}#minecordDesktopUpdate p{margin:8px 0;color:#b5bac1}#minecordDesktopUpdate progress{width:100%;accent-color:#5865f2}
    #minecordDesktopUpdate .updateActions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}#minecordDesktopUpdate button{font:inherit}
  `;
  document.head.appendChild(style);

  const card = document.createElement('section');
  card.id = 'minecordDesktopUpdate';
  card.hidden = true;
  card.setAttribute('role', 'status');
  card.innerHTML = '<b id="minecordUpdateTitle">MINECORD update</b><p id="minecordUpdateText"></p><progress id="minecordUpdateProgressBar" hidden></progress><div class="updateActions"><button id="minecordUpdateLater">Later</button><button id="minecordUpdateInstall" class="primary">Install and restart</button></div>';
  document.body.appendChild(card);

  let offeredVersion = '';
  const progressBar = card.querySelector('#minecordUpdateProgressBar');
  const text = card.querySelector('#minecordUpdateText');
  const install = card.querySelector('#minecordUpdateInstall');
  const later = card.querySelector('#minecordUpdateLater');

  function offerUpdate(update) {
    if (!update?.version || sessionStorage.getItem('minecord-dismissed-update') === update.version) return;
    offeredVersion = update.version;
    card.querySelector('#minecordUpdateTitle').textContent = `MINECORD ${update.version} is ready`;
    text.textContent = update.notes || 'A signed MINECORD update is available.';
    progressBar.hidden = true;
    install.disabled = false;
    install.textContent = 'Install and restart';
    card.hidden = false;
  }

  window.minecordUpdateAvailable = offerUpdate;
  window.minecordUpdateProgress = (received, total) => {
    progressBar.hidden = false;
    if (Number.isFinite(total) && total > 0) {
      progressBar.max = total;
      progressBar.value = Math.min(received, total);
      text.textContent = `Downloading verified update… ${Math.floor(received / total * 100)}%`;
    } else {
      progressBar.removeAttribute('value');
      text.textContent = 'Downloading and verifying the signed update…';
    }
  };

  later.addEventListener('click', () => {
    sessionStorage.setItem('minecord-dismissed-update', offeredVersion);
    card.hidden = true;
  });

  install.addEventListener('click', async () => {
    install.disabled = true;
    later.disabled = true;
    progressBar.hidden = false;
    progressBar.removeAttribute('value');
    text.textContent = 'Preparing the signed update…';
    try {
      await invoke('install_update');
    } catch (error) {
      text.textContent = typeof error === 'string' ? error : 'The signed update could not be installed. Your current version is unchanged.';
      install.disabled = false;
      later.disabled = false;
      progressBar.hidden = true;
    }
  });

  async function checkForUpdates() {
    try {
      if (!(await invoke('updates_enabled'))) return;
      const update = await invoke('check_update');
      if (update) offerUpdate(update);
    } catch (error) {
      console.warn('MINECORD update check failed; the current app remains available.');
    }
  }

  setTimeout(checkForUpdates, 10000);
  setInterval(checkForUpdates, 6 * 60 * 60 * 1000);
})();
