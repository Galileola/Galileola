// Cookie consent. Both buttons are equally prominent; nothing optional loads before a choice.
// Optional scripts must check window.gbConsent.allows('optional') before running.
(function () {
  const NAME = 'gb_consent';
  const read = () => (document.cookie.match(/(?:^|; )gb_consent=([^;]+)/) || [])[1] || null;
  const banner = document.getElementById('cookie-banner');
  window.gbConsent = {
    value: read(),
    allows(category) { return category === 'necessary' || this.value === 'all'; },
  };
  function save(value) {
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = NAME + '=' + value + '; Max-Age=' + 60 * 60 * 24 * 182 + '; Path=/; SameSite=Lax' + secure;
    window.gbConsent.value = value;
    banner.hidden = true;
    document.dispatchEvent(new CustomEvent('gb-consent', { detail: value }));
  }
  if (!banner) return;
  if (!window.gbConsent.value) banner.hidden = false;
  banner.querySelectorAll('[data-consent]').forEach((b) => b.addEventListener('click', () => save(b.dataset.consent)));
  document.querySelectorAll('[data-cookie-settings]').forEach((b) => b.addEventListener('click', () => { banner.hidden = false; }));
})();
