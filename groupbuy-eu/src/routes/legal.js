export function legalRoutes(app) {
  app.get('/terms', (req, res) => res.render('legal/terms', { title: 'Terms and right of withdrawal' }));
  app.get('/privacy', (req, res) => res.render('legal/privacy', { title: 'Privacy policy' }));
  app.get('/cookies', (req, res) => res.render('legal/cookies', { title: 'Cookies' }));
}
