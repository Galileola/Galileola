import { anonymise, isErasable, ERASE_AFTER_DAYS } from '../privacy.js';
import { csvCell } from './admin.js';
import { filesIn, writeZip } from '../zip.js';

// Admin → Customers: everyone who has joined a deal, by email address, with their orders; a CSV
// export; and erasing a person's data on request (GDPR Art. 17) where the law allows it.
export function customerRoutes(router, ctx) {
  const { repo, config } = ctx;

  router.get('/customers', (req, res) => {
    const q = String(req.query.q ?? '').slice(0, 100);
    res.render('admin/customers', {
      title: 'Customers',
      q,
      customers: repo.customers({ q }),
      flash: req.query.flash || '',
      eraseAfterDays: ERASE_AFTER_DAYS,
    });
  });

  router.get('/customers/person', (req, res, next) => {
    const email = String(req.query.email ?? '').trim();
    const signups = email ? repo.participantsByEmail(email) : [];
    if (!signups.length) return next();
    res.render('admin/customer', {
      title: email,
      email,
      signups: signups.map((p) => ({ ...p, erasable: isErasable(p) })),
      flash: req.query.flash || '',
    });
  });

  router.get('/customers.csv', (req, res) => {
    const rows = repo.customers({ limit: 100_000 });
    const lines = [
      ['email', 'name', 'sign_ups', 'paid_orders', 'paid_eur', 'countries', 'first_sign_up', 'last_sign_up'],
      ...rows.map((c) => [c.email, c.name, c.signups, c.orders, (c.paid_cents / 100).toFixed(2), c.countries, c.first_at, c.last_at]),
    ].map((cols) => cols.map(csvCell).join(','));
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="customers.csv"');
    res.send('﻿' + lines.join('\r\n') + '\r\n');
  });

  // Erasure request: anonymises every sign-up of this person that never led to a payment. Paid
  // orders stay (accounting and tax law); the page says so.
  router.post('/customers/erase', async (req, res, next) => {
    try {
      const email = String(req.body.email ?? '').trim();
      const signups = repo.participantsByEmail(email);
      if (!signups.length) return next();
      let erased = 0;
      for (const p of signups) if (await anonymise(ctx, repo.participantById(p.id))) erased += 1;
      const kept = signups.length - erased;
      const flash = `${erased} sign-up${erased === 1 ? '' : 's'} anonymised.${kept ? ` ${kept} paid or active order${kept === 1 ? ' was' : 's were'} kept: the law requires order and accounting records.` : ''}`;
      const left = repo.participantsByEmail(email).length;
      res.redirect(303, left ? `/admin/customers/person?email=${encodeURIComponent(email)}&flash=${encodeURIComponent(flash)}` : `/admin/customers?flash=${encodeURIComponent(flash)}`);
    } catch (err) {
      next(err);
    }
  });

  // Off-site copy of the product photos and logos (the database backup doesn't include them).
  router.get('/photos.zip', async (req, res, next) => {
    try {
      const files = filesIn(config.uploadDir);
      const stamp = new Date().toISOString().slice(0, 10);
      res.set('Content-Type', 'application/zip');
      res.set('Content-Disposition', `attachment; filename="groupbuy-photos-${stamp}.zip"`);
      await writeZip(res, files);
      res.end();
    } catch (err) {
      if (res.headersSent) return res.destroy(err);
      next(err);
    }
  });
}
