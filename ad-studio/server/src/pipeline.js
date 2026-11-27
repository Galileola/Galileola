import sharp from 'sharp';
import { FORMATS, pickLayout } from './formats.js';
import { writeBrief, reviewScene } from './director.js';
import { removeBackground, generateScene, generateSceneAlt } from './fal.js';
import { trimCutout, buildCanvas, locate, finishScene } from './compose.js';
import { renderBanner, sceneTone } from './typeset.js';
import { jobFiles, saveFile, persist, unfinishedJobs } from './jobs.js';

const HEX = /^#[0-9a-f]{6}$/i;

function scenePrompt(brief, hint, fix) {
  return [
    'Professional high-end advertising product photograph.',
    `The image contains exactly one product: ${brief.product.name} (${brief.product.look}).`,
    'Keep that product exactly as it is: same shape, label, text, colours and proportions. Do not add copies of it or any other products.',
    `Replace everything around it with: ${brief.scene.setting}.`,
    `Lighting: ${brief.scene.lighting}.`,
    'The product must look physically present: matching perspective, a soft realistic contact shadow and subtle reflections where the surface allows.',
    `Leave ${hint} calm and uncluttered for a headline; keep the product out of that area.`,
    'No text, letters, numbers, logos or watermarks anywhere except the product’s own label.',
    'Photorealistic, sharp focus on the product, premium commercial look.',
    fix ? `Also fix these problems from the previous attempt: ${fix}` : '',
  ].filter(Boolean).join(' ');
}

// A located product is trusted for paste-back only if its proportions
// match the real product; otherwise the AI changed it and we keep its version.
function sameShape(a, b) {
  return Math.abs(a / b - 1) < 0.09;
}

async function attempt({ job, formatId, layoutId, cutout, photo, mime, fix, alt }) {
  const { brief } = job;
  const format = FORMATS[formatId];
  const layout = format.layouts[layoutId];
  const { canvas, mask, size } = await buildCanvas({ formatId, layoutId, cutout });
  const prompt = scenePrompt(brief, layout.hint, fix);
  const raw = alt
    ? await generateSceneAlt({ canvas, prompt, ratio: format.altRatio })
    : await generateScene({ canvas, mask, prompt, size });

  const aiProduct = await removeBackground(raw, 'image/png', brief.product.cutout).catch((err) => {
    console.error(`[${job.id}] ${formatId}: could not find the product in the scene:`, err.message);
    return null;
  });
  const found = aiProduct ? await locate(aiProduct) : null;
  const box = found && sameShape(found.aspect, cutout.aspect) ? found : null;
  console.log(`[${job.id}] ${formatId}${alt ? ' (retry)' : ''}: real product ${box ? 'placed' : 'not placed'}; shape ${found ? found.aspect.toFixed(2) : '-'} vs ${cutout.aspect.toFixed(2)}`);
  const scene = await finishScene({ scene: raw, formatId, cutout, box, aiProduct });

  job.formats[formatId].stage = 'checking';
  const review = await reviewScene({ photo, mime, scene, brief, textArea: layout.hint });
  return { scene, review, model: alt ? 'nano-banana-pro' : 'gpt-image-2', exactProduct: Boolean(box) };
}

async function makeFormat(job, formatId, cutout) {
  const files = await jobFiles(job);
  const { photo, mime } = files;
  const state = job.formats[formatId];
  const layoutId = pickLayout(formatId, cutout.aspect);
  state.layout = layoutId;

  state.stage = 'painting';
  let best = await attempt({ job, formatId, layoutId, cutout, photo, mime });
  if (!best.review.pass) {
    state.stage = 'retrying';
    const second = await attempt({ job, formatId, layoutId, cutout, photo, mime, fix: [best.review.fix, ...best.review.issues].filter(Boolean).join('; '), alt: true })
      .catch((err) => { console.error(`[${job.id}] ${formatId} second attempt failed:`, err.message); return null; });
    if (second && (second.review.pass || second.review.score > best.review.score)) best = second;
  }

  state.stage = 'typesetting';
  files.scenes[formatId] = best.scene;
  const tone = await sceneTone(best.scene, FORMATS[formatId].layouts[layoutId]);
  job.tones[formatId] = tone;
  const banner = await renderBanner({ scene: best.scene, formatId, layoutId, styleId: job.brief.style, copy: job.brief.copy, brand: files.brand, palette: job.brief.palette, tone });

  state.scene = saveFile(job.id, `scene-${formatId}.jpg`, await sharp(best.scene).jpeg({ quality: 94 }).toBuffer());
  state.banner = saveFile(job.id, `banner-${formatId}-v${job.version}.jpg`, await toJpeg(banner));
  state.model = best.model;
  state.exactProduct = best.exactProduct;
  state.review = { score: best.review.score, issues: best.review.issues, approved: best.review.pass };
  state.stage = 'done';
}

