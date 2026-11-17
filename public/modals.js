(function() {
  'use strict';

  // Modal system for MineCord
  window.MCModal = {
    stack: [],

    // Create a modal element
    create(content, options = {}) {
      const modal = document.createElement('div');
      modal.className = 'mc-modal';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-labelledby', options.titleId || 'mc-modal-title');

      const overlay = document.createElement('div');
      overlay.className = 'mc-modal-overlay';
      overlay.onclick = () => options.closable !== false && this.close(modal);

      const panel = document.createElement('div');
      panel.className = 'mc-modal-panel';
      if (options.size) panel.classList.add('mc-modal-' + options.size);
      if (options.noClose) panel.classList.add('mc-modal-no-close');

      panel.innerHTML = content;
      modal.appendChild(overlay);
      modal.appendChild(panel);

      // Handle escape key
      const onKeyDown = (e) => {
        if (e.key === 'Escape' && options.closable !== false) {
          this.close(modal);
          document.removeEventListener('keydown', onKeyDown);
        }
      };
      document.addEventListener('keydown', onKeyDown);
      modal._cleanup = () => document.removeEventListener('keydown', onKeyDown);

      // Focus management
      const focusable = panel.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length) {
        focusable[0].focus();
      }

      document.body.appendChild(modal);
      this.stack.push(modal);

      // Trigger reflow for animation
      requestAnimationFrame(() => modal.classList.add('mc-modal-open'));

      return modal;
    },

    // Close a specific modal
    close(modal) {
      if (!modal || !modal.classList.contains('mc-modal')) return;

      modal.classList.remove('mc-modal-open');
      if (modal._cleanup) modal._cleanup();

      setTimeout(() => {
        if (modal.parentNode) modal.parentNode.removeChild(modal);
        const idx = this.stack.indexOf(modal);
        if (idx >= 0) this.stack.splice(idx, 1);
      }, 200);
    },

    // Close all modals
    closeAll() {
      [...this.stack].forEach(m => this.close(m));
    },

    // Alert modal
    alert(message, title = 'MineCord') {
      return new Promise(resolve => {
        const modal = this.create(`
          <div class="mc-modal-header">
            <h3 id="mc-modal-title">${esc(title)}</h3>
          </div>
          <div class="mc-modal-body">
            <p>${esc(message)}</p>
          </div>
          <div class="mc-modal-footer">
            <button class="primary" onclick="MCModal.close(this.closest('.mc-modal')); ${arguments[2] || ''}">OK</button>
          </div>
        `);
        modal.dataset.resolve = 'true';
      });
    },

    // Confirm modal
    confirm(message, title = 'Confirm') {
      return new Promise(resolve => {
        const modal = this.create(`
          <div class="mc-modal-header">
            <h3 id="mc-modal-title">${esc(title)}</h3>
          </div>
          <div class="mc-modal-body">
            <p>${esc(message)}</p>
          </div>
          <div class="mc-modal-footer">
            <button class="danger" onclick="MCModal.close(this.closest('.mc-modal')); (${arguments[2] || ''}) || true">Confirm</button>
            <button onclick="MCModal.close(this.closest('.mc-modal'))">Cancel</button>
          </div>
        `);
      });
    },

    // Prompt modal
    prompt(message, title = 'MineCord', defaultValue = '', type = 'text') {
      return new Promise(resolve => {
        const inputId = 'mc-prompt-' + Date.now();
        const modal = this.create(`
          <div class="mc-modal-header">
            <h3 id="mc-modal-title">${esc(title)}</h3>
          </div>
          <div class="mc-modal-body">
            <p>${esc(message)}</p>
            <input type="${esc(type)}" id="${inputId}" value="${esc(defaultValue)}" class="mc-modal-input" autofocus>
          </div>
          <div class="mc-modal-footer">
            <button class="primary" onclick="MCModal._promptResolve('${inputId}', this.closest('.mc-modal'), true)">OK</button>
            <button onclick="MCModal._promptResolve('${inputId}', this.closest('.mc-modal'), false)">Cancel</button>
          </div>
        `);
        MCModal._promptResolve = (id, modalEl, confirmed) => {
          const input = document.getElementById(id);
          const value = confirmed ? input.value : null;
          MCModal.close(modalEl);
          resolve(value);
          delete MCModal._promptResolve;
        };
      });
    },

    // Form modal for complex inputs
    form(fields, options = {}) {
      return new Promise(resolve => {
        const formId = 'mc-form-' + Date.now();
        let html = '';

        fields.forEach((field, i) => {
          const id = `${formId}-${i}`;
          const required = field.required ? 'required' : '';
          const placeholder = field.placeholder ? `placeholder="${esc(field.placeholder)}"` : '';

          let inputHtml = '';
          switch (field.type) {
            case 'select':
              inputHtml = `<select id="${id}" class="mc-modal-input" ${required}>${field.options.map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}</select>`;
              break;
            case 'textarea':
              inputHtml = `<textarea id="${id}" class="mc-modal-input" ${required} ${placeholder}></textarea>`;
              break;
            case 'checkbox':
              inputHtml = `<label class="mc-checkbox"><input type="checkbox" id="${id}" ${field.checked ? 'checked' : ''}> ${esc(field.label)}</label>`;
              break;
            default:
              inputHtml = `<input type="${field.type || 'text'}" id="${id}" class="mc-modal-input" value="${esc(field.value || '')}" ${required} ${placeholder}>`;
          }

          if (field.type !== 'checkbox') {
            html += `<label for="${id}">${esc(field.label)}</label>${inputHtml}`;
          } else {
            html += inputHtml;
          }
        });

        const modal = this.create(`
          <div class="mc-modal-header">
            <h3 id="mc-modal-title">${esc(options.title || 'MineCord')}</h3>
          </div>
          <div class="mc-modal-body">
            ${options.description ? `<p class="muted">${esc(options.description)}</p>` : ''}
            <form id="${formId}">${html}</form>
          </div>
          <div class="mc-modal-footer">
            <button class="primary" type="submit" form="${formId}">${esc(options.submitText || 'Submit')}</button>
            <button type="button" onclick="MCModal.close(this.closest('.mc-modal'))">${esc(options.cancelText || 'Cancel')}</button>
          </div>
        `);

        const form = modal.querySelector('form');
        form.onsubmit = (e) => {
          e.preventDefault();
          const data = {};
          let valid = true;

          fields.forEach((field, i) => {
            const input = document.getElementById(`${formId}-${i}`);
            if (!input) return;

            let value;
            if (field.type === 'checkbox') {
              value = input.checked;
            } else {
              value = input.value.trim();
              if (field.required && !value) {
                input.classList.add('error');
                valid = false;
              } else {
                input.classList.remove('error');
              }
            }
            data[field.name] = value;
          });

          if (valid) {
            MCModal.close(modal);
            resolve(data);
          }
        };
      });
    }
  };

  // Helper to escape HTML
  function esc(s) {
    return String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&','<':'<','>':'>',"'":''','"':'"'}[c]));
  }

  // Add modal styles
  const style = document.createElement('style');
  style.textContent = `
    .mc-modal {
      position: fixed;
      inset: 0;
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.15s ease;
    }
    .mc-modal.mc-modal-open {
      opacity: 1;
      pointer-events: auto;
    }
    .mc-modal-overlay {
      position: absolute;
      inset: 0;
      background: rgba(0,0,0,0.7);
      backdrop-filter: blur(2px);
    }
    .mc-modal-panel {
      position: relative;
      background: var(--side, #1e1f22);
      border: 1px solid var(--line, #202225);
      border-radius: 12px;
      box-shadow: 0 24px 48px rgba(0,0,0,0.4);
      max-width: 90vw;
      max-height: 90vh;
      display: flex;
      flex-direction: column;
      transform: scale(0.95);
      transition: transform 0.15s ease;
      pointer-events: auto;
    }
    .mc-modal-open .mc-modal-panel {
      transform: scale(1);
    }
    .mc-modal-sm { width: 360px; }
    .mc-modal-md { width: 480px; }
    .mc-modal-lg { width: 640px; }
    .mc-modal-header {
      padding: 16px 20px;
      border-bottom: 1px solid var(--line, #202225);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .mc-modal-header h3 {
      margin: 0;
      font-size: 18px;
      font-weight: 700;
      color: var(--text, #f2f4f7);
    }
    .mc-modal-body {
      padding: 20px;
      overflow-y: auto;
      max-height: 60vh;
    }
    .mc-modal-body p {
      margin: 0 0 12px;
      color: var(--text, #f2f4f7);
      line-height: 1.5;
    }
    .mc-modal-body p:last-child { margin-bottom: 0; }
    .mc-modal-input {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid var(--line, #202225);
      border-radius: 6px;
      background: var(--bg, #313338);
      color: var(--text, #f2f4f7);
      font: inherit;
      margin-top: 8px;
    }
    .mc-modal-input:focus {
      outline: none;
      border-color: var(--blue, #5865f2);
      box-shadow: 0 0 0 2px rgba(88,101,242,0.3);
    }
    .mc-modal-input.error {
      border-color: var(--red, #da373c);
    }
    .mc-checkbox {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      color: var(--text, #f2f4f7);
    }
    .mc-checkbox input { width: 18px; height: 18px; accent-color: var(--blue, #5865f2); }
    .mc-modal-footer {
      padding: 16px 20px;
      border-top: 1px solid var(--line, #202225);
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    .mc-modal-footer button {
      min-width: 80px;
    }
    .mc-modal.mc-modal-no-close .mc-modal-overlay {
      pointer-events: none;
    }
  `;
  document.head.appendChild(style);

  // Replace native prompt/alert/confirm with modal versions
  const nativePrompt = window.prompt;
  const nativeAlert = window.alert;
  const nativeConfirm = window.confirm;

  window.prompt = function(message, defaultValue) {
    return MCModal.prompt(message, 'MineCord', defaultValue || '');
  };

  window.alert = function(message) {
    return MCModal.alert(message, 'MineCord');
  };

  window.confirm = function(message) {
    return MCModal.confirm(message, 'Confirm');
  };
})();