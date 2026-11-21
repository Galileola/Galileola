// Admin → Import products → preview: tick all / untick all, and the count on the publish button.
const form = document.querySelector('[data-import-form]');
if (form) {
  const boxes = [...form.querySelectorAll('input[type=checkbox][name^="include_"]')];
  const count = form.querySelector('[data-selected-count]');
  const submit = form.querySelector('[data-import-submit]');
  const update = () => {
    const n = boxes.filter((b) => b.checked).length;
    count.textContent = `${n} of ${boxes.length} ticked`;
    submit.textContent = n === 1 ? 'Publish 1 deal' : `Publish ${n} deals`;
    submit.disabled = n === 0;
    for (const b of boxes) b.closest('tr')?.classList.toggle('excluded', !b.checked);
  };
  form.querySelectorAll('[data-select]').forEach((button) =>
    button.addEventListener('click', () => {
      for (const b of boxes) b.checked = button.dataset.select === 'all';
      update();
    })
  );
  for (const b of boxes) b.addEventListener('change', update);
  form.addEventListener('submit', () => {
    submit.disabled = true;
    submit.textContent = 'Publishing…';
  });
  update();
}
