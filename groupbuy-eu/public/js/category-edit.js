// Admin → Categories: confirm before removing, and fill the names with an AI translation.
(function () {
  document.querySelectorAll('[data-confirm]').forEach((button) => {
    button.addEventListener('click', (e) => { if (!confirm(button.dataset.confirm)) e.preventDefault(); });
  });
  const form = document.getElementById('category-form');
  const ai = form && form.querySelector('[data-ai-names]');
  if (!ai) return;
  const status = form.querySelector('[data-ai-status]');
  ai.addEventListener('click', async () => {
    const english = form.elements.name_en.value.trim() || form.elements.name_en.placeholder;
    ai.disabled = true;
    status.textContent = 'Translating…';
    try {
      const r = await fetch(ai.dataset.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _csrf: form.elements._csrf.value, name: english }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.names) throw new Error(data.error || 'The translation did not work. Please try again.');
      let filled = 0;
      for (const [code, name] of Object.entries(data.names)) {
        const input = form.elements['name_' + code];
        if (input && !input.value.trim() && name) { input.value = name; filled++; }
      }
      status.textContent = filled ? `Filled ${filled} empty fields. Check them, then save.` : 'All fields already had a name: nothing was changed.';
    } catch (err) {
      status.textContent = err.message;
    } finally {
      ai.disabled = false;
    }
  });
})();
