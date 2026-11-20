// The legal pages are written in English (views/legal/*-body.ejs). Other languages get a
// translation made by Claude, kept in the database; until it exists, the English text is shown.
const PAGES = {
  '/terms': { view: 'legal/terms-body', title: 'legal.termsTitle' },
  '/privacy': { view: 'legal/privacy-body', title: 'legal.privacyTitle' },
  '/cookies': { view: 'legal/cookies-body', title: 'legal.cookiesTitle' },
};

export function legalRoutes(app, ctx = {}) {
  for (const [route, page] of Object.entries(PAGES)) {
    app.get(route, (req, res, next) => {
      // The English text, with the business details filled in, is the source for every language.
      app.render(page.view, { ...res.locals }, (err, englishHtml) => {
        if (err) return next(err);
        const { lang, t } = res.locals;
        // ?original=1 shows the English text without switching the whole site to English.
        const wantsOriginal = req.query.original === '1';
        const result = ctx.translator && !wantsOriginal
          ? ctx.translator.html(englishHtml, lang)
          : { html: englishHtml, translated: false, pending: false };
        res.render('legal/page', {
          title: t(page.title),
          bodyHtml: result.html,
          translated: result.translated,
          pending: result.pending,
        });
      });
    });
  }
}
