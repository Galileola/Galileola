// "Snap a deal": take a product photo, let the AI write the ad, add a price and publish.
// Photos are redrawn on a canvas before anything is sent. That shrinks them (1600 px for the
// shop, 1024 px for the AI) and drops their metadata, including the GPS location phones add.
(function () {
  const root = document.getElementById('snap');
  if (!root) return;
  const $ = (sel) => root.querySelector(sel);
  const aiOn = root.dataset.ai === '1';
  const csrf = document.getElementById('snap-csrf').value;
  const MAX_PHOTOS = 4;

  const cameraInput = $('[data-camera-input]');
  const galleryInput = $('[data-gallery-input]');
  const cameraText = $('[data-camera-text]');
  const shots = $('[data-shots]');
  const working = $('[data-working]');
  const workingText = $('[data-working-text]');
  const errorBox = $('[data-snap-error]');
  const photoNote = $('[data-photo-note]');
  const form = $('[data-snap-form]');
  const aiWritten = $('[data-ai-written]');
  const rewrite = $('[data-rewrite]');
  const publish = $('[data-publish]');
  const notes = document.getElementById('snap-notes');
  const deadline = document.getElementById('s-deadline');
  const fields = {
    product_name: document.getElementById('s-name'),
    headline: document.getElementById('s-headline'),
    category: document.getElementById('s-category'),
    description: document.getElementById('s-description'),
    social_post: document.getElementById('s-social'),
  };

  let photos = []; // { url, upload: Blob, ai: base64 }
  let busy = false;
  let drafted = false;

  // ---- photos
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve({ img, url });
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable')); };
      img.src = url;
    });
  }

  function draw(img, maxSide, quality) {
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const g = canvas.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('encode'))), 'image/jpeg', quality)
    );
  }

  async function toBase64(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  }

  async function addFiles(fileList) {
    hide(errorBox);
    const files = Array.from(fileList || []).slice(0, MAX_PHOTOS - photos.length);
    if (!files.length && fileList && fileList.length) return showError(`You can use up to ${MAX_PHOTOS} photos. Remove one first.`);
    const wasEmpty = photos.length === 0;
    for (const file of files) {
      try {
        const { img, url } = await loadImage(file);
        const upload = await draw(img, 1600, 0.86);
        const ai = await toBase64(await draw(img, 1024, 0.82));
        photos.push({ url, upload, ai });
      } catch (_) {
        showError(`"${file.name}" couldn't be read. Try a JPG or PNG photo.`);
      }
    }
    renderShots();
    if (!photos.length) return;
    if (wasEmpty && !drafted) {
      if (aiOn) writeAd();
      else showForm();
    }
  }

  function renderShots() {
    shots.textContent = '';
    photos.forEach((p, i) => {
      const fig = document.createElement('figure');
      fig.className = 'snap-shot';
      const img = document.createElement('img');
      img.src = p.url;
      img.alt = `Photo ${i + 1}`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'snap-remove';
      remove.setAttribute('aria-label', `Remove photo ${i + 1}`);
      remove.textContent = '×';
      remove.addEventListener('click', () => {
        URL.revokeObjectURL(p.url);
        photos.splice(i, 1);
        renderShots();
      });
      fig.append(img, remove);
      if (i === 0) {
        const tag = document.createElement('span');
        tag.className = 'snap-cover';
        tag.textContent = 'Cover';
        fig.append(tag);
      }
      shots.append(fig);
    });
    const full = photos.length >= MAX_PHOTOS;
    cameraInput.disabled = full;
    galleryInput.disabled = full;
    root.classList.toggle('has-photos', photos.length > 0);
    cameraText.textContent = full ? 'That’s 4 photos' : photos.length ? 'Add another photo' : 'Take a photo';
  }

  cameraInput.addEventListener('change', () => { addFiles(cameraInput.files); cameraInput.value = ''; });
  galleryInput.addEventListener('change', () => { addFiles(galleryInput.files); galleryInput.value = ''; });

  // ---- AI
  const LINES = ['🔍 Looking closely at your photo…', '🧠 Working out what it is…', '🗂️ Picking a category…', '✍️ Writing a catchy headline…', '🎨 Polishing the ad…', '📣 Drafting a post for social media…'];

  async function writeAd() {
    if (busy || !photos.length) return;
    busy = true;
    hide(errorBox);
    hide(photoNote);
    show(working);
    if (rewrite) rewrite.disabled = true;
    let line = 0;
    workingText.textContent = LINES[0];
    const ticker = setInterval(() => { line = (line + 1) % LINES.length; workingText.textContent = LINES[line]; }, 2600);
    try {
      const r = await fetch('/admin/ai/snap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _csrf: csrf, notes: notes.value, images: photos.map((p) => ({ data: p.ai })) }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'The AI could not write the ad just now. Please try again.');
      for (const [key, el] of Object.entries(fields)) el.value = data[key] || (key === 'category' ? 'other' : '');
      drafted = true;
      show(aiWritten);
      if (data.photo_note) { photoNote.textContent = '📷 ' + data.photo_note; show(photoNote); }
      showForm(true);
    } catch (err) {
      showError(err.message + ' You can also fill in the ad yourself.');
      showForm();
    } finally {
      clearInterval(ticker);
      hide(working);
      busy = false;
      if (rewrite) rewrite.disabled = false;
    }
  }

  if (rewrite) {
    rewrite.addEventListener('click', () => {
      if (!photos.length) return showError('Take a photo first.');
      if (fields.description.value.trim() && !window.confirm('Replace the ad with a new AI draft? Your edits to the text will be lost.')) return;
      writeAd();
    });
  }

  // ---- form
  const toLocal = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  function setDays(days) {
    // 30 days is the maximum: stay an hour under it so a slow submit still fits.
    const ms = days * 86400000 - (days >= 30 ? 3600000 : 0);
    deadline.value = toLocal(new Date(Date.now() + ms));
    root.querySelectorAll('[data-days]').forEach((b) => b.classList.toggle('active', Number(b.dataset.days) === days));
  }
  root.querySelectorAll('[data-days]').forEach((b) => b.addEventListener('click', () => setDays(Number(b.dataset.days))));
  deadline.addEventListener('input', () => root.querySelectorAll('[data-days]').forEach((b) => b.classList.remove('active')));
  deadline.min = toLocal(new Date(Date.now() + 5 * 60000));
  deadline.max = toLocal(new Date(Date.now() + 30 * 86400000));
  setDays(7);

  function showForm(fromAi) {
    const first = form.hidden;
    show(form);
    if (fromAi) {
      form.classList.remove('pop');
      void form.offsetWidth; // restart the pop-in animation
      form.classList.add('pop');
    }
    if (first || fromAi) {
      const target = fromAi ? document.getElementById('s-price') : fields.product_name;
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => target.focus({ preventScroll: true }), 400);
    }
  }

  function clearErrors() {
    root.querySelectorAll('[data-error-for]').forEach((el) => { el.textContent = ''; el.hidden = true; });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    clearErrors();
    hide(errorBox);
    const errors = {};
    if (!fields.product_name.value.trim()) errors.product_name = 'Enter a product name.';
    if (!document.getElementById('s-price').value.trim()) errors.price = 'Add the price buyers pay, VAT included.';
    if (!photos.length) errors.photos = 'Take a photo of the product first.';
    if (Object.keys(errors).length) return showErrors(errors);

    busy = true;
    publish.disabled = true;
    const label = publish.textContent;
    publish.textContent = 'Publishing…';
    try {
      const body = new FormData();
      body.append('_csrf', csrf); // first, so the server reads it before the photos
      for (const el of form.querySelectorAll('input[name], select[name], textarea[name]')) body.append(el.name, el.value);
      body.append('deadline_iso', deadline.value ? new Date(deadline.value).toISOString() : '');
      photos.forEach((p, i) => body.append('photos', p.upload, `photo-${i + 1}.jpg`));
      const r = await fetch('/admin/snap', { method: 'POST', body });
      const data = await r.json().catch(() => null);
      if (r.ok && data && data.redirect) {
        window.location.href = data.redirect;
        return;
      }
      if (data && data.errors) showErrors(data.errors);
      else showError('The deal could not be published. Reload the page and try again.');
    } catch (_) {
      showError('No connection. Check your internet and try again: your photos and text are still here.');
    } finally {
      busy = false;
      publish.disabled = false;
      publish.textContent = label;
    }
  });

  function showErrors(errors) {
    let first = null;
    for (const [key, message] of Object.entries(errors)) {
      const el = root.querySelector(`[data-error-for="${key}"]`) || root.querySelector('[data-error-for="form"]');
      el.textContent = message;
      el.hidden = false;
      first = first || el;
    }
    if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function showError(message) {
    errorBox.textContent = message;
    show(errorBox);
  }
  function show(el) { el.hidden = false; }
  function hide(el) { el.hidden = true; }
})();
