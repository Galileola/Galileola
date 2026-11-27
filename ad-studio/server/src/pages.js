// Small pages shown in the browser while connecting Facebook or Google.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>
  body { margin:0; background:#0e0f13; color:#f4f4f6; font:16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  main { max-width:560px; margin:0 auto; padding:32px 16px 64px; }
  .brand { color:#f2c14e; font-weight:900; letter-spacing:.2em; font-size:14px; }
  h1 { font-size:24px; margin:8px 0 16px; }
  fieldset { border:1px solid #2a2d36; border-radius:14px; padding:12px 14px; margin:0 0 16px; }
  legend { color:#b9bcc6; font-weight:700; padding:0 6px; }
  label { display:flex; gap:10px; align-items:flex-start; padding:10px 4px; border-bottom:1px solid #20232b; }
  label:last-child { border-bottom:none; }
  small { color:#868a96; display:block; }
  input[type=text] { width:100%; box-sizing:border-box; background:#111317; color:#f4f4f6; border:1px solid #2a2d36; border-radius:10px; padding:12px; font:inherit; margin-top:6px; }
  button { background:#f2c14e; color:#1a1405; border:0; border-radius:12px; padding:14px 20px; font:inherit; font-weight:800; width:100%; cursor:pointer; }
  p { color:#b9bcc6; }
</style></head><body><main><div class="brand">AD STUDIO</div>${body}</main></body></html>`;
}

export function metaPickPage({ state, clientName, pages, adAccounts }) {
  const pageRows = pages.map((p, i) => `<label><input type="radio" name="pageId" value="${esc(p.id)}" ${i === 0 ? 'checked' : ''}>
    <span>${esc(p.name)}<small>${p.instagram ? `Instagram: @${esc(p.instagram)}` : 'No Instagram business account on this Page'}</small></span></label>`).join('');
  const adRows = adAccounts.map((a) => `<label><input type="radio" name="adAccountId" value="${esc(a.id)}"><span>${esc(a.name)}<small>act_${esc(a.id)}</small></span></label>`).join('');
  return page('Choose the accounts', `
    <h1>Connect ${esc(clientName)}</h1>
    <form method="post" action="/connect/meta/finish">
      <input type="hidden" name="state" value="${esc(state)}">
      <fieldset><legend>Facebook Page (and its Instagram)</legend>${pageRows || '<p>No Pages found for this Facebook account.</p>'}</fieldset>
      <fieldset><legend>Ad account (optional)</legend><label><input type="radio" name="adAccountId" value="" checked><span>None</span></label>${adRows}</fieldset>
      <button type="submit">Save</button>
    </form>`);
}

export function googlePickPage({ state, clientName, customers }) {
  const rows = customers.filter((c) => !c.manager).map((c, i) => `<label><input type="radio" name="customerId" value="${esc(c.id)}" ${i === 0 ? 'checked' : ''}>
    <span>${esc(c.name)}<small>${esc(c.id.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3'))}</small></span></label>`).join('');
  const managers = customers.filter((c) => c.manager);
  return page('Choose the Google Ads account', `
    <h1>Connect ${esc(clientName)}</h1>
    <form method="post" action="/connect/google/finish">
      <input type="hidden" name="state" value="${esc(state)}">
      <fieldset><legend>Google Ads account</legend>${rows || '<p>No accounts found directly. Type the account ID below.</p>'}
        <label><span style="width:100%">Or type an account ID<input type="text" name="customerIdTyped" placeholder="123-456-7890"></span></label></fieldset>
      <fieldset><legend>Manager account (only if you reach the account through one)</legend>
        <label><span style="width:100%">${managers.length ? `Your manager accounts: ${managers.map((m) => `${esc(m.name)} (${esc(m.id)})`).join(', ')}` : 'Leave empty if you don’t use a manager account.'}
        <input type="text" name="loginCustomerId" placeholder="Manager account ID" value="${managers.length === 1 ? esc(managers[0].id) : ''}"></span></label></fieldset>
      <button type="submit">Save</button>
    </form>`);
}

export function donePage(clientName, what) {
  return page('Connected', `<h1>Connected</h1><p>${esc(what)} is now connected for ${esc(clientName)}. You can close this page and go back to the app.</p>`);
}

export function errorPage(message) {
  return page('Something went wrong', `<h1>Something went wrong</h1><p>${esc(message)}</p><p>Close this page and try again from the app.</p>`);
}
