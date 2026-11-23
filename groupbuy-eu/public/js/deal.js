// Live counter, progress rocket and countdown for the public deal page.
(function () {
  const root = document.getElementById('deal');
  if (!root) return;
  const T = JSON.parse((document.getElementById('gb-i18n') || {}).textContent || '{}');
  const lang = document.documentElement.lang || 'en';
  const $ = (sel) => root.querySelector(sel);

  // Photo gallery: swipe (or scroll) through the photos, thumbnails and arrows jump to one, and a
  // tap opens them full screen. Without JavaScript the photos still scroll sideways.
  const gallery = $('[data-gallery]');
  if (gallery) {
    const track = gallery.querySelector('[data-gallery-track]');
    const slides = [...track.children];
    const thumbs = [...gallery.querySelectorAll('[data-gallery-thumb]')];
    const count = gallery.querySelector('[data-gallery-count]');
    const steps = [...gallery.querySelectorAll('[data-gallery-step]')];
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const indexOf = (el) => Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
    const go = (el, i) => el.scrollTo({ left: i * el.clientWidth, behavior: reduce ? 'auto' : 'smooth' });
    let current = 0;
    const show = (i) => {
      current = Math.max(0, Math.min(slides.length - 1, i));
      thumbs.forEach((t, k) => t.classList.toggle('active', k === current));
      if (count) count.textContent = `${current + 1} / ${slides.length}`;
      steps.forEach((b) => { b.hidden = slides.length < 2 || (Number(b.dataset.galleryStep) < 0 ? current === 0 : current === slides.length - 1); });
    };
    track.addEventListener('scroll', () => { if (indexOf(track) !== current) show(indexOf(track)); }, { passive: true });
    thumbs.forEach((t) => t.addEventListener('click', () => { go(track, Number(t.dataset.galleryThumb)); show(Number(t.dataset.galleryThumb)); }));
    steps.forEach((b) => b.addEventListener('click', () => go(track, current + Number(b.dataset.galleryStep))));
    show(0);

    const box = gallery.querySelector('[data-lightbox]');
    if (box && typeof box.showModal === 'function') {
      const boxTrack = box.querySelector('[data-lightbox-track]');
      slides.forEach((slide, i) =>
        slide.addEventListener('click', () => {
          box.showModal();
          boxTrack.scrollTo({ left: i * boxTrack.clientWidth });
        })
      );
      box.querySelector('[data-lightbox-close]').addEventListener('click', () => box.close());
      box.querySelectorAll('[data-lightbox-step]').forEach((b) =>
        b.addEventListener('click', () => go(boxTrack, indexOf(boxTrack) + Number(b.dataset.lightboxStep)))
      );
      box.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight') go(boxTrack, indexOf(boxTrack) + 1);
        if (e.key === 'ArrowLeft') go(boxTrack, indexOf(boxTrack) - 1);
      });
      // Closing shows the photo that was open in the page gallery too.
      box.addEventListener('close', () => { go(track, indexOf(boxTrack)); show(indexOf(boxTrack)); });
      box.addEventListener('click', (e) => { if (e.target === box) box.close(); });
    }
  }

  const bar = $('[data-progress]');
  const countdown = $('[data-countdown]');
  let secondsLeft = Number(countdown.dataset.seconds);
  let reached = root.dataset.reached === '1';
  // Start empty, then fill: the rocket flies to where the deal is.
  requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.width = bar.dataset.width + '%'; }));

  // Countdown tiles: days, hours, minutes, seconds.
  const units = [[T.days || 'days', 86400], [T.hrs || 'hrs', 3600], [T.min || 'min', 60], [T.sec || 'sec', 1]];
  const tiles = units.map(([label]) => {
    const tile = document.createElement('span');
    tile.className = 'tile';
    const num = document.createElement('b');
    const small = document.createElement('small');
    small.textContent = label;
    tile.append(num, small);
    countdown.append(tile);
    return num;
  });
  const label = document.createElement('span');
  label.className = 'visually-hidden';
  countdown.append(label);

  function renderCountdown() {
    if (secondsLeft <= 0) {
      countdown.classList.add('over');
      countdown.textContent = T.deadlinePassed || 'The deadline has passed';
      return;
    }
    let rest = secondsLeft;
    const values = units.map(([, size]) => {
      const v = Math.floor(rest / size);
      rest -= v * size;
      return v;
    });
    values.forEach((v, i) => { tiles[i].textContent = String(v).padStart(i ? 2 : 1, '0'); });
    countdown.classList.toggle('urgent', secondsLeft < 86400);
    label.textContent = (T.timeLeft || '{time} left').replace('{time}', spoken(values));
  }
  // "3 days, 4 hours and 5 minutes" in the page's language, for screen readers.
  function spoken(values) {
    try {
      const parts = ['day', 'hour', 'minute'].map((unit, i) =>
        new Intl.NumberFormat(lang, { style: 'unit', unit, unitDisplay: 'long' }).format(values[i]));
      return new Intl.ListFormat(lang, { type: 'conjunction' }).format(parts);
    } catch (_) {
      return `${values[0]} d ${values[1]} h ${values[2]} min`;
    }
  }

  renderCountdown();
  const timer = setInterval(() => {
    secondsLeft = Math.max(0, secondsLeft - 1);
    renderCountdown();
    if (secondsLeft === 0) clearInterval(timer);
  }, 1000);

  function bump(el) {
    el.classList.remove('bump');
    void el.offsetWidth; // restart the animation
    el.classList.add('bump');
  }

  async function refresh() {
    try {
      const r = await fetch('/api/deals/' + encodeURIComponent(root.dataset.slug), { cache: 'no-store' });
      if (!r.ok) return;
      const s = await r.json();
      const count = $('[data-count]');
      if (String(s.count) !== count.textContent) {
        count.textContent = s.count;
        bump(count);
      }
      bar.style.width = s.percent + '%';
      secondsLeft = s.secondsLeft;
      const remaining = $('[data-remaining]');
      if (remaining) remaining.textContent = s.remaining;
      if (s.minimumReached && !reached) {
        reached = true;
        $('[data-status-line]').textContent = T.reached || 'Minimum reached. The deal is on!';
        const mood = $('[data-mood]');
        if (mood) mood.hidden = true;
        if (window.gbFun) window.gbFun.confetti();
      }
    } catch (_) { /* offline: keep last value */ }
  }
  setInterval(refresh, 10000);
})();
