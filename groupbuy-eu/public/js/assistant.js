// AI shopping assistant chat window. The conversation is kept in this tab's sessionStorage
// (gone when the tab closes) and sent to /api/assistant with each question.
(function () {
  const root = document.getElementById('assistant');
  if (!root) return;
  const T = JSON.parse((document.getElementById('gb-i18n') || {}).textContent || '{}');
  const fallbackError = T.error || 'Sorry, something went wrong. Please try again.';
  const panel = root.querySelector('.assistant-panel');
  const launcher = root.querySelector('[data-assistant-open]');
  const log = root.querySelector('[data-assistant-log]');
  const form = root.querySelector('[data-assistant-form]');
  const input = form.querySelector('textarea');
  const sendButton = form.querySelector('button');
  const suggestions = root.querySelector('[data-assistant-suggestions]');
  const KEY = 'gb_assistant_chat';
  const MAX_KEEP = 30;
  let busy = false;

  let history = [];
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) || '[]');
    if (Array.isArray(saved)) {
      history = saved
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .slice(-MAX_KEEP);
    }
  } catch (_) { /* storage unavailable: start fresh */ }

  function save() {
    try { sessionStorage.setItem(KEY, JSON.stringify(history.slice(-MAX_KEEP))); } catch (_) { /* ignore */ }
  }

  // Shows text with links to pages on this site made clickable. Everything else stays plain text.
  function addText(el, text) {
    const urlRe = /https?:\/\/[^\s<>"')]+/g;
    let last = 0;
    let match;
    while ((match = urlRe.exec(text))) {
      let raw = match[0].replace(/[.,;:!?]+$/, '');
      el.appendChild(document.createTextNode(text.slice(last, match.index)));
      let url = null;
      try { url = new URL(raw); } catch (_) { /* not a URL */ }
      if (url && url.origin === location.origin) {
        const a = document.createElement('a');
        a.href = url.pathname + url.search + url.hash;
        a.textContent = url.pathname === '/' ? location.host : url.pathname + url.hash;
        el.appendChild(a);
      } else {
        el.appendChild(document.createTextNode(raw));
      }
      last = match.index + raw.length;
      urlRe.lastIndex = last;
    }
    el.appendChild(document.createTextNode(text.slice(last)));
  }

  function bubble(role, text) {
    const div = document.createElement('div');
    div.className = 'msg ' + role;
    addText(div, text);
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
  }

  function renderHistory() {
    for (const m of history) bubble(m.role, m.content);
    if (history.length) suggestions.hidden = true;
  }

  function open() {
    panel.hidden = false;
    launcher.setAttribute('aria-expanded', 'true');
    root.classList.add('open');
    log.scrollTop = log.scrollHeight;
    input.focus();
  }
  function close() {
    panel.hidden = true;
    launcher.setAttribute('aria-expanded', 'false');
    root.classList.remove('open');
    launcher.focus();
  }

  async function ask(text) {
    if (busy) return;
    text = text.trim().slice(0, 1500);
    if (!text) return;
    busy = true;
    sendButton.disabled = true;
    suggestions.hidden = true;
    history.push({ role: 'user', content: text });
    bubble('user', text);
    input.value = '';
    autosize();
    const typing = bubble('assistant typing', '');
    typing.setAttribute('aria-label', T.typing || 'The assistant is typing');
    for (let i = 0; i < 3; i++) typing.appendChild(document.createElement('span'));
    try {
      const r = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history.slice(-12), lang: document.documentElement.lang }),
      });
      const data = await r.json().catch(() => ({}));
      typing.remove();
      if (!r.ok || !data.reply) throw new Error(data.error || fallbackError);
      history.push({ role: 'assistant', content: data.reply });
      save();
      bubble('assistant', data.reply);
    } catch (err) {
      typing.remove();
      history.pop(); // the question wasn't answered: let the visitor send it again
      bubble('assistant error', err.message || fallbackError);
      input.value = text;
      autosize();
    } finally {
      busy = false;
      sendButton.disabled = false;
      input.focus();
    }
  }

  function autosize() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  }

  launcher.addEventListener('click', () => (panel.hidden ? open() : close()));
  root.querySelector('[data-assistant-close]').addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) close(); });
  form.addEventListener('submit', (e) => { e.preventDefault(); ask(input.value); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(input.value); }
  });
  input.addEventListener('input', autosize);
  suggestions.querySelectorAll('[data-suggest]').forEach((b) => b.addEventListener('click', () => ask(b.textContent)));

  renderHistory();
})();
