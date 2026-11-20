// Admin → Legal pages editor: fill the box with the English text or an AI draft, and confirm
// before removing a saved text.
(function () {
  const form = document.getElementById('legal-form');
  if (!form) return;
  const box = document.getElementById('legal-body');
  const status = form.querySelector('[data-legal-status]');
  const english = JSON.parse((document.getElementById('legal-english') || {}).textContent || '""');
  const replaceText = (text) => {
    if (box.value.trim() && !confirm('Replace the text in the box?')) return false;
    box.value = text;
    box.focus();
    box.setSelectionRange(0, 0);
    box.scrollTop = 0;
    return true;
  };

  const copy = form.querySelector('[data-legal-copy]');
  if (copy) copy.addEventListener('click', () => replaceText(english));

  const draft = form.querySelector('[data-legal-draft]');
  if (draft) {
    draft.addEventListener('click', async () => {
      if (box.value.trim() && !confirm('Replace the text in the box with an AI translation?')) return;
      draft.disabled = true;
      status.textContent = 'Translating… this can take a minute or two.';
      try {
        const r = await fetch(draft.dataset.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ _csrf: form.elements._csrf.value }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok || !data.text) throw new Error(data.error || 'The translation did not work. Please try again.');
        box.value = data.text;
        box.scrollTop = 0;
        status.textContent = 'Draft ready. Check it, adapt it to the law of the country, then save.';
      } catch (err) {
        status.textContent = err.message;
      } finally {
        draft.disabled = false;
      }
    });
  }

  form.querySelectorAll('[data-confirm]').forEach((button) => {
    button.addEventListener('click', (e) => { if (!confirm(button.dataset.confirm)) e.preventDefault(); });
  });
})();
