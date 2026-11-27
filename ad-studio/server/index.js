import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { FORMATS, FORMAT_IDS } from './src/formats.js';
import { STYLES, STYLE_IDS } from './src/styles.js';
import { claudeConfigured, CLAUDE_MODEL, writeSlogans } from './src/director.js';
import { falConfigured, FAL_MODELS } from './src/fal.js';
import { OUTPUT_DIR, createJob, getJob, listJobs, publicJob, persist, filePath, startHousekeeping } from './src/jobs.js';
import { enqueue, queueLength, resumeQueue, retypeset, redoFormat } from './src/pipeline.js';
import { makeVideo, resumeVideos } from './src/video.js';
import { makeAvatar } from './src/avatar.js';
import { listClients, getClient, publicClient, saveClient, deleteClient } from './src/clients.js';
import { reviewToken, getReview, decide, reviewPage, expiredPage } from './src/review.js';
import { readShop, parseCsv } from './src/shop.js';
import { startBatch, getBatch, listBatches, batchJobs } from './src/batches.js';
import {
  TARGETS, publishingSetup, baseUrl, publish, suggestCaption, disconnect,
  metaConnectUrl, metaCallback, metaFinish, googleConnectUrl, googleCallback, googleFinish,
} from './src/publish.js';
import { metaPickPage, googlePickPage, donePage, errorPage } from './src/pages.js';

const app = express();
const IMAGE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const LANGS = ['en', 'ru', 'et'];

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use('/files', express.static(OUTPUT_DIR, { maxAge: '7d', fallthrough: false }));

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const userError = (res, err, status = 400) => res.status(err.status && err.status < 500 ? err.status : status).json({ error: err.userMessage || 'Something went wrong.' });

// ---------- Public pages: health, client review, account sign-in ----------

app.get('/health', (req, res) => {
  res.json({ ok: true, claude: claudeConfigured(), fal: falConfigured(), publishing: publishingSetup(), passwordRequired: Boolean(process.env.APP_TOKEN) });
});

app.get('/review/:token', (req, res) => {
  const review = getReview(req.params.token);
  const job = review && getJob(review.jobId);
  if (!job) return res.status(404).type('html').send(expiredPage());
  res.type('html').send(reviewPage(job, review, job.clientId ? getClient(job.clientId)?.name : job.request.brand));
});

app.post('/review/:token', (req, res) => {
  const review = getReview(req.params.token);
  const job = review && getJob(review.jobId);
  if (!job) return res.status(404).json({ error: 'Expired' });
  const { format, status } = req.body || {};
  if (!job.formats[format] || !['approved', 'changes'].includes(status)) return res.status(400).json({ error: 'Bad request' });
  res.json(decide(job, review, { format, status, comment: text(req.body.comment, 1000), name: text(req.body.name, 60) }));
});

app.get('/connect/meta/callback', async (req, res) => {
  try {
    if (req.query.error) throw Object.assign(new Error('Declined'), { userMessage: 'Facebook sign-in was cancelled.' });
    const info = await metaCallback({ code: req.query.code, state: req.query.state });
    res.type('html').send(metaPickPage({ state: req.query.state, ...info }));
  } catch (err) {
    console.error('Meta connect:', err.message);
    res.status(400).type('html').send(errorPage(err.userMessage || 'Facebook sign-in failed.'));
  }
});

app.post('/connect/meta/finish', (req, res) => {
  try {
    const name = metaFinish({ state: req.body.state, pageId: req.body.pageId, adAccountId: req.body.adAccountId });
    res.type('html').send(donePage(name, 'Facebook and Instagram'));
  } catch (err) {
    res.status(400).type('html').send(errorPage(err.userMessage || 'Saving failed.'));
  }
});

app.get('/connect/google/callback', async (req, res) => {
  try {
    if (req.query.error) throw Object.assign(new Error('Declined'), { userMessage: 'Google sign-in was cancelled.' });
    const info = await googleCallback({ code: req.query.code, state: req.query.state });
    res.type('html').send(googlePickPage({ state: req.query.state, ...info }));
  } catch (err) {
    console.error('Google connect:', err.message);
    res.status(400).type('html').send(errorPage(err.userMessage || 'Google sign-in failed.'));
  }
});

app.post('/connect/google/finish', (req, res) => {
  try {
    const name = googleFinish({ state: req.body.state, customerId: req.body.customerIdTyped || req.body.customerId, loginCustomerId: req.body.loginCustomerId });
    res.type('html').send(donePage(name, 'Google Ads'));
  } catch (err) {
    res.status(400).type('html').send(errorPage(err.userMessage || 'Saving failed.'));
  }
});

