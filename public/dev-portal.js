(() => {
  const $ = id => document.getElementById(id);
  const state = {
    directories: new Map(), tabs: new Map(), activePath: null,
    toastTimer: null, searchTimer: null, saveTimers: new Map(),
    staged: new Set(), secretKeys: [], githubPollTimer: null, user: null,
    aiPreference: 'openai', aiProviders: null, aiConversation: null, aiProposal: null, aiBusy: false
  };
  const editor = $('editorInput');

  async function request(url, options = {}) {
    const response = await fetch(url, { credentials: 'same-origin', ...options });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && !url.endsWith('/login')) showLogin('Your portal session expired. Sign in again.');
      throw new Error(result.error || `Request failed (${response.status}).`);
    }
    return result;
  }

  function showToast(message, isError = false) {
    const toast = $('toast');
    toast.textContent = message;
    toast.classList.toggle('error', isError);
    toast.classList.add('visible');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toast.classList.remove('visible'), 3500);
  }

  function showLogin(message = '') {
    state.user = null;
    $('portalApp').hidden = true;
    $('portalNavigation').hidden = true;
    $('loginPanel').hidden = false;
    $('loginError').textContent = message;
  }

  function showPortal(user) {
    state.user = user;
    $('loginPanel').hidden = true;
    $('portalApp').hidden = false;
    $('portalNavigation').hidden = false;
    $('workspaceOwner').textContent = `${user.username} · ${user.role}`;
    $('ownerPanel').hidden = user.role !== 'owner';
    loadWorkspace();
    loadGitHubStatus();
    loadAiProviders();
    if (user.role === 'owner') {
      loadOwnerControls();
      loadAiOwnerConfig();
    }
  }

  function setConnection(message, kind = '') {
    const node = $('connectionState');
    node.textContent = message;
    node.dataset.state = kind;
  }

  function createFileButton(entry, parent) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `file-entry ${entry.type}`;
    row.dataset.path = entry.path;
    row.title = entry.path;
    const icon = document.createElement('span');
    icon.textContent = entry.type === 'directory' ? '▸' : '·';
    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = entry.name;
    row.append(icon, name);
    if (entry.type === 'file') {
      const size = document.createElement('span');
      size.className = 'file-size';
      size.textContent = `${Math.ceil(entry.size / 1024)} KB`;
      row.append(size);
      row.disabled = entry.size > 128 * 1024;
      row.title = row.disabled ? 'Files over 128 KB cannot be opened.' : entry.path;
      row.addEventListener('click', () => openFile(entry.path));
    } else {
      const children = document.createElement('div');
      children.className = 'file-children';
      children.hidden = true;
      row.addEventListener('click', async () => {
        const opening = children.hidden;
        children.hidden = !opening;
        icon.textContent = opening ? '▾' : '▸';
        if (opening && !children.dataset.loaded) {
          children.dataset.loaded = 'true';
          await renderDirectory(entry.path, children);
        }
      });
      parent.append(row, children);
      return;
    }
    parent.append(row);
  }

  async function renderDirectory(directory, parent) {
    try {
      const result = state.directories.get(directory)
        || await request(`/dev/api/source/files?path=${encodeURIComponent(directory)}`);
      state.directories.set(directory, result);
      for (const entry of result.entries) createFileButton(entry, parent);
    } catch (error) {
      const row = document.createElement('div');
      row.className = 'muted';
      row.textContent = error.message;
      parent.append(row);
    }
  }

  async function loadFileTree() {
    state.directories.clear();
    const tree = $('fileTree');
    tree.replaceChildren();
    $('searchResults').hidden = true;
    tree.hidden = false;
    await renderDirectory('', tree);
  }

  async function runFileSearch(query) {
    const tree = $('fileTree');
    const resultsNode = $('searchResults');
    if (query.trim().length < 2) {
      resultsNode.hidden = true;
      tree.hidden = false;
      return;
    }
    try {
      const result = await request(`/dev/api/source/search?q=${encodeURIComponent(query.trim())}`);
      resultsNode.replaceChildren();
      for (const entry of result.results) createFileButton(entry, resultsNode);
      if (!result.results.length) {
        const empty = document.createElement('div');
        empty.className = 'muted';
        empty.textContent = 'No matching file names.';
        resultsNode.append(empty);
      }
      if (result.truncated) {
        const note = document.createElement('div');
        note.className = 'muted';
        note.textContent = 'Results limited; refine the search.';
        resultsNode.append(note);
      }
      tree.hidden = true;
      resultsNode.hidden = false;
    } catch (error) {
      showToast(error.message, true);
    }
  }

  async function openFile(filePath) {
    if (state.tabs.has(filePath)) {
      state.activePath = filePath;
      renderEditor();
      return;
    }
    try {
      const file = await request(`/dev/api/source/file?path=${encodeURIComponent(filePath)}`);
      state.tabs.set(filePath, {
        path: file.path, content: file.content, savedContent: file.content,
        originalContent: file.originalContent, modified: file.modified, saving: false
      });
      state.activePath = filePath;
      renderEditor();
    } catch (error) {
      showToast(error.message, true);
    }
  }

  function activeTab() {
    return state.activePath ? state.tabs.get(state.activePath) : null;
  }

  function renderTabs() {
    const container = $('tabs');
    container.replaceChildren();
    for (const tab of state.tabs.values()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `tab ${tab.path === state.activePath ? 'active' : ''}`;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(tab.path === state.activePath));
      button.title = tab.path;
      const label = document.createElement('span');
      label.textContent = tab.path.split('/').pop();
      button.append(label);
      if (tab.content !== tab.savedContent || tab.modified) {
        const dirty = document.createElement('span');
        dirty.className = 'dirty-dot';
        dirty.textContent = '●';
        dirty.setAttribute('aria-label', tab.content !== tab.savedContent ? 'Unsaved edits' : 'Workspace changes');
        button.append(dirty);
      }
      button.addEventListener('click', () => {
        state.activePath = tab.path;
        renderEditor();
      });
      const close = document.createElement('span');
      close.className = 'tab-close';
      close.textContent = '×';
      close.setAttribute('role', 'button');
      close.setAttribute('aria-label', `Close ${tab.path.split('/').pop()}`);
      close.addEventListener('click', event => {
        event.stopPropagation();
        if (tab.content !== tab.savedContent && !window.confirm(`Discard unsaved edits to ${tab.path.split('/').pop()}?`)) return;
        clearTimeout(state.saveTimers.get(tab.path));
        state.saveTimers.delete(tab.path);
        state.tabs.delete(tab.path);
        if (state.activePath === tab.path) state.activePath = [...state.tabs.keys()].pop() || null;
        renderEditor();
      });
      button.append(close);
      container.append(button);
    }
  }

  function highlightCode(value, filePath) {
    const escapeHtml = text => text.replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
    const extension = filePath.split('.').pop().toLowerCase();
    if (!['js', 'cjs', 'mjs', 'ts', 'jsx', 'tsx', 'json', 'css', 'rs', 'py'].includes(extension)) return escapeHtml(value);
    const pattern = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:async|await|break|case|catch|class|const|continue|def|else|export|extends|false|fn|for|from|function|if|impl|import|in|let|match|mod|new|null|pub|return|self|static|struct|super|switch|this|throw|true|try|type|var|while|use)\b|\b\d+(?:\.\d+)?\b)/g;
    let output = '';
    let cursor = 0;
    for (const match of value.matchAll(pattern)) {
      const token = match[0];
      let kind = 'number';
      if (/^(?:\/\/|\/\*)/.test(token)) kind = 'comment';
      else if (/^["'`]/.test(token)) kind = 'string';
      else if (/^[A-Za-z]/.test(token)) kind = 'keyword';
      output += escapeHtml(value.slice(cursor, match.index));
      output += `<span class="token-${kind}">${escapeHtml(token)}</span>`;
      cursor = match.index + token.length;
    }

    function appendAssistantContent(node, value) {
      const pattern = /```([A-Za-z0-9_-]*)\s*\n([\s\S]*?)```/g;
      let cursor = 0;
      for (const match of value.matchAll(pattern)) {
        if (match.index > cursor) node.append(document.createTextNode(value.slice(cursor, match.index)));
        const wrapper = document.createElement('div');
        const toolbar = document.createElement('div');
        toolbar.className = 'ai-code-toolbar';
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.textContent = 'Copy';
        copy.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(match[2]);
            showToast('Code copied.');
          } catch { showToast('Clipboard access is unavailable.', true); }
        });
        toolbar.append(copy);
        if (match[1].toLowerCase() === 'json') {
          const format = document.createElement('button');
          format.type = 'button';
          format.textContent = 'Format JSON';
          format.addEventListener('click', () => {
            try {
              const formatted = JSON.stringify(JSON.parse(match[2]), null, 2);
              code.innerHTML = highlightCode(formatted, 'response.json');
              showToast('JSON formatted for display.');
            } catch { showToast('This code block is not valid JSON.', true); }
          });
          toolbar.append(format);
        }
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        const extension = match[1].toLowerCase();
        code.innerHTML = highlightCode(match[2], `response.${['js','ts','jsx','tsx','json','css','rs','py'].includes(extension) ? extension : 'txt'}`);
        pre.append(code);
        wrapper.append(toolbar, pre);
        node.append(wrapper);
        cursor = match.index + match[0].length;
      }
      if (cursor < value.length) node.append(document.createTextNode(value.slice(cursor)));
    }

    function appendAiMessage(role, content) {
      const node = document.createElement('article');
      node.className = `ai-message ${role}`;
      if (role === 'assistant') appendAssistantContent(node, content);
      else node.textContent = content;
      $('aiMessages').append(node);
      node.scrollIntoView({ block: 'nearest' });
      return node;
    }

    function renderConversationMessages(messages) {
      const node = $('aiMessages');
      node.replaceChildren();
      if (!messages.length) {
        const empty = document.createElement('p');
        empty.className = 'muted';
        empty.textContent = 'Ask about MineCord, attach permitted open files, or include safe test output.';
        node.append(empty);
        return;
      }
      for (const message of messages) appendAiMessage(message.role, message.content);
    }

    function renderAiProvider() {
      const provider = $('aiProvider').value;
      const openai = state.aiProviders?.providers?.openai;
      const copilot = state.aiProviders?.providers?.copilot;
      const isCopilot = provider === 'copilot';
      $('copilotWorkflow').hidden = !isCopilot;
      $('aiForm').hidden = isCopilot || !openai?.available;
      $('aiMessages').hidden = isCopilot;
      $('aiProposal').hidden = isCopilot;
      $('aiConversation').disabled = isCopilot;
      $('newAiConversation').disabled = isCopilot || !openai?.available;
      $('clearAiConversation').disabled = isCopilot || !state.aiConversation;
      $('aiSend').disabled = isCopilot || !openai?.available || state.aiBusy;
      $('aiProviderMessage').textContent = isCopilot
        ? copilot?.message || 'Copilot opens only in an authorized GitHub environment.'
        : openai?.available ? `OpenAI is configured for model ${openai.model}. Conversation history is private to your portal account.`
          : 'OpenAI is unavailable. The owner must configure an encrypted API key before chat can be used.';
      $('aiConnection').textContent = isCopilot ? 'External Copilot workflow' : openai?.available ? `Configured · ${openai.model}` : 'OpenAI unavailable';
      $('aiConnection').dataset.state = isCopilot || openai?.available ? 'ready' : 'error';
    }

    async function loadAiProviders() {
      try {
        state.aiProviders = await request('/dev/api/ai/providers');
        state.aiPreference = state.aiProviders.preference;
        $('aiProvider').value = state.aiPreference;
        renderAiProvider();
        await loadAiConversations();
      } catch (error) {
        $('aiConnection').textContent = error.message;
        $('aiConnection').dataset.state = 'error';
      }
    }

    async function loadAiConversations(selectedId = state.aiConversation) {
      const result = await request('/dev/api/ai/conversations?provider=openai');
      const select = $('aiConversation');
      select.replaceChildren();
      for (const conversation of result.conversations) {
        const option = document.createElement('option');
        option.value = conversation.id;
        option.textContent = `${conversation.title} · ${new Date(conversation.updatedAt).toLocaleString()}`;
        select.append(option);
      }
      const selected = result.conversations.find(item => item.id === selectedId) || result.conversations[0];
      state.aiConversation = selected?.id || null;
      select.value = state.aiConversation || '';
      $('clearAiConversation').disabled = !state.aiConversation;
      if (selected) {
        const detail = await request(`/dev/api/ai/conversations/${encodeURIComponent(selected.id)}`);
        renderConversationMessages(detail.conversation.messages);
      } else {
        renderConversationMessages([]);
      }
    }

    async function createAiConversation() {
      if (!state.aiProviders?.providers?.openai?.available) return;
      try {
        const result = await request('/dev/api/ai/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: 'openai' })
        });
        state.aiConversation = result.conversation.id;
        await loadAiConversations(state.aiConversation);
        renderAiProvider();
      } catch (error) { showToast(error.message, true); }
    }

    async function setAiProvider(provider) {
      try {
        const result = await request('/dev/api/ai/preference', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider })
        });
        state.aiPreference = result.preference;
        renderAiProvider();
      } catch (error) {
        $('aiProvider').value = state.aiPreference;
        showToast(error.message, true);
      }
    }

    function renderAiProposal(proposal) {
      const panel = $('aiProposal');
      panel.replaceChildren();
      state.aiProposal = proposal;
      if (!proposal) {
        panel.hidden = true;
        return;
      }
      panel.hidden = false;
      const heading = document.createElement('h3');
      heading.textContent = 'Proposed code changes · review before applying';
      panel.append(heading);
      for (const file of proposal.files) {
        const details = document.createElement('details');
        details.className = 'ai-proposal-file';
        details.open = true;
        const summary = document.createElement('summary');
        summary.textContent = file.path;
        const columns = document.createElement('div');
        columns.className = 'ai-proposal-diff';
        const before = document.createElement('pre');
        const after = document.createElement('pre');
        renderDiffSide(before, lineDiff(file.before, file.content), false);
        renderDiffSide(after, lineDiff(file.before, file.content), true);
        columns.append(before, after);
        details.append(summary, columns);
        panel.append(details);
      }
      const actions = document.createElement('div');
      actions.className = 'ai-proposal-actions';
      const apply = document.createElement('button');
      apply.type = 'button';
      apply.className = 'primary';
      apply.textContent = 'Approve and apply to my workspace';
      apply.addEventListener('click', applyAiProposal);
      const reject = document.createElement('button');
      reject.type = 'button';
      reject.className = 'secondary';
      reject.textContent = 'Reject proposal';
      reject.addEventListener('click', rejectAiProposal);
      actions.append(apply, reject);
      panel.append(actions);
    }

    async function applyAiProposal() {
      if (!state.aiProposal || !window.confirm('Apply the reviewed code changes to your isolated workspace?')) return;
      try {
        const result = await request(`/dev/api/ai/proposals/${encodeURIComponent(state.aiProposal.id)}/apply`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirm: true })
        });
        for (const filePath of result.files) {
          const tab = state.tabs.get(filePath);
          const patch = state.aiProposal.files.find(item => item.path === filePath);
          if (tab && patch) {
            tab.content = patch.content;
            tab.savedContent = patch.content;
            tab.modified = patch.content !== tab.originalContent;
          }
        }
        renderAiProposal(null);
        renderEditor();
        await refreshWorkspace();
        showToast('Approved proposal applied to your isolated workspace.');
      } catch (error) { showToast(error.message, true); }
    }

    async function rejectAiProposal() {
      if (!state.aiProposal) return;
      try {
        await request(`/dev/api/ai/proposals/${encodeURIComponent(state.aiProposal.id)}`, { method: 'DELETE' });
        renderAiProposal(null);
        showToast('AI proposal rejected.');
      } catch (error) { showToast(error.message, true); }
    }

    async function streamAiResponse(conversationId, message, context) {
      const response = await fetch(`/dev/api/ai/conversations/${encodeURIComponent(conversationId)}/chat`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, context })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `AI request failed (${response.status}).`);
      }
      const assistant = appendAiMessage('assistant', '');
      const decoder = new TextDecoder();
      const reader = response.body.getReader();
      let buffer = '';
      let output = '';
      let completed = null;
      const processBlock = block => {
        const eventName = block.split(/\r?\n/).find(line => line.startsWith('event:'))?.slice(6).trim();
        const data = block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!data) return;
        const parsed = JSON.parse(data);
        if (eventName === 'delta') {
          output += parsed.delta;
          assistant.textContent = output;
          assistant.scrollIntoView({ block: 'nearest' });
        } else if (eventName === 'done') completed = parsed;
        else if (eventName === 'error') throw new Error(parsed.error || 'AI response failed.');
      };
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          processBlock(block);
        }
      }
      if (buffer.trim()) processBlock(buffer);
      if (!completed) throw new Error('AI response ended before completion.');
      assistant.replaceChildren();
      appendAssistantContent(assistant, output);
      renderAiProposal(completed.proposal);
      await loadAiConversations(conversationId);
    }
    return output + escapeHtml(value.slice(cursor));
  }

  function renderCode() {
    const tab = activeTab();
    if (!tab) return;
    $('highlight').innerHTML = `${highlightCode(tab.content, tab.path)}${tab.content.endsWith('\n') ? ' ' : ''}`;
    $('gutter').textContent = Array.from({ length: tab.content.split('\n').length }, (_, index) => index + 1).join('\n');
    $('languageLabel').textContent = tab.path.split('.').pop().toUpperCase();
    syncEditorScroll();
    updateLineLabel();
  }

  function syncEditorScroll() {
    $('highlight').scrollTop = editor.scrollTop;
    $('highlight').scrollLeft = editor.scrollLeft;
    $('gutter').scrollTop = editor.scrollTop;
  }

  function updateLineLabel() {
    const before = editor.value.slice(0, editor.selectionStart);
    $('lineLabel').textContent = `Ln ${before.split('\n').length}, Col ${before.length - before.lastIndexOf('\n')}`;
  }

  function renderEditor() {
    const tab = activeTab();
    renderTabs();
    $('editorEmpty').classList.toggle('visible', !tab);
    $('codeArea').hidden = !tab;
    editor.disabled = !tab;
    $('saveButton').disabled = !tab || tab.saving || tab.content === tab.savedContent;
    $('diffButton').disabled = !tab || (!tab.modified && tab.content === tab.savedContent);
    $('replaceButton').disabled = !tab;
    if (!tab) {
      $('saveState').textContent = 'No file open';
      return;
    }
    editor.value = tab.content;
    $('saveState').textContent = tab.saving ? 'Saving workspace…'
      : tab.content !== tab.savedContent ? 'Unsaved changes' : tab.modified ? 'Workspace saved' : 'Read-only source';
    renderCode();
  }

  function updateWorkspaceCount(files) {
    $('workspaceCount').textContent = files.length
      ? `${files.length} modified ${files.length === 1 ? 'file' : 'files'} in your isolated workspace.`
      : 'No workspace changes saved.';
    renderStagedFiles(files);
  }

  function renderStagedFiles(files) {
    const node = $('stagedFiles');
    node.replaceChildren();
    if (!files.length) {
      node.textContent = 'Save files to prepare a reviewed change.';
      $('pushButton').disabled = true;
      return;
    }
    for (const file of files) {
      const row = document.createElement('label');
      row.className = 'stage-row';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = state.staged.has(file);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) state.staged.add(file);
        else state.staged.delete(file);
        $('pushButton').disabled = !state.staged.size;
      });
      const label = document.createElement('span');
      label.textContent = file;
      const diff = document.createElement('button');
      diff.type = 'button';
      diff.textContent = 'Diff';
      diff.addEventListener('click', event => {
        event.preventDefault();
        openFile(file).then(showDiff);
      });
      row.append(checkbox, label, diff);
      node.append(row);
    }
    $('pushButton').disabled = !state.staged.size;
  }

  async function refreshWorkspace() {
    const result = await request('/dev/api/source/workspace');
    updateWorkspaceCount(result.modifiedFiles);
  }

  async function loadWorkspace() {
    setConnection('Loading approved workspace…');
    try {
      const result = await request('/dev/api/source/');
      setConnection(`Signed in as ${result.developer.username}`, 'ready');
      updateWorkspaceCount(result.workspace.modifiedFiles);
      await loadFileTree();
    } catch (error) {
      setConnection(error.message, 'error');
    }
  }

  async function saveTab(tab) {
    if (tab.saving) {
      tab.saveAgain = true;
      return;
    }
    tab.saving = true;
    const snapshot = tab.content;
    if (tab.path === state.activePath) renderEditor();
    try {
      const result = await request('/dev/api/source/file', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: tab.path, content: snapshot })
      });
      tab.savedContent = snapshot;
      tab.modified = result.modified;
      await refreshWorkspace();
      if (snapshot === tab.content) showToast(result.modified ? 'Saved to your isolated workspace.' : 'Workspace matches the repository version.');
    } catch (error) {
      showToast(error.message, true);
    } finally {
      tab.saving = false;
      if (tab.path === state.activePath) renderEditor();
      if (tab.saveAgain) {
        tab.saveAgain = false;
        saveTab(tab);
      }
    }
  }

  function scheduleSave(tab) {
    clearTimeout(state.saveTimers.get(tab.path));
    if (tab.saving) {
      tab.saveAgain = true;
      return;
    }
    state.saveTimers.set(tab.path, setTimeout(() => {
      state.saveTimers.delete(tab.path);
      if (tab.content !== tab.savedContent) saveTab(tab);
    }, 1000));
  }

  function saveActiveFile() {
    const tab = activeTab();
    if (!tab) return;
    tab.content = editor.value;
    clearTimeout(state.saveTimers.get(tab.path));
    state.saveTimers.delete(tab.path);
    saveTab(tab);
  }

  function lineDiff(original, current) {
    const before = original.split('\n');
    const after = current.split('\n');
    if (before.length * after.length > 2_000_000) {
      const entries = [];
      for (let index = 0; index < Math.max(before.length, after.length); index += 1) {
        if (before[index] === after[index]) entries.push({ type: 'same', text: before[index] || '' });
        else {
          if (index < before.length) entries.push({ type: 'removed', text: before[index] });
          if (index < after.length) entries.push({ type: 'added', text: after[index] });
        }
      }
      return { entries, fallback: true };
    }
    const table = Array.from({ length: before.length + 1 }, () => new Uint32Array(after.length + 1));
    for (let left = before.length - 1; left >= 0; left -= 1) {
      for (let right = after.length - 1; right >= 0; right -= 1) {
        table[left][right] = before[left] === after[right]
          ? table[left + 1][right + 1] + 1
          : Math.max(table[left + 1][right], table[left][right + 1]);
      }
    }
    const entries = [];
    let left = 0;
    let right = 0;
    while (left < before.length && right < after.length) {
      if (before[left] === after[right]) {
        entries.push({ type: 'same', text: before[left] });
        left += 1;
        right += 1;
      } else if (table[left + 1][right] >= table[left][right + 1]) {
        entries.push({ type: 'removed', text: before[left++] });
      } else {
        entries.push({ type: 'added', text: after[right++] });
      }
    }
    while (left < before.length) entries.push({ type: 'removed', text: before[left++] });
    while (right < after.length) entries.push({ type: 'added', text: after[right++] });
    return { entries, fallback: false };
  }

  function renderDiffSide(node, diff, updated) {
    node.replaceChildren();
    for (const entry of diff.entries) {
      const line = document.createElement('span');
      if (entry.type === 'same') {
        line.className = 'diff-same';
        line.textContent = `  ${entry.text}\n`;
      } else if ((entry.type === 'added') === updated) {
        line.className = entry.type === 'added' ? 'diff-added' : 'diff-removed';
        line.textContent = `${entry.type === 'added' ? '+ ' : '− '}${entry.text}\n`;
      } else {
        line.className = 'diff-empty';
        line.textContent = '\n';
      }
      node.append(line);
    }
  }

  function showDiff(tab = activeTab()) {
    if (!tab) return;
    const diff = lineDiff(tab.originalContent, tab.content);
    $('diffTitle').textContent = `${diff.fallback ? 'Line comparison' : 'File comparison'} · ${tab.path}`;
    renderDiffSide($('diffOriginal'), diff, false);
    renderDiffSide($('diffCurrent'), diff, true);
    $('diffDialog').showModal();
  }

  async function loadGitHubStatus() {
    try {
      const result = await request('/dev/api/github/status');
      if (!result.configured) {
        $('githubStatus').textContent = 'GitHub authorization is not configured in DEV-LOGINS.json.';
        $('githubConnect').disabled = true;
        return;
      }
      if (!result.connected) {
        $('githubStatus').textContent = 'Connect your own GitHub account to inspect repository permissions.';
        return;
      }
      $('githubStatus').textContent = `${result.login} · ${result.repository} · ${result.canPush ? 'push allowed' : 'read-only'}`;
      $('githubConnect').textContent = 'GitHub connected';
      $('githubConnect').disabled = true;
      $('branchSelect').disabled = false;
      $('loadCommits').disabled = false;
      $('loadChecks').disabled = false;
      await loadBranches();
    } catch (error) {
      $('githubStatus').textContent = error.message;
    }
  }

  async function loadBranches() {
    const result = await request('/dev/api/github/branches');
    const select = $('branchSelect');
    select.replaceChildren();
    for (const branch of result.branches) {
      const option = document.createElement('option');
      option.value = branch.name;
      option.textContent = branch.name;
      select.append(option);
    }
  }

  async function loadCommits() {
    try {
      const branch = $('branchSelect').value || 'main';
      const result = await request(`/dev/api/github/commits?branch=${encodeURIComponent(branch)}`);
      const list = $('commitList');
      list.replaceChildren();
      for (const commit of result.commits) {
        const item = document.createElement('div');
        item.className = 'commit-item';
        item.textContent = `${commit.sha.slice(0, 7)} · ${commit.message.split('\n')[0]} · ${commit.author}`;
        list.append(item);
      }
      if (!result.commits.length) list.textContent = 'No commits found.';
    } catch (error) {
      showToast(error.message, true);
    }
  }

  async function loadChecks() {
    try {
      const branch = $('branchSelect').value || 'main';
      const result = await request(`/dev/api/github/checks?branch=${encodeURIComponent(branch)}`);
      const list = $('checkList');
      list.replaceChildren();
      for (const check of result.checks) {
        const item = document.createElement(check.url ? 'a' : 'div');
        item.className = 'commit-item';
        item.textContent = `${check.name} · ${check.status}${check.conclusion ? ` · ${check.conclusion}` : ''}`;
        if (check.url) {
          item.href = check.url;
          item.target = '_blank';
          item.rel = 'noopener noreferrer';
        }
        list.append(item);
      }
      if (!result.checks.length) list.textContent = 'No checks reported for this branch yet.';
    } catch (error) {
      showToast(error.message, true);
    }
  }

  async function startGitHubDeviceFlow() {
    try {
      const result = await request('/dev/api/github/device', { method: 'POST' });
      $('githubUserCode').textContent = result.userCode;
      $('githubVerifyLink').href = result.verificationUri;
      $('githubDevice').hidden = false;
      window.open(result.verificationUri, '_blank', 'noopener,noreferrer');
    } catch (error) {
      showToast(error.message, true);
    }
  }

  async function pollGitHubDeviceFlow() {
    try {
      const result = await request('/dev/api/github/device/poll', { method: 'POST' });
      if (result.pending) {
        showToast('GitHub has not approved the authorization yet.');
        return;
      }
      $('githubDevice').hidden = true;
      showToast(`Connected GitHub account ${result.login}.`);
      await loadGitHubStatus();
    } catch (error) {
      showToast(error.message, true);
    }
  }

  async function loadOwnerControls() {
    try {
      const [users, vault] = await Promise.all([
        request('/dev/api/users'),
        request('/dev/api/secrets')
      ]);
      renderUsers(users.users);
      state.secretKeys = vault.keys;
      renderVault();
      $('vaultStatus').textContent = vault.encryptionConfigured
        ? (vault.legacyEntriesNeedMigration ? 'Legacy plaintext values are being encrypted on access.' : 'Vault encryption is configured.')
        : 'Vault encryption is not configured. Set MINECORD_DEV_VAULT_KEY before saving credentials.';
    } catch (error) {
      showToast(error.message, true);
    }
  }

  async function loadAiOwnerConfig() {
    $('aiOwnerConfig').hidden = state.user?.role !== 'owner';
    if (state.user?.role !== 'owner') return;
    try {
      const config = await request('/dev/api/ai/admin/config');
      $('openaiModel').value = config.model;
      $('aiOwnerStatus').textContent = config.vaultEncryptionConfigured
        ? (config.openaiConfigured ? 'Encrypted OpenAI credentials are configured. The saved key is never returned.' : 'Encryption is ready; add an OpenAI API key to enable chat.')
        : 'Set MINECORD_DEV_VAULT_KEY to a private 32-byte hexadecimal Render environment secret before saving credentials.';
      $('aiOwnerForm').querySelectorAll('input,button').forEach(control => { control.disabled = !config.vaultEncryptionConfigured; });
      $('removeOpenaiKey').disabled = !config.vaultEncryptionConfigured || !config.openaiConfigured;
    } catch (error) {
      $('aiOwnerStatus').textContent = error.message;
    }
  }

  async function saveAiOwnerConfig(event) {
    event.preventDefault();
    const body = { model: $('openaiModel').value.trim() };
    if ($('openaiKey').value) body.apiKey = $('openaiKey').value;
    $('aiOwnerStatus').textContent = 'Saving provider configuration…';
    try {
      const result = await request('/dev/api/ai/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      $('openaiKey').value = '';
      $('aiOwnerStatus').textContent = result.openaiConfigured
        ? `Configuration saved. The key remains encrypted and hidden; model: ${result.model}.`
        : `Model saved: ${result.model}. Add an API key to enable OpenAI.`;
      await loadAiProviders();
    } catch (error) {
      $('aiOwnerStatus').textContent = error.message;
    }
  }

  async function removeAiOwnerKey() {
    if (!window.confirm('Remove the encrypted OpenAI API key from the owner vault?')) return;
    try {
      const result = await request('/dev/api/ai/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearApiKey: true })
      });
      $('aiOwnerStatus').textContent = `OpenAI key removed. Model setting remains ${result.model}.`;
      await loadAiProviders();
      await loadAiOwnerConfig();
    } catch (error) { $('aiOwnerStatus').textContent = error.message; }
  }

  async function submitAiMessage(event) {
    event.preventDefault();
    const message = $('aiPrompt').value.trim();
    if (!message || state.aiBusy || $('aiProvider').value !== 'openai') return;
    if (!state.aiProviders?.providers?.openai?.available) {
      showToast('OpenAI is unavailable; the owner must configure its credentials.', true);
      return;
    }
    let conversationId = state.aiConversation;
    if (!conversationId) {
      await createAiConversation();
      conversationId = state.aiConversation;
      if (!conversationId) return;
    }
    const paths = $('attachOpenFiles').checked ? [...state.tabs.keys()].slice(0, 8) : [];
    const tab = activeTab();
    const selection = tab && editor.selectionStart !== editor.selectionEnd
      ? editor.value.slice(editor.selectionStart, editor.selectionEnd) : '';
    if (selection && !paths.includes(tab.path)) {
      if (paths.length === 8) paths.pop();
      paths.push(tab.path);
    }
    const context = {
      paths,
      selectedFile: selection ? tab.path : '',
      selectedCode: selection,
      buildOutput: $('aiBuildOutput').value.trim()
    };
    $('aiPrompt').value = '';
    appendAiMessage('user', message);
    state.aiBusy = true;
    $('aiSend').textContent = 'Connecting…';
    $('aiConnection').textContent = 'Generating response…';
    renderAiProvider();
    try {
      await streamAiResponse(conversationId, message, context);
      $('aiBuildOutput').value = '';
    } catch (error) {
      appendAiMessage('assistant', `Request failed: ${error.message}`);
      showToast(error.message, true);
    } finally {
      state.aiBusy = false;
      $('aiSend').textContent = 'Send';
      renderAiProvider();
    }
  }

  async function clearAiConversation() {
    if (!state.aiConversation || !window.confirm('Delete this conversation and its private history?')) return;
    try {
      await request(`/dev/api/ai/conversations/${encodeURIComponent(state.aiConversation)}`, { method: 'DELETE' });
      state.aiConversation = null;
      renderAiProposal(null);
      await loadAiConversations(null);
      renderAiProvider();
      showToast('Conversation deleted.');
    } catch (error) { showToast(error.message, true); }
  }

  async function changePortalPassword(event) {
    event.preventDefault();
    const currentPassword = $('currentPortalPassword').value;
    const newPassword = $('newPortalPassword').value;
    $('passwordStatus').textContent = 'Updating password…';
    try {
      await request('/dev/api/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword })
      });
      $('passwordForm').reset();
      $('passwordStatus').textContent = 'Password changed. Other active sessions have been signed out.';
    } catch (error) {
      $('passwordStatus').textContent = error.message;
    }
  }

  function renderUsers(users) {
    const node = $('userList');
    node.replaceChildren();
    for (const user of users) {
      const row = document.createElement('div');
      row.className = 'user-row';
      const name = document.createElement('span');
      name.textContent = `${user.username} · ${user.role}`;
      row.append(name);
      if (user.role !== 'owner') {
        const roleButton = document.createElement('button');
        roleButton.type = 'button';
        roleButton.textContent = 'Make owner';
        roleButton.addEventListener('click', async () => {
          if (!window.confirm(`Grant owner access to ${user.username}? Owners can manage invitations, accounts, provider credentials, and the secrets vault.`)) return;
          const ownerPassword = window.prompt('Re-enter your portal password to confirm this role change:');
          if (ownerPassword === null) return;
          try {
            await request(`/dev/api/users/${encodeURIComponent(user.id)}/role`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ role: 'owner', ownerPassword })
            });
            await loadOwnerControls();
            showToast(`${user.username} is now an owner.`);
          } catch (error) { showToast(error.message, true); }
        });
        row.append(roleButton);
      } else if (user.id !== state.user?.id && user.username.toLowerCase() !== 'zey-cat') {
        const roleButton = document.createElement('button');
        roleButton.type = 'button';
        roleButton.textContent = 'Make developer';
        roleButton.addEventListener('click', async () => {
          if (!window.confirm(`Remove owner privileges from ${user.username}?`)) return;
          const ownerPassword = window.prompt('Re-enter your portal password to confirm this role change:');
          if (ownerPassword === null) return;
          try {
            await request(`/dev/api/users/${encodeURIComponent(user.id)}/role`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ role: 'developer', ownerPassword })
            });
            await loadOwnerControls();
            showToast(`${user.username} is now a developer.`);
          } catch (error) { showToast(error.message, true); }
        });
        row.append(roleButton);
      }
      if (user.role !== 'owner') {
        const revoke = document.createElement('button');
        revoke.type = 'button';
        revoke.textContent = 'Revoke';
        revoke.addEventListener('click', async () => {
          if (!window.confirm(`Revoke portal access for ${user.username}?`)) return;
          try {
            await request(`/dev/api/users/${encodeURIComponent(user.id)}`, { method: 'DELETE' });
            row.remove();
            showToast('Developer access revoked.');
          } catch (error) {
            showToast(error.message, true);
          }
        });
        row.append(revoke);
      }
      node.append(row);
    }
  }

  function renderVault() {
    const node = $('vaultEntries');
    node.replaceChildren();
    for (const key of state.secretKeys) {
      const row = document.createElement('div');
      row.className = 'vault-row';
      const name = document.createElement('span');
      name.textContent = key;
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.textContent = 'Replace';
      edit.addEventListener('click', () => {
        $('vaultName').value = key;
        $('vaultValue').value = '';
        $('vaultValue').focus();
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Remove';
      remove.addEventListener('click', async () => {
        if (!window.confirm(`Remove ${key} from the vault?`)) return;
        try {
          const result = await request('/dev/api/secrets', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ remove: [key] })
          });
          state.secretKeys = result.keys;
          renderVault();
          $('vaultStatus').textContent = 'Secret removed.';
        } catch (error) {
          $('vaultStatus').textContent = error.message;
        }
      });
      row.append(name, edit, remove);
      node.append(row);
    }
  }

  async function saveVault(event) {
    event.preventDefault();
    const name = $('vaultName').value.trim();
    const value = $('vaultValue').value;
    if (!/^[A-Za-z0-9_.-]{1,80}$/.test(name) || !value || value.length > 32768) {
      $('vaultStatus').textContent = 'Provide a valid secret name and non-empty value.';
      return;
    }
    $('vaultStatus').textContent = 'Saving owner vault…';
    try {
      const result = await request('/dev/api/secrets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ set: { [name]: value } })
      });
      state.secretKeys = result.keys;
      $('vaultStatus').textContent = 'Secret saved. Its value is not sent back to this browser.';
      $('vaultValue').value = '';
      $('vaultName').value = '';
      renderVault();
    } catch (error) {
      $('vaultStatus').textContent = error.message;
    }
  }

  async function createInvitation() {
    try {
      const result = await request('/dev/api/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lifetimeHours: 72 })
      });
      const link = new URL(result.url, location.origin).href;
      $('inviteResult').textContent = `One-use invitation (expires ${new Date(result.expiresAt).toLocaleString()}): ${link}`;
      await navigator.clipboard?.writeText(link);
      showToast('Invitation created; copied to clipboard when permitted.');
    } catch (error) {
      showToast(error.message, true);
    }
  }

  function showPushReview() {
    const selected = [...state.staged].filter(file => {
      const tab = state.tabs.get(file);
      return !tab || tab.content === tab.savedContent;
    });
    if (!state.staged.size || selected.length) {
      showToast('Save every selected file before reviewing the push.', true);
      return;
    }
    const branch = $('branchName').value.trim();
    const message = $('commitMessage').value.trim();
    if (!branch || !message) {
      showToast('Enter a feature branch name and commit message.', true);
      return;
    }
    $('pushReviewSummary').textContent = `Base: ${$('branchSelect').value || 'main'} · Branch: dev/${branch} · Files: ${[...state.staged].sort().join(', ')}`;
    $('confirmPush').checked = false;
    $('confirmPushButton').disabled = true;
    $('pushDialog').showModal();
  }

  async function pushBranch() {
    const body = {
      confirmPush: $('confirmPush').checked,
      createPullRequest: true,
      baseBranch: $('branchSelect').value || 'main',
      branchName: $('branchName').value.trim(),
      message: $('commitMessage').value.trim(),
      files: [...state.staged].sort()
    };
    $('confirmPushButton').disabled = true;
    $('pushStatus').textContent = 'Pushing selected files and opening a pull request…';
    try {
      const result = await request('/dev/api/github/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      $('pushDialog').close();
      $('pushStatus').textContent = `Pull request created: #${result.pullRequest.number}`;
      showToast(`Branch ${result.branch} pushed and pull request opened.`);
      window.open(result.pullRequest.url, '_blank', 'noopener,noreferrer');
      state.staged.clear();
      await refreshWorkspace();
    } catch (error) {
      $('pushStatus').textContent = error.message;
      showToast(error.message, true);
    } finally {
      $('confirmPushButton').disabled = !$('confirmPush').checked;
    }
  }

  $('loginForm').addEventListener('submit', async event => {
    event.preventDefault();
    $('loginError').textContent = '';
    try {
      const result = await request('/dev/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: $('loginUsername').value, password: $('loginPassword').value })
      });
      $('loginPassword').value = '';
      history.replaceState(null, '', '/dev');
      showPortal(result.user);
    } catch (error) {
      $('loginError').textContent = error.message;
    }
  });
  $('inviteForm').addEventListener('submit', async event => {
    event.preventDefault();
    $('inviteError').textContent = '';
    try {
      await request('/dev/api/invitations/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: new URLSearchParams(location.search).get('invite'),
          username: $('inviteUsername').value,
          password: $('invitePassword').value
        })
      });
      $('invitePassword').value = '';
      history.replaceState(null, '', '/dev');
      $('inviteForm').hidden = true;
      showToast('Invitation accepted. Sign in with your new portal account.');
    } catch (error) {
      $('inviteError').textContent = error.message;
    }
  });
  $('logoutButton').addEventListener('click', async () => {
    try {
      await request('/dev/api/logout', { method: 'POST' });
      showLogin('You have signed out.');
    } catch (error) {
      showToast(error.message, true);
    }
  });
  $('createCodespaceLink').addEventListener('click', event => {
    if (!window.confirm('GitHub may charge for Codespaces usage. Continue to GitHub to review and confirm the workspace settings?')) {
      event.preventDefault();
    }
  });
  $('refreshFiles').addEventListener('click', () => {
    loadFileTree();
    refreshWorkspace().catch(error => showToast(error.message, true));
  });
  $('fileSearch').addEventListener('input', event => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => runFileSearch(event.target.value), 180);
  });
  $('saveButton').addEventListener('click', saveActiveFile);
  $('diffButton').addEventListener('click', () => showDiff());
  $('diffClose').addEventListener('click', () => $('diffDialog').close());
  $('replaceButton').addEventListener('click', () => {
    const find = $('findText').value;
    const tab = activeTab();
    if (!find || !tab) return;
    tab.content = tab.content.split(find).join($('replaceText').value);
    editor.value = tab.content;
    editor.dispatchEvent(new Event('input'));
  });
  $('findClose').addEventListener('click', () => {
    $('findText').value = '';
    $('replaceText').value = '';
    $('findText').focus();
  });
  $('findText').addEventListener('input', () => {
    const value = $('findText').value;
    if (!value) return;
    const found = editor.value.indexOf(value, editor.selectionStart);
    const start = found >= 0 ? found : editor.value.indexOf(value);
    if (start >= 0) {
      editor.focus();
      editor.setSelectionRange(start, start + value.length);
    }
  });
  editor.addEventListener('input', () => {
    const tab = activeTab();
    if (!tab) return;
    tab.content = editor.value;
    renderTabs();
    $('saveButton').disabled = tab.content === tab.savedContent;
    $('diffButton').disabled = !tab.modified && tab.content === tab.savedContent;
    $('saveState').textContent = tab.content !== tab.savedContent ? 'Unsaved changes' : tab.modified ? 'Workspace saved' : 'Read-only source';
    renderCode();
    scheduleSave(tab);
  });
  editor.addEventListener('scroll', syncEditorScroll);
  editor.addEventListener('click', updateLineLabel);
  editor.addEventListener('keyup', updateLineLabel);
  editor.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      saveActiveFile();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      $('findText').focus();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      editor.setRangeText('  ', editor.selectionStart, editor.selectionEnd, 'end');
      editor.dispatchEvent(new Event('input'));
    }
  });
  $('githubConnect').addEventListener('click', startGitHubDeviceFlow);
  $('githubPoll').addEventListener('click', pollGitHubDeviceFlow);
  $('loadCommits').addEventListener('click', loadCommits);
  $('loadChecks').addEventListener('click', loadChecks);
  $('branchSelect').addEventListener('change', () => {
    loadCommits();
    loadChecks();
  });
  $('pushButton').addEventListener('click', showPushReview);
  $('pushClose').addEventListener('click', () => $('pushDialog').close());
  $('confirmPush').addEventListener('change', () => { $('confirmPushButton').disabled = !$('confirmPush').checked; });
  $('confirmPushButton').addEventListener('click', pushBranch);
  $('createInvite').addEventListener('click', createInvitation);
  $('vaultForm').addEventListener('submit', saveVault);
  $('aiProvider').addEventListener('change', event => setAiProvider(event.target.value));
  $('aiConversation').addEventListener('change', async event => {
    if (!event.target.value) return;
    state.aiConversation = event.target.value;
    renderAiProposal(null);
    try {
      const result = await request(`/dev/api/ai/conversations/${encodeURIComponent(state.aiConversation)}`);
      renderConversationMessages(result.conversation.messages);
      renderAiProvider();
    } catch (error) { showToast(error.message, true); }
  });
  $('newAiConversation').addEventListener('click', createAiConversation);
  $('clearAiConversation').addEventListener('click', clearAiConversation);
  $('aiForm').addEventListener('submit', submitAiMessage);
  $('aiOwnerForm').addEventListener('submit', saveAiOwnerConfig);
  $('removeOpenaiKey').addEventListener('click', removeAiOwnerKey);
  $('passwordForm').addEventListener('submit', changePortalPassword);

  const invite = new URLSearchParams(location.search).get('invite');
  if (invite) $('inviteForm').hidden = false;
  request('/dev/api/session').then(result => {
    if (result.user) showPortal(result.user);
  }).catch(error => showLogin(error.message));
})();
