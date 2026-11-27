import { db, now, parse } from './db.js';
import { newId, persist } from './jobs.js';
import { FORMATS } from './formats.js';

// The approval link: a page the agency sends to its client. The client
// sees the ads and approves each one or asks for changes. No password,
// but the link is long and random.

const T = {
  en: {
    title: 'Your ads are ready for review',
    intro: 'Please approve each ad or tell us what to change.',
    approve: 'Approve', changes: 'Request changes', placeholder: 'What should we change?', send: 'Send',
    approved: 'Approved', requested: 'Changes requested', pending: 'Waiting for your decision',
    thanks: 'Thank you! We’ve received your feedback.', video: 'Video', presenter: 'Presenter video', download: 'Download',
    name: 'Your name (optional)', expired: 'This review link is no longer valid.',
  },
  ru: {
    title: 'Ваша реклама готова к согласованию',
    intro: 'Пожалуйста, утвердите каждый вариант или напишите, что изменить.',
    approve: 'Утвердить', changes: 'Нужны правки', placeholder: 'Что нужно изменить?', send: 'Отправить',
    approved: 'Утверждено', requested: 'Запрошены правки', pending: 'Ожидает вашего решения',
    thanks: 'Спасибо! Мы получили ваш ответ.', video: 'Видео', presenter: 'Видео с ведущим', download: 'Скачать',
    name: 'Ваше имя (необязательно)', expired: 'Эта ссылка больше не действует.',
  },
  et: {
    title: 'Teie reklaamid on ülevaatamiseks valmis',
    intro: 'Palun kinnitage iga reklaam või kirjutage, mida muuta.',
    approve: 'Kinnita', changes: 'Soovin muudatusi', placeholder: 'Mida peaksime muutma?', send: 'Saada',
    approved: 'Kinnitatud', requested: 'Muudatused soovitud', pending: 'Ootab teie otsust',
    thanks: 'Aitäh! Saime teie tagasiside kätte.', video: 'Video', presenter: 'Esitlejaga video', download: 'Laadi alla',
    name: 'Teie nimi (valikuline)', expired: 'See link ei kehti enam.',
  },
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function getReview(token) {
  const row = db.prepare('SELECT job_id, data FROM reviews WHERE token = ?').get(token);
  return row ? { token, jobId: row.job_id, ...JSON.parse(row.data) } : null;
}

function saveReview(review) {
  const { token, jobId, ...data } = review;
  db.prepare('UPDATE reviews SET data = ? WHERE token = ?').run(JSON.stringify(data), token);
}

/** Returns the job's review link token, creating it the first time. */
export function reviewToken(job) {
  const row = db.prepare('SELECT token FROM reviews WHERE job_id = ?').get(job.id);
  if (row) return row.token;
  const token = newId(18);
  db.prepare('INSERT INTO reviews (token, job_id, data, created_at) VALUES (?, ?, ?, ?)').run(token, job.id, JSON.stringify({ decisions: {} }), now());
  job.approval = { token, status: 'pending', decisions: {} };
  persist(job);
  return token;
}

// Overall status: approved when every finished size is approved.
function summarise(job, decisions) {
  const sizes = Object.entries(job.formats).filter(([, f]) => f.stage === 'done').map(([id]) => id);
  if (sizes.some((id) => decisions[id]?.status === 'changes')) return 'changes';
  if (sizes.length && sizes.every((id) => decisions[id]?.status === 'approved')) return 'approved';
  return 'pending';
}

/** Records the client's decision for one size. */
export function decide(job, review, { format, status, comment, name }) {
  review.decisions[format] = { status, comment: comment || '', name: name || '', at: now() };
  saveReview(review);
  job.approval = { token: review.token, status: summarise(job, review.decisions), decisions: review.decisions };
  persist(job);
  return job.approval;
}

/** The review page. */
export function reviewPage(job, review, clientName) {
  const t = T[job.request.language] || T.en;
  const label = { approved: t.approved, changes: t.requested };
  const cards = Object.entries(job.formats)
    .filter(([, f]) => f.stage === 'done' && f.banner)
    .map(([id, f]) => {
      const d = review.decisions[id];
      const video = job.videos?.[id]?.status === 'done' ? job.videos[id].url : null;
      return `
      <section class="card" data-format="${esc(id)}">
        <h2>${esc(FORMATS[id]?.label || id)}</h2>
        <img src="${esc(f.banner)}" alt="${esc(job.brief?.copy?.headline)}" loading="lazy">
        ${video ? `<p class="label">${esc(t.video)}</p><video src="${esc(video)}" controls playsinline muted loop></video>` : ''}
        <p class="links"><a href="${esc(f.banner)}" download>${esc(t.download)}</a>${video ? ` · <a href="${esc(video)}" download>${esc(t.download)} (${esc(t.video)})</a>` : ''}</p>
        <p class="status ${d ? esc(d.status) : ''}">${esc(d ? label[d.status] : t.pending)}${d?.comment ? `: “${esc(d.comment)}”` : ''}</p>
        <div class="actions">
          <button class="approve" type="button">${esc(t.approve)}</button>
          <button class="changes" type="button">${esc(t.changes)}</button>
        </div>
        <form class="comment" hidden>
          <textarea maxlength="1000" placeholder="${esc(t.placeholder)}" required></textarea>
          <button type="submit">${esc(t.send)}</button>
        </form>
      </section>`;
    })
    .join('');
  const avatar = job.avatar?.status === 'done' ? `<section class="card"><h2>${esc(t.presenter)}</h2><video src="${esc(job.avatar.url)}" controls playsinline></video><p class="links"><a href="${esc(job.avatar.url)}" download>${esc(t.download)}</a></p></section>` : '';

  return `<!doctype html>
<html lang="${esc(job.request.language || 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(clientName || job.request.brand || 'Ads')} · ${esc(t.title)}</title>
<style>
  :root { --bg:#f6f5f2; --card:#fff; --ink:#16171c; --soft:#5c5f6a; --line:#e4e2dc; --ok:#1f7a4d; --warn:#a8580b; --gold:#c99a2e; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  main { max-width:760px; margin:0 auto; padding:24px 16px 64px; }
  .brand { font-weight:800; letter-spacing:.18em; color:var(--gold); font-size:13px; text-transform:uppercase; }
  h1 { font-size:26px; line-height:1.2; margin:6px 0 4px; }
  .intro { color:var(--soft); margin:0 0 20px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:16px; padding:16px; margin-bottom:18px; }
  .card h2 { font-size:17px; margin:0 0 12px; }
  img, video { width:100%; height:auto; border-radius:10px; display:block; background:#eee; }
  .label { margin:14px 0 6px; font-weight:700; }
  .links { font-size:14px; margin:10px 0 0; }
  .links a { color:var(--ink); }
  .status { margin:12px 0; font-weight:700; color:var(--soft); }
  .status.approved { color:var(--ok); }
  .status.changes { color:var(--warn); }
  .actions { display:flex; gap:10px; flex-wrap:wrap; }
  button { font:inherit; font-weight:700; border-radius:12px; padding:12px 18px; border:1px solid var(--line); background:#fff; color:var(--ink); cursor:pointer; min-height:46px; }
  button.approve { background:var(--ink); color:#fff; border-color:var(--ink); }
  textarea { width:100%; min-height:90px; margin:12px 0 8px; padding:12px; font:inherit; border-radius:10px; border:1px solid var(--line); }
  .who { width:100%; padding:12px; font:inherit; border-radius:10px; border:1px solid var(--line); margin-bottom:18px; }
  .thanks { background:#e9f5ee; color:var(--ok); border-radius:12px; padding:12px 14px; font-weight:700; }
</style>
</head>
<body>
<main>
  <div class="brand">${esc(clientName || job.request.brand || '')}</div>
  <h1>${esc(t.title)}</h1>
  <p class="intro">${esc(t.intro)}</p>
  <input class="who" type="text" maxlength="60" placeholder="${esc(t.name)}" aria-label="${esc(t.name)}">
  <p class="thanks" hidden>${esc(t.thanks)}</p>
  ${cards}
  ${avatar}
</main>
<script>
  const who = document.querySelector('.who');
  try { who.value = localStorage.getItem('reviewer') || ''; } catch (e) {}
  const labels = ${JSON.stringify({ approved: t.approved, changes: t.requested })};
  async function send(card, status, comment) {
    try { localStorage.setItem('reviewer', who.value); } catch (e) {}
    const res = await fetch(location.pathname, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ format: card.dataset.format, status, comment, name: who.value }) });
    if (!res.ok) { alert('Error'); return; }
    const s = card.querySelector('.status');
    s.className = 'status ' + status;
    s.textContent = labels[status] + (comment ? ': “' + comment + '”' : '');
    card.querySelector('.comment').hidden = true;
    document.querySelector('.thanks').hidden = false;
  }
  document.querySelectorAll('.card[data-format]').forEach((card) => {
    card.querySelector('.approve').onclick = () => send(card, 'approved', '');
    card.querySelector('.changes').onclick = () => { const f = card.querySelector('.comment'); f.hidden = false; f.querySelector('textarea').focus(); };
    card.querySelector('.comment').onsubmit = (e) => { e.preventDefault(); send(card, 'changes', e.target.querySelector('textarea').value.trim()); };
  });
</script>
</body>
</html>`;
}

export function expiredPage() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Link expired</title></head>
<body style="font:16px -apple-system,Segoe UI,Roboto,sans-serif;padding:40px 16px;text-align:center;color:#333">
<p>${esc(T.en.expired)}<br>${esc(T.ru.expired)}<br>${esc(T.et.expired)}</p></body></html>`;
}