// ---------- The app's API (needs the app password when APP_TOKEN is set) ----------

app.use('/api', (req, res, next) => {
  const token = process.env.APP_TOKEN;
  if (token && req.get('x-app-token') !== token) return res.status(401).json({ error: 'Wrong app password.' });
  next();
});

app.get('/api/options', (req, res) => {
  res.json({
    styles: [{ id: 'auto', label: 'Auto' }, ...STYLE_IDS.map((id) => ({ id, label: STYLES[id].label }))],
    formats: FORMAT_IDS.map((id) => ({ id, label: FORMATS[id].label, width: FORMATS[id].width, height: FORMATS[id].height })),
    languages: [{ id: 'en', label: 'English' }, { id: 'ru', label: 'Русский' }, { id: 'et', label: 'Eesti' }],
    publishing: publishingSetup(),
    models: { director: CLAUDE_MODEL, ...FAL_MODELS },
  });
});

// Clients (brand kits)

app.get('/api/clients', (req, res) => res.json(listClients()));

app.get('/api/clients/:id', (req, res) => {
  const client = publicClient(getClient(req.params.id));
  if (!client) return res.status(404).json({ error: 'Client not found.' });
  res.json(client);
});

app.post('/api/clients', async (req, res) => {
  try {
    res.status(201).json(await saveClient(null, req.body || {}));
  } catch (err) {
    userError(res, err);
  }
});

app.put('/api/clients/:id', async (req, res) => {
  try {
    const client = await saveClient(req.params.id, req.body || {});
    if (!client) return res.status(404).json({ error: 'Client not found.' });
    res.json(client);
  } catch (err) {
    userError(res, err);
  }
});

app.delete('/api/clients/:id', (req, res) => {
  deleteClient(req.params.id);
  res.json({ ok: true });
});

app.post('/api/clients/:id/connect/:provider', (req, res) => {
  if (!getClient(req.params.id)) return res.status(404).json({ error: 'Client not found.' });
  try {
    const base = baseUrl(req);
    const url = req.params.provider === 'meta' ? metaConnectUrl(req.params.id, base)
      : req.params.provider === 'google' ? googleConnectUrl(req.params.id, base)
      : null;
    if (!url) return res.status(400).json({ error: 'Unknown service.' });
    res.json({ url });
  } catch (err) {
    userError(res, err, 503);
  }
});

app.delete('/api/clients/:id/connect/:provider', (req, res) => {
  if (!['meta', 'google'].includes(req.params.provider)) return res.status(400).json({ error: 'Unknown service.' });
  disconnect(req.params.id, req.params.provider);
  res.json(publicClient(getClient(req.params.id)));
});

// The ad request, filled from the client's brand kit where the app left gaps.
function adRequest(body, client) {
  const formats = Array.isArray(body.formats) ? [...new Set(body.formats.filter((f) => FORMAT_IDS.includes(f)))] : [];
  const style = body.style === 'auto' || STYLE_IDS.includes(body.style) ? body.style : client?.style || 'auto';
  return {
    brand: text(body.brand, 60) || client?.name || '',
    about: client?.about || '',
    tone: client?.tone || '',
    website: client?.website || '',
    primary: client?.primary || '',
    accent: client?.accent || '',
    offer: text(body.offer, 160),
    details: text(body.details, 600),
    style,
    language: LANGS.includes(body.language) ? body.language : client?.language || 'en',
    formats: formats.length ? formats : client?.formats || ['post', 'story'],
  };
}

function clientLogo(client) {
  const file = client?.logo && filePath(client.logo);
  return file && fs.existsSync(file) ? fs.readFileSync(file) : null;
}

function requireAi(res) {
  if (claudeConfigured() && falConfigured()) return false;
  res.status(503).json({ error: 'The server’s AI keys are not set up yet.' });
  return true;
}

// Ads (jobs)

app.post('/api/jobs', async (req, res) => {
  if (requireAi(res)) return;
  const b = req.body || {};
  if (typeof b.photo !== 'string' || !IMAGE.test(b.photo)) return res.status(400).json({ error: 'Send a JPEG, PNG or WebP photo.' });
  if (b.photo.length > 16_000_000) return res.status(413).json({ error: 'The photo is too large.' });
  if (b.logo && (typeof b.logo !== 'string' || !IMAGE.test(b.logo) || b.logo.length > 3_000_000)) return res.status(400).json({ error: 'The logo must be a PNG or JPEG under 2 MB.' });
  const client = b.clientId ? getClient(b.clientId) : null;
  if (b.clientId && !client) return res.status(404).json({ error: 'Client not found.' });
  try {
    const job = await createJob(adRequest(b, client), { photo: b.photo, logo: b.logo || clientLogo(client), clientId: client?.id || null });
    enqueue(job);
    res.status(202).json({ ...publicJob(job), waiting: queueLength() });
  } catch (err) {
    console.error('Create job:', err);
    userError(res, err);
  }
});

