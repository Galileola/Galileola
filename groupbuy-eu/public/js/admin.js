// Convert the datetime-local value (browser local time) to an absolute ISO timestamp.
const form = document.getElementById('deal-form');
if (form) {
  const input = document.getElementById('deadline');
  const max = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  const toLocal = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  input.max = toLocal(max);
  input.min = toLocal(new Date(Date.now() + 5 * 60000));
  form.addEventListener('submit', () => {
    const v = input.value;
    document.getElementById('deadline_iso').value = v ? new Date(v).toISOString() : '';
  });
}
// Confirm buttons for destructive admin actions.
document.querySelectorAll('form[data-confirm]').forEach((f) => {
  f.addEventListener('submit', (e) => {
    if (!window.confirm(f.dataset.confirm)) e.preventDefault();
  });
});
