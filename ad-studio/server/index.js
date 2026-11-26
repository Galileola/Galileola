import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { FORMATS, FORMAT_IDS } from './src/formats.js';
import { STYLES, STYLE_IDS } from './src/styles.js';
import { claudeConfigured, CLAUDE_MODEL } from './src/director.js';
import { falConfigured, FAL_MODELS } from './src/fal.js';
import { OUTPUT_DIR, createJob, getJob, publicJob, runningCount, startCleanup } from './src/jobs.js';
import { runJob, retypeset, redoFormat } from './src/pipeline.js';
import { makeVideo } from './src/video.js';

const app = express();
const MAX_RUNNING = Number(process.env.MAX_RUNNING_JOBS) || 3;
const IMAGE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use('/files', express.static(OUTPUT_DIR, { maxAge: '1d', fallthrough: false }));

// With APP_TOKEN set, only the app (which sends the same token) can spend credits.
app.use('/api', (req, res, next) => {
  const token = process.env.APP_TOKEN;
  if (token && req.get('x-app-token') !== token) return res.status(401).json({ error: 'Not allowed' });
  next();
});

app.get('/health', (req, res) => {
  res.json({ ok: true, claude: claudeConfigured(), fal: falConfigured() });
});

app.get('/api/options', (req, res) => {
  res.json({
    styles: [{ id: 'auto', label: 'Auto' }, ...STYLE_IDS.map((id) => ({ id, label: STYLES[id].label }))],
    formats: FORMAT_IDS.map((id) => ({ id, label: FORMATS[id].label, width: FORMATS[id].width, height: FORMATS[id].height })),
    languages: [{ id: 'en', label: 'English' }, { id: 'ru', label: 'Русский' }, { id: 'et', label: 'Eesti' }],
    models: { director: CLAUDE_MODEL, ...FAL_MODELS },
  });
});

function text(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

app.post('/api/jobs', (req, res) => {
  if (!claudeConfigured() || !falConfigured()) return res.status(503).json({ error: 'The server’s AI keys are not set up yet.' });
  const b = req.body || {};
  if (typeof b.photo !== 'string' || !IMAGE.test(b.photo)) return res.status(400).json({ error: 'Send a JPEG, PNG or WebP photo.' });
  if (b.photo.length > 16_000_000) return res.status(413).json({ error: 'The photo is too large.' });
  if (b.logo && (typeof b.logo !== 'string' || !IMAGE.test(b.logo) || b.logo.length > 3_000_000)) return res.status(400).json({ error: 'The logo must be a PNG or JPEG under 2 MB.' });
  const formats = Array.isArray(b.formats) ? [...new Set(b.formats.filter((f) => FORMAT_IDS.includes(f)))] : [];
  if (!formats.length) return res.status(400).json({ error: 'Choose at least one size.' });
  const style = b.style === 'auto' || STYLE_IDS.includes(b.style) ? b.style : 'auto';
  const language = ['en', 'ru', 'et'].includes(b.language) ? b.language : 'en';
  if (runningCount() >= MAX_RUNNING) return res.status(429).json({ error: 'The studio is busy. Try again in a minute.' });

  const job = createJob({
    photo: b.photo,
    logo: b.logo || null,
    brand: text(b.brand, 60),
    offer: text(b.offer, 160),
    details: text(b.details, 500),
    style,
    language,
    formats,
  });
  runJob(job);
  res.status(202).json(publicJob(job));
});

app.get('/api/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'This ad has expired.' });
  res.json(publicJob(job));
});

app.post('/api/jobs/:id/text', async (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'This ad has expired.' });
  if (job.status !== 'done') return res.status(409).json({ error: 'The ad is not finished yet.' });
  const c = req.body?.copy || {};
  const copy = {};
  for (const [key, max] of [['headline', 40], ['subline', 80], ['cta', 24], ['badge', 12]]) {
    if (typeof c[key] === 'string') copy[key] = c[key].trim().slice(0, max);
  }
  if (copy.headline === '') return res.status(400).json({ error: 'The headline can’t be empty.' });
  const style = STYLE_IDS.includes(req.body?.style) ? req.body.style : undefined;
  await retypeset(job, { copy, style });
  res.json(publicJob(job));
});

app.post('/api/jobs/:id/redo', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'This ad has expired.' });
  const formatId = req.body?.format;
  const stage = job.formats[formatId]?.stage;
  if (job.status !== 'done' || !['done', 'error'].includes(stage)) return res.status(409).json({ error: 'This size is still being made.' });
  if (runningCount() >= MAX_RUNNING) return res.status(429).json({ error: 'The studio is busy. Try again in a minute.' });
  redoFormat(job, formatId);
  res.status(202).json(publicJob(job));
});

app.post('/api/jobs/:id/video', async (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'This ad has expired.' });
  const formatId = req.body?.format;
  if (job.formats[formatId]?.stage !== 'done') return res.status(409).json({ error: 'Make the banner for this size first.' });
  const current = job.videos[formatId]?.status;
  if (current && current !== 'error' && current !== 'done') return res.status(409).json({ error: 'This video is already being made.' });
  try {
    await makeVideo(job, formatId);
  } catch (err) {
    console.error(`[${job.id}] video start failed:`, err.message);
    job.videos[formatId] = { status: 'error', error: 'The video could not be started. Please try again.' };
  }
  res.status(202).json(publicJob(job));
});

app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'The upload is too large.' });
  if (err?.status === 404) return res.status(404).json({ error: 'Not found' });
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

startCleanup();
const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Ad Studio server on port ${port} (Claude: ${claudeConfigured() ? 'ready' : 'missing key'}, fal.ai: ${falConfigured() ? 'ready' : 'missing key'})`);
});