app.get('/api/jobs', (req, res) => {
  const jobs = listJobs({ clientId: req.query.client || undefined, limit: Math.min(Number(req.query.limit) || 30, 100) });
  res.json(jobs.map((j) => ({
    id: j.id, createdAt: j.createdAt, status: j.status, clientId: j.clientId, batchId: j.batchId,
    brand: j.request.brand, headline: j.brief?.copy?.headline || null,
    thumb: Object.values(j.formats).find((f) => f.banner)?.banner || j.photo,
    approval: j.approval?.status || null,
  })));
});

app.get('/api/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'This ad has expired.' });
  res.json(publicJob(job));
});

function finishedJob(req, res) {
  const job = getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'This ad has expired.' });
    return null;
  }
  if (job.status !== 'done') {
    res.status(409).json({ error: 'The ad is not finished yet.' });
    return null;
  }
  return job;
}

app.post('/api/jobs/:id/text', async (req, res) => {
  const job = finishedJob(req, res);
  if (!job) return;
  const c = req.body?.copy || {};
  const copy = {};
  for (const [key, max] of [['headline', 48], ['subline', 90], ['cta', 24], ['badge', 12]]) {
    if (typeof c[key] === 'string') copy[key] = c[key].trim().slice(0, max);
  }
  if (copy.headline === '') return res.status(400).json({ error: 'The headline can’t be empty.' });
  const style = STYLE_IDS.includes(req.body?.style) ? req.body.style : undefined;
  await retypeset(job, { copy, style });
  res.json(publicJob(job));
});

app.post('/api/jobs/:id/redo', (req, res) => {
  const job = finishedJob(req, res);
  if (!job) return;
  const formatId = req.body?.format;
  if (!['done', 'error'].includes(job.formats[formatId]?.stage)) return res.status(409).json({ error: 'This size is still being made.' });
  redoFormat(job, formatId);
  res.status(202).json(publicJob(job));
});

app.post('/api/jobs/:id/video', async (req, res) => {
  const job = finishedJob(req, res);
  if (!job) return;
  const formatId = req.body?.format;
  if (job.formats[formatId]?.stage !== 'done') return res.status(409).json({ error: 'Make the banner for this size first.' });
  const current = job.videos[formatId]?.status;
  if (current && current !== 'error' && current !== 'done') return res.status(409).json({ error: 'This video is already being made.' });
  try {
    await makeVideo(job, formatId);
  } catch (err) {
    console.error(`[${job.id}] video start failed:`, err.message);
    job.videos[formatId] = { status: 'error', error: 'The video could not be started. Please try again.' };
    persist(job);
  }
  res.status(202).json(publicJob(job));
});

app.post('/api/jobs/:id/avatar', (req, res) => {
  const job = finishedJob(req, res);
  if (!job) return;
  if (job.avatar?.status === 'working') return res.status(409).json({ error: 'The presenter video is already being made.' });
  const b = req.body || {};
  const mode = b.mode === 'photo' ? 'photo' : 'ai';
  const gender = b.gender === 'male' ? 'male' : 'female';
  if (mode === 'photo') {
    if (typeof b.photo !== 'string' || !IMAGE.test(b.photo) || b.photo.length > 16_000_000) return res.status(400).json({ error: 'Send a JPEG or PNG photo of the presenter.' });
    if (b.consent !== true) return res.status(400).json({ error: 'Confirm that the person in the photo agreed to appear in this ad.' });
  }
  makeAvatar(job, { mode, gender, photo: b.photo });
  res.status(202).json(publicJob(job));
});

app.post('/api/jobs/:id/review', (req, res) => {
  const job = finishedJob(req, res);
  if (!job) return;
  res.json({ url: `${baseUrl(req)}/review/${reviewToken(job)}`, job: publicJob(job) });
});

app.post('/api/jobs/:id/slogans', async (req, res) => {
  const job = finishedJob(req, res);
  if (!job) return;
  try {
    const slogans = await writeSlogans({ request: job.request, product: `${job.brief.product.name}. ${job.brief.product.look}`, count: 10 });
    res.json({ slogans });
  } catch (err) {
    console.error('Slogans:', err.message);
    userError(res, err, 502);
  }
});

app.post('/api/jobs/:id/caption', async (req, res) => {
  const job = finishedJob(req, res);
  if (!job) return;
  try {
    res.json({ caption: await suggestCaption(job) });
  } catch (err) {
    console.error('Caption:', err.message);
    userError(res, err, 502);
  }
});

