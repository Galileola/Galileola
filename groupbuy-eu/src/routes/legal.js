import { renderLegalText } from '../legalText.js';

// The legal pages. For the visitor's language the shop shows, in this order:
//  1. the text the owner wrote for that language in the admin (Admin → Legal pages);
//  2. otherwise the English text (the owner's, or the built-in views/legal/*-body.ejs),
//     translated by Claude and kept in the database (only when ANTHROPIC_API_KEY is set);
//  3. otherwise the English text itself.
export const LEGAL_PAGE_INFO = {
  terms: { route: '/terms', view: 'legal/terms-body', title: 'legal.termsTitle' },
  privacy: { route: '/privacy', view: 'legal/privacy-body', title: 'legal.privacyTitle' },
  cookies: { route: '/cookies', view: 'legal/cookies-body', title: 'legal.cookiesTitle' },
};

const renderView = (app, view, locals) =>
  new Promise((resolve, reject) => app.render(view, locals, (err, html) => (err ? reject(err) : resolve(html))));

// The English page as HTML: the owner's English text if there is one, else the built-in page.
export async function englishLegalHtml(app, ctx, page, locals) {
  const own = ctx.repo?.legalText(page, 'en');
  return own ? renderLegalText(own.body) : renderView(app, LEGAL_PAGE_INFO[page].view, locals);
}

export function legalRoutes(app, ctx = {}) {
  for (const [page, info] of Object.entries(LEGAL_PAGE_INFO)) {
    app.get(info.route, async (req, res, next) => {
      try {
        const { lang, t } = res.locals;
        // ?original=1 shows the English text without switching the whole site to English.
        const wantsOriginal = req.query.original === '1';
        const own = !wantsOriginal && lang !== 'en' ? ctx.repo?.legalText(page, lang) : null;
        let result;
        if (own) {
          result = { html: renderLegalText(own.body), translated: false, pending: false, contentLang: lang };
        } else {
          const englishHtml = await englishLegalHtml(app, ctx, page, { ...res.locals });
          const auto = ctx.translator && !wantsOriginal ? ctx.translator.html(englishHtml, lang) : null;
          result = auto
            ? { ...auto, contentLang: auto.translated ? lang : 'en' }
            : { html: englishHtml, translated: false, pending: false, contentLang: 'en' };
        }
        res.render('legal/page', {
          title: t(info.title),
          bodyHtml: result.html,
          translated: result.translated,
          pending: result.pending,
          contentLang: result.contentLang,
          // No text in the visitor's language yet (and no automatic translation coming).
          englishOnly: lang !== 'en' && !wantsOriginal && result.contentLang === 'en' && !result.pending,
        });
      } catch (err) {
        next(err);
      }
    });
  }
}
