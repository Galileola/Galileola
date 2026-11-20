// Live counter, progress rocket and countdown for the public deal page.
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
  let reached = root.dataset.reached === '1';
  // Start empty, then fill: the rocket flies to where the deal is.
  requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.width = bar.dataset.width + '%'; }));

  // Countdown tiles: days, hours, minutes, seconds.
  const units = [['days', 86400], ['hrs', 3600], ['min', 60], ['sec', 1]];
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
      countdown.textContent = 'The deadline has passed';
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
    label.textContent = `${values[0]} days ${values[1]} hours ${values[2]} minutes left`;
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
        $('[data-status-line]').textContent = '🎉 Minimum reached. The deal is on!';
        const mood = $('[data-mood]');
        if (mood) mood.hidden = true;
        if (window.gbFun) window.gbFun.confetti();
      }
    } catch (_) { /* offline: keep last value */ }
  }
  setInterval(refresh, 10000);
})();