app.post('/api/jobs/:id/publish', async (req, res) => {
  const job = finishedJob(req, res);
  if (!job) return;
  const b = req.body || {};
  const targets = Array.isArray(b.targets) ? b.targets.filter((t) => TARGETS.includes(t)) : [];
  if (!targets.length) return res.status(400).json({ error: 'Choose where to publish.' });
  const kind = ['image', 'video', 'presenter'].includes(b.kind) ? b.kind : 'image';
  try {
    const results = await publish(job, { format: b.format, kind, targets, caption: text(b.caption, 2200) }, baseUrl(req));
    res.json({ results, job: publicJob(job) });
  } catch (err) {
    userError(res, err);
  }
});

// Slogans without an ad: for a client or a product description.

app.post('/api/slogans', async (req, res) => {
  if (!claudeConfigured()) return res.status(503).json({ error: 'The server’s Claude key is not set up yet.' });
  const b = req.body || {};
  const client = b.clientId ? getClient(b.clientId) : null;
  const product = text(b.product, 400);
  if (!product && !b.photo && !client) return res.status(400).json({ error: 'Describe the product or add a photo.' });
  if (b.photo && (typeof b.photo !== 'string' || !IMAGE.test(b.photo) || b.photo.length > 16_000_000)) return res.status(400).json({ error: 'Send a JPEG or PNG photo.' });
  try {
    const request = adRequest({ ...b, formats: ['post'] }, client);
    const photo = b.photo ? Buffer.from(b.photo.slice(b.photo.indexOf(',') + 1), 'base64') : null;
    res.json({ slogans: await writeSlogans({ photo, request, product, count: Math.min(Number(b.count) || 10, 20) }) });
  } catch (err) {
    console.error('Slogans:', err.message);
    userError(res, err, 502);
  }
});

// Bulk ads from an online shop

app.post('/api/shop/products', async (req, res) => {
  try {
    if (typeof req.body?.csv === 'string') return res.json({ source: 'CSV', products: parseCsv(req.body.csv) });
    if (!text(req.body?.url, 500)) return res.status(400).json({ error: 'Type the shop’s address.' });
    res.json(await readShop(text(req.body.url, 500)));
  } catch (err) {
    console.error('Shop:', err.message);
    userError(res, err);
  }
});

app.post('/api/batches', (req, res) => {
  if (requireAi(res)) return;
  const b = req.body || {};
  const products = (Array.isArray(b.products) ? b.products : [])
    .filter((p) => p && typeof p.image === 'string' && /^https?:\/\//.test(p.image) && text(p.title, 120))
    .slice(0, 200);
  if (!products.length) return res.status(400).json({ error: 'Choose at least one product.' });
  const client = b.clientId ? getClient(b.clientId) : null;
  const base = adRequest(b, client);
  const batch = startBatch({
    clientId: client?.id || null,
    title: text(b.title, 80) || `${client?.name || base.brand || 'Shop'} – ${products.length} products`,
    products,
    logo: clientLogo(client),
    makeRequest: (p) => ({
      ...base,
      details: [`Product: ${text(p.title, 120)}.`, p.price ? `Price: ${text(String(p.price), 40)}.` : '', text(p.description, 400), base.details].filter(Boolean).join(' '),
    }),
  });
  res.status(202).json(batch);
});

app.get('/api/batches', (req, res) => res.json(listBatches()));

app.get('/api/batches/:id', (req, res) => {
  const batch = getBatch(req.params.id);
  if (!batch) return res.status(404).json({ error: 'Not found.' });
  res.json({
    ...batch,
    jobs: batchJobs(batch.id).map((j) => ({
      id: j.id, status: j.status, stage: j.stage, headline: j.brief?.copy?.headline || null,
      details: j.request.details.slice(0, 80),
      thumb: Object.values(j.formats).find((f) => f.banner)?.banner || j.photo,
      error: j.error,
    })),
  });
});

// ---------- The web app, when built ----------

const WEB_DIR = path.resolve(process.env.WEB_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '../app/dist'));
const hasWeb = fs.existsSync(path.join(WEB_DIR, 'index.html'));
if (hasWeb) app.use(express.static(WEB_DIR, { index: 'index.html' }));

app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'The upload is too large.' });
  if (err?.status === 404) return res.status(404).json({ error: 'Not found' });
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

startHousekeeping();
resumeQueue();
resumeVideos(listJobs({ limit: 200 }));
const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Ad Studio server on port ${port}${hasWeb ? ' with the web app' : ''} (Claude: ${claudeConfigured() ? 'ready' : 'missing key'}, fal.ai: ${falConfigured() ? 'ready' : 'missing key'})`);
});
