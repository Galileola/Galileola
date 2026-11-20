// The legal pages (terms, privacy, cookies) as plain text the shop owner can edit in the admin,
// one version per language. The format is a small, safe subset of Markdown:
//
//   # Page title                      ## Section heading {#withdrawal}   ### Sub-heading
//   Lines next to each other form a paragraph; a blank line starts a new one.
//   - Bullet point                    > Highlighted note
//   | Column | Column |  (a table; the first row is the header)
//   **bold**   [link text](https://example.com)   `code`
//   [cookie-settings: Change cookie settings]  (the button that reopens the cookie choice)
//
// Everything is HTML-escaped first, so text typed here can never add scripts or other markup.

export const LEGAL_PAGES = ['terms', 'privacy', 'cookies'];
export const MAX_LEGAL_TEXT = 60_000;

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const safeUrl = (url) => /^(https?:\/\/|\/|#|mailto:)/i.test(url) && !/^\/\//.test(url);

function inline(text) {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
    const href = url.replace(/&amp;/g, '&');
    if (!safeUrl(href)) return m;
    const external = /^https?:\/\//i.test(href) ? ' rel="noopener"' : '';
    return `<a href="${escapeHtml(href)}"${external}>${label}</a>`;
  });
  return out;
}

const cells = (line) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

export function renderLegalText(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let block = null; // { type: 'p' | 'ul' | 'note' | 'table', items: [] }

  const flush = () => {
    if (!block) return;
    if (block.type === 'p') out.push(`<p>${block.items.map(inline).join('<br>')}</p>`);
    if (block.type === 'note') out.push(`<div class="notice warn small">${block.items.map(inline).join('<br>')}</div>`);
    if (block.type === 'ul') out.push(`<ul>${block.items.map((i) => `<li>${inline(i)}</li>`).join('')}</ul>`);
    if (block.type === 'table') {
      const rows = block.items.filter((r) => !/^\|?[\s:|-]+\|?$/.test(r.trim()));
      const [head, ...body] = rows.map(cells);
      out.push(
        '<table><thead><tr>' +
          head.map((c) => `<th>${inline(c)}</th>`).join('') +
          '</tr></thead><tbody>' +
          body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('') +
          '</tbody></table>'
      );
    }
    block = null;
  };
  const add = (type, item) => {
    if (!block || block.type !== type) {
      flush();
      block = { type, items: [] };
    }
    block.items.push(item);
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = /^(#{1,3})\s+(.*?)(?:\s*\{#([A-Za-z0-9_-]+)\})?\s*$/.exec(line);
    const button = /^\[cookie-settings:\s*(.+?)\]\s*$/.exec(line.trim());
    if (!line.trim()) flush();
    else if (heading) {
      flush();
      const level = heading[1].length;
      out.push(`<h${level}${heading[3] ? ` id="${heading[3]}"` : ''}>${inline(heading[2])}</h${level}>`);
    } else if (button) {
      flush();
      out.push(`<p><button type="button" class="secondary" data-cookie-settings>${inline(button[1])}</button></p>`);
    } else if (/^\s*[-*]\s+/.test(line)) add('ul', line.replace(/^\s*[-*]\s+/, ''));
    else if (/^>\s?/.test(line)) add('note', line.replace(/^>\s?/, ''));
    else if (/^\s*\|/.test(line)) add('table', line);
    else add('p', line.trim());
  }
  flush();
  return out.join('\n');
}

// The built-in English pages (HTML from views/legal/*-body.ejs) as editable text, so the owner
// starts from the current wording instead of an empty box.
export function htmlToLegalText(html) {
  const decode = (s) =>
    s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const inlineText = (s) =>
    decode(
      s
        .replace(/<br\s*\/?>/g, '\n')
        .replace(/<strong>([\s\S]*?)<\/strong>/g, '**$1**')
        .replace(/<code>([\s\S]*?)<\/code>/g, '`$1`')
        .replace(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g, '[$2]($1)')
        .replace(/<[^>]+>/g, '')
    )
      .split('\n')
      .map((l) => l.replace(/\s+/g, ' ').trim())
      .join('\n');

  const blocks = [];
  const re =
    /<div class="notice[^"]*">([\s\S]*?)<\/div>|<h([1-3])(?: id="([^"]+)")?>([\s\S]*?)<\/h\2>|<ul>([\s\S]*?)<\/ul>|<table>([\s\S]*?)<\/table>|<p><button[^>]*data-cookie-settings[^>]*>([\s\S]*?)<\/button><\/p>|<p>([\s\S]*?)<\/p>/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[1] !== undefined) blocks.push(inlineText(m[1]).split('\n').map((l) => `> ${l}`).join('\n'));
    else if (m[2]) blocks.push(`${'#'.repeat(Number(m[2]))} ${inlineText(m[4])}${m[3] ? ` {#${m[3]}}` : ''}`);
    else if (m[5] !== undefined) blocks.push([...m[5].matchAll(/<li>([\s\S]*?)<\/li>/g)].map((li) => `- ${inlineText(li[1]).replace(/\n/g, ' ')}`).join('\n'));
    else if (m[6] !== undefined) {
      const rows = [...m[6].matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((tr) =>
        [...tr[1].matchAll(/<t[hd]>([\s\S]*?)<\/t[hd]>/g)].map((c) => inlineText(c[1]).replace(/\n/g, ' ').replace(/\|/g, '/'))
      );
      if (rows.length) {
        const lines = rows.map((r) => `| ${r.join(' | ')} |`);
        lines.splice(1, 0, `|${rows[0].map(() => '---').join('|')}|`);
        blocks.push(lines.join('\n'));
      }
    } else if (m[7] !== undefined) blocks.push(`[cookie-settings: ${inlineText(m[7])}]`);
    else if (m[8] !== undefined) blocks.push(inlineText(m[8]));
  }
  return blocks.join('\n\n') + '\n';
}
