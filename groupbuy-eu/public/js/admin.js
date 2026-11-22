// Convert the datetime-local value (browser local time) to an absolute ISO timestamp.
const form = document.getElementById('deal-form');
if (form) {
  const input = document.getElementById('deadline');
  const max = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  const toLocal = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  // Edit form: show the saved deadline in the admin's local time.
  if (input.dataset.iso && !input.value) input.value = toLocal(new Date(input.dataset.iso));
  const saved = input.dataset.iso ? new Date(input.dataset.iso) : null;
  input.max = toLocal(saved && saved > max ? saved : max);
  input.min = toLocal(input.dataset.minIso ? new Date(input.dataset.minIso) : new Date(Date.now() + 5 * 60000));
  form.addEventListener('submit', () => {
    const v = input.value;
    document.getElementById('deadline_iso').value = v ? new Date(v).toISOString() : '';
  });
}
// "Write with AI": drafts the description from the name, the notes in the description box and
// up to 4 of the chosen photos (shrunk to 1024 px JPEGs first so the upload stays small).
const aiBox = document.querySelector('[data-ai-write]');
if (aiBox) {
  const button = aiBox.querySelector('[data-ai-write-button]');
  const undo = aiBox.querySelector('[data-ai-undo]');
  const status = aiBox.querySelector('[data-ai-status]');
  const description = document.getElementById('description');
  let previous = null;

  const shrink = async (file) => {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const g = canvas.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return { data: btoa(binary) };
  };

  button.addEventListener('click', async () => {
    const name = document.getElementById('product_name').value.trim();
    if (!name) {
      status.textContent = 'Enter the product name first.';
      document.getElementById('product_name').focus();
      return;
    }
    button.disabled = true;
    button.classList.add('busy');
    const label = button.textContent;
    button.textContent = 'Writing…';
    status.textContent = 'This usually takes 10 to 30 seconds.';
    try {
      const files = Array.from(document.getElementById('photos')?.files || []).slice(0, 4);
      const images = [];
      for (const f of files) {
        try { images.push(await shrink(f)); } catch (_) { /* a format the browser can't read: skip it */ }
      }
      const r = await fetch('/admin/ai/description', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          _csrf: document.querySelector('input[name="_csrf"]').value,
          product_name: name,
          notes: description.value,
          images,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.description) throw new Error(data.error || 'Something went wrong. Please try again.');
      previous = description.value;
      description.value = data.description;
      description.style.height = Math.max(160, description.scrollHeight + 4) + 'px';
      undo.hidden = false;
      status.textContent = 'Draft written. Read it and edit anything that isn’t right before you create the deal.';
    } catch (err) {
      status.textContent = err.message;
    } finally {
      button.disabled = false;
      button.classList.remove('busy');
      button.textContent = label;
    }
  });

  undo.addEventListener('click', () => {
    if (previous === null) return;
    description.value = previous;
    previous = null;
    undo.hidden = true;
    status.textContent = 'Your previous text is back.';
  });
}

// Confirm buttons for destructive admin actions.
document.querySelectorAll('form[data-confirm]').forEach((f) => {
  f.addEventListener('submit', (e) => {
    if (!window.confirm(f.dataset.confirm)) e.preventDefault();
  });
});

// Character counters for the search title and description (Google shows about 60 / 155).
document.querySelectorAll('[data-count]').forEach((field) => {
  const out = document.querySelector(`[data-count-for="${field.id}"]`);
  if (!out) return;
  const ideal = Number(field.dataset.count);
  const update = () => {
    const n = field.value.trim().length;
    out.textContent = n ? `${n} characters${n > ideal ? ` (Google usually shows about ${ideal})` : ''}` : '';
  };
  field.addEventListener('input', update);
  update();
});

// Two-step login: copy or print the backup codes.
document.querySelectorAll('[data-copy-codes]').forEach((button) =>
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copyCodes);
      button.textContent = '✅ Copied';
    } catch {
      button.textContent = 'Select the codes and copy them';
    }
  })
);
document.querySelectorAll('[data-print]').forEach((button) => button.addEventListener('click', () => window.print()));

// Languages: quick picks tick exactly the listed languages (the always-on ones stay ticked).
document.querySelectorAll('[data-lang-set]').forEach((button) =>
  button.addEventListener('click', () => {
    const codes = button.dataset.langSet.split(' ').filter(Boolean);
    document.querySelectorAll('.language-choice input[type=checkbox][name=lang]:not(:disabled)').forEach((box) => {
      box.checked = codes.includes(box.value);
    });
  })
);