// Banners are delivered as high-quality JPEG: what ad platforms and
// Instagram expect, and a quarter of the size of PNG.
function toJpeg(png) {
  return sharp(png).jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toBuffer();
}

/** Runs a whole job: brief, cut-out, then every format in parallel. */
export async function runJob(job) {
  const { request } = job;
  job.status = 'running';
  job.error = null;
  try {
    const files = await jobFiles(job);
    files.scenes = {};

    job.stage = 'brief';
    persist(job);
    const brief = await writeBrief({ photo: files.photo, mime: files.mime, request });
    if (!brief.usable) {
      job.status = 'error';
      job.error = brief.problem || 'No clear product was found in this photo.';
      return;
    }
    // The client's brand colours win over the art director's choice.
    if (HEX.test(request.primary || '')) brief.palette.primary = request.primary;
    if (HEX.test(request.accent || '')) brief.palette.accent = request.accent;
    if (!HEX.test(brief.palette.primary)) brief.palette.primary = '#222222';
    if (!HEX.test(brief.palette.accent)) brief.palette.accent = '#e63946';
    job.brief = brief;

    job.stage = 'cutout';
    persist(job);
    files.cutout = await trimCutout(await removeBackground(files.photo, files.mime, brief.product.cutout));
    saveFile(job.id, 'cutout.png', files.cutout.buffer);

    job.stage = 'scenes';
    persist(job);
    const results = await Promise.allSettled(request.formats.map((f) => makeFormat(job, f, files.cutout)));
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        const f = request.formats[i];
        console.error(`[${job.id}] ${f} failed:`, r.reason?.message);
        job.formats[f].stage = 'error';
        job.formats[f].error = 'This size could not be made. Try again.';
      }
    });
    const ok = results.some((r) => r.status === 'fulfilled');
    job.stage = 'done';
    job.status = ok ? 'done' : 'error';
    if (!ok) job.error = 'The images could not be made. Please try again.';
  } catch (err) {
    console.error(`[${job.id}] job failed:`, err);
    job.status = 'error';
    job.error = err.userMessage || 'Something went wrong while making the ad. Please try again.';
  } finally {
    persist(job);
  }
}

// Jobs wait in this queue so that bulk orders don't overload the AI
// services or the server. MAX_RUNNING_JOBS run at the same time.
const MAX_RUNNING = Number(process.env.MAX_RUNNING_JOBS) || 3;
const queue = [];
let running = 0;

function pump() {
  while (running < MAX_RUNNING && queue.length) {
    const job = queue.shift();
    running++;
    runJob(job).finally(() => {
      running--;
      pump();
    });
  }
}

export function enqueue(job) {
  job.status = 'queued';
  job.stage = 'queued';
  persist(job);
  queue.push(job);
  pump();
}

export function queueLength() {
  return queue.length + running;
}

/** After a restart, jobs that were waiting or running start again. */
export function resumeQueue() {
  for (const job of unfinishedJobs()) {
    for (const state of Object.values(job.formats)) if (state.stage !== 'done') state.stage = 'waiting';
    enqueue(job);
  }
}

/** Makes one size again (new scene, new check), e.g. when the client doesn't like it. */
export async function redoFormat(job, formatId) {
  const files = await jobFiles(job);
  job.formats[formatId] = { stage: 'waiting' };
  delete job.videos[formatId];
  delete files.scenes[formatId];
  try {
    await makeFormat(job, formatId, files.cutout);
  } catch (err) {
    console.error(`[${job.id}] redo ${formatId} failed:`, err.message);
    job.formats[formatId].stage = 'error';
    job.formats[formatId].error = 'This size could not be made. Try again.';
  } finally {
    persist(job);
  }
}

/** Re-typesets every finished banner with new text or style; no AI cost. */
export async function retypeset(job, { copy, style, palette }) {
  const files = await jobFiles(job);
  job.brief.copy = { ...job.brief.copy, ...copy };
  if (style) job.brief.style = style;
  if (palette) job.brief.palette = { ...job.brief.palette, ...palette };
  job.version += 1;
  for (const [formatId, state] of Object.entries(job.formats)) {
    const scene = files.scenes?.[formatId];
    if (!scene) continue;
    const banner = await renderBanner({ scene, formatId, layoutId: state.layout, styleId: job.brief.style, copy: job.brief.copy, brand: files.brand, palette: job.brief.palette, tone: job.tones[formatId] });
    state.banner = saveFile(job.id, `banner-${formatId}-v${job.version}.jpg`, await toJpeg(banner));
  }
  persist(job);
}
