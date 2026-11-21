// Admin → Performance: bar readouts, the tracked link maker and the ad spend form.
(() => {
  // Show a bar's value above its chart while it is hovered or tapped.
  document.querySelectorAll('.chart').forEach((chart) => {
    const readout = chart.querySelector('[data-readout]');
    if (!readout) return;
    chart.querySelectorAll('.bar').forEach((bar) => {
      bar.addEventListener('pointerenter', () => {
        chart.querySelectorAll('.bar.active').forEach((b) => b.classList.remove('active'));
        bar.classList.add('active');
        readout.textContent = bar.dataset.tip;
      });
    });
    chart.addEventListener('pointerleave', () => {
      chart.querySelectorAll('.bar.active').forEach((b) => b.classList.remove('active'));
      readout.textContent = readout.dataset.default;
    });
  });

  // Same rules as the shop uses to read the tags (src/analytics.js cleanTag).
  const clean = (v, max = 60) =>
    String(v || '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9._-]/g, '')
      .replace(/-{2,}/g, '-')
      .slice(0, max);

  const maker = document.querySelector('[data-link-maker]');
  if (maker) {
    const out = maker.querySelector('[data-link-output]');
    const other = maker.querySelector('[data-other-source]');
    const copied = maker.querySelector('[data-link-copied]');
    const update = () => {
      const f = new FormData(maker);
      other.hidden = f.get('source') !== 'other';
      const source = f.get('source') === 'other' ? clean(f.get('other_source'), 40) || 'other' : f.get('source');
      const params = new URLSearchParams();
      if (f.get('lang')) params.set('lang', f.get('lang'));
      params.set('utm_source', source);
      params.set('utm_medium', f.get('medium'));
      const campaign = clean(f.get('campaign'));
      if (campaign) params.set('utm_campaign', campaign);
      out.value = `${maker.dataset.base}${f.get('path')}?${params}`;
      copied.hidden = true;
    };
    maker.addEventListener('input', update);
    maker.addEventListener('change', update);
    maker.addEventListener('submit', (e) => e.preventDefault());
    maker.querySelector('[data-link-copy]').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(out.value);
      } catch {
        out.select();
        document.execCommand?.('copy');
      }
      copied.hidden = false;
    });
    update();
  }

  const spendSource = document.querySelector('[data-spend-source]');
  const spendOther = document.querySelector('[data-spend-other]');
  if (spendSource && spendOther) {
    spendSource.addEventListener('change', () => {
      spendOther.hidden = spendSource.value !== 'other';
      if (!spendOther.hidden) spendOther.focus();
    });
  }

  document.querySelectorAll('form[data-confirm]').forEach((form) => {
    form.addEventListener('submit', (e) => {
      if (!confirm(form.dataset.confirm)) e.preventDefault();
    });
  });
})();
