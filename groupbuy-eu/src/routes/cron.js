import { safeEqual } from '../util.js';
import { backupDb } from '../db.js';

// Endpoints for an external scheduler (e.g. an hPanel cron job running curl every minute):
//   POST /api/cron/tick     run the scheduler (answers 202 at once; add ?wait=1 to wait for it)
//   POST /api/cron/backup   write a consistent copy of the database to BACKUP_DIR
// Both need "Authorization: Bearer $CRON_SECRET".
export function cronRoutes(app, { config, engine, repo, clock }) {
  const authorized = (req) => {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    return !!config.cronSecret && safeEqual(token, config.cronSecret);
  };

  app.post('/api/cron/tick', async (req, res, next) => {
    if (!config.cronSecret) return res.status(404).end();
    if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' });
    const run = engine.tick();
    if (req.query.wait !== '1') {
      // Managed hosts cut requests off (Hostinger: 120 s), so don't make the cron call wait.
      run.catch((err) => console.error('[cron] tick failed:', err));
      return res.status(202).json({ ok: true, started: true });
    }
    try {
      const ran = await run;
      res.json({ ok: true, ran: ran !== false });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/cron/backup', (req, res, next) => {
    if (!config.cronSecret) return res.status(404).end();
    if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' });
    try {
      const file = backupDb(repo.db, config.backupDir, { keep: config.backupKeep, now: clock.now() });
      res.json({ ok: true, file });
    } catch (err) {
      next(err);
    }
  });

  // For uptime monitors: checks that the app and its database answer.
  app.get('/healthz', (req, res) => {
    try {
      repo.db.prepare('SELECT 1').get();
      res.set('Cache-Control', 'no-store').json({ ok: true });
    } catch (err) {
      res.status(503).json({ ok: false });
    }
  });
}
