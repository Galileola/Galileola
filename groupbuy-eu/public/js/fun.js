// Small bits of joy: confetti for celebrations, plus the copy and share buttons.
// Confetti is skipped for visitors who ask their device for reduced motion.
(function () {
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const COLORS = ['#6d28d9', '#db2777', '#f97316', '#facc15', '#14b8a6', '#a78bfa', '#fb7185'];

  function confetti(options) {
    if (reduceMotion) return;
    const count = (options && options.count) || 160;
    const canvas = document.createElement('canvas');
    canvas.className = 'confetti-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
    const g = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
    };
    resize();
    window.addEventListener('resize', resize);

    const w = () => canvas.width;
    const h = () => canvas.height;
    const pieces = Array.from({ length: count }, (_, i) => {
      const fromLeft = i % 2 === 0;
      return {
        x: fromLeft ? w() * 0.15 : w() * 0.85,
        y: h() * 0.65,
        vx: (fromLeft ? 1 : -1) * (4 + Math.random() * 9) * dpr,
        vy: -(11 + Math.random() * 11) * dpr,
        size: (6 + Math.random() * 7) * dpr,
        color: COLORS[i % COLORS.length],
        spin: Math.random() * Math.PI,
        vspin: (Math.random() - 0.5) * 0.35,
        round: Math.random() < 0.3,
      };
    });

    const started = performance.now();
    function frame(now) {
      const t = now - started;
      g.clearRect(0, 0, w(), h());
      for (const p of pieces) {
        p.vy += 0.38 * dpr;
        p.vx *= 0.985;
        p.x += p.vx;
        p.y += p.vy;
        p.spin += p.vspin;
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.spin);
        g.globalAlpha = Math.max(0, 1 - t / 3200);
        g.fillStyle = p.color;
        if (p.round) {
          g.beginPath();
          g.arc(0, 0, p.size / 2.4, 0, Math.PI * 2);
          g.fill();
        } else {
          g.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        }
        g.restore();
      }
      if (t < 3200) requestAnimationFrame(frame);
      else {
        window.removeEventListener('resize', resize);
        canvas.remove();
      }
    }
    requestAnimationFrame(frame);
  }

  window.gbFun = { confetti };
  if (document.querySelector('[data-confetti-on-load]')) setTimeout(confetti, 250);

  // ---- copy buttons: data-copy="text" or data-copy-from="element id"
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
      ta.remove();
      return ok;
    }
  }

  function flash(button, text) {
    const label = button.dataset.label || button.textContent;
    button.dataset.label = label;
    button.textContent = text;
    clearTimeout(button._flash);
    button._flash = setTimeout(() => { button.textContent = label; }, 2000);
  }

  document.addEventListener('click', async (e) => {
    const button = e.target.closest('[data-copy], [data-copy-from], [data-share-native]');
    if (!button) return;
    if (button.hasAttribute('data-share-native')) {
      const box = button.closest('[data-share-url]');
      try {
        await navigator.share({ title: document.title, text: box.dataset.shareText, url: box.dataset.shareUrl });
      } catch (_) { /* closed the share sheet */ }
      return;
    }
    const text = button.hasAttribute('data-copy')
      ? button.dataset.copy
      : (document.getElementById(button.dataset.copyFrom) || {}).value || '';
    const T = JSON.parse((document.getElementById('gb-i18n') || {}).textContent || '{}');
    flash(button, (await copyText(text)) ? T.copied || '✅ Copied!' : T.copyFallback || 'Press and hold to copy');
  });

  // The language menu closes when you click elsewhere or press Escape.
  const langMenu = document.querySelector('[data-lang-menu]');
  if (langMenu) {
    document.addEventListener('click', (e) => { if (langMenu.open && !langMenu.contains(e.target)) langMenu.open = false; });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && langMenu.open) { langMenu.open = false; langMenu.querySelector('summary').focus(); } });
  }

  // The phone's own share sheet (WhatsApp, Messages, Instagram…) where the browser offers it.
  if (navigator.share) document.querySelectorAll('[data-share-native]').forEach((b) => { b.hidden = false; });
})();
