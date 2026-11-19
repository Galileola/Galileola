// Live counter + countdown for the public deal page.
(function () {
  const root = document.getElementById('deal');
  if (!root) return;
  const $ = (sel) => root.querySelector(sel);

  // Photo gallery: clicking a thumbnail shows it as the main photo.
  const main = $('[data-gallery-main]');
  root.querySelectorAll('[data-gallery-thumb]').forEach((thumb) => {
    thumb.addEventListener('click', () => {
      main.src = thumb.dataset.galleryThumb;
      root.querySelectorAll('[data-gallery-thumb]').forEach((t) => t.classList.toggle('active', t === thumb));
    });
  });
  const bar = $('[data-progress]');
  const countdown = $('[data-countdown]');
  let secondsLeft = Number(countdown.dataset.seconds);
  bar.style.width = bar.dataset.width + '%';

  function renderCountdown() {
    if (secondsLeft <= 0) { countdown.textContent = 'deadline passed'; return; }
    const d = Math.floor(secondsLeft / 86400);
    const h = Math.floor((secondsLeft % 86400) / 3600);
    const m = Math.floor((secondsLeft % 3600) / 60);
    const s = secondsLeft % 60;
    countdown.textContent = (d ? d + 'd ' : '') + h + 'h ' + m + 'm ' + (d ? '' : s + 's ') + 'left';
  }
  renderCountdown();
  setInterval(() => { secondsLeft = Math.max(0, secondsLeft - 1); renderCountdown(); }, 1000);

  async function refresh() {
    try {
      const r = await fetch('/api/deals/' + encodeURIComponent(root.dataset.slug), { cache: 'no-store' });
      if (!r.ok) return;
      const s = await r.json();
      $('[data-count]').textContent = s.count;
      bar.style.width = s.percent + '%';
      secondsLeft = s.secondsLeft;
      const remaining = $('[data-remaining]');
      if (remaining) remaining.textContent = s.remaining;
      if (s.minimumReached && remaining) $('[data-status-line]').textContent = 'Minimum reached. The deal is on!';
    } catch (_) { /* offline: keep last value */ }
  }
  setInterval(refresh, 10000);
})();
