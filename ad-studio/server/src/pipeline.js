import sharp from 'sharp';
import { FORMATS, pickLayout } from './formats.js';
import { writeBrief, reviewScene } from './director.js';
import { removeBackground, generateScene, generateSceneAlt } from './fal.js';
import { trimCutout, buildCanvas, locate, finishScene } from './compose.js';
import { renderBanner, sceneTone } from './typeset.js';
import { jobFiles, saveFile } from './jobs.js';

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
  const files = jobFiles(job.id);
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
  files.tones[formatId] = tone;
  const banner = await renderBanner({ scene: best.scene, formatId, layoutId, styleId: job.brief.style, copy: job.brief.copy, brand: files.brand, palette: job.brief.palette, tone });

  state.scene = saveFile(job.id, `scene-${formatId}.png`, best.scene);
  state.banner = saveFile(job.id, `banner-${formatId}-v${job.version}.png`, banner);
  state.model = best.model;
  state.exactProduct = best.exactProduct;
  state.review = { score: best.review.score, issues: best.review.issues, approved: best.review.pass };
  state.stage = 'done';
}

async function prepareLogo(logoDataUri) {
  if (!logoDataUri) return null;
  const buffer = Buffer.from(logoDataUri.slice(logoDataUri.indexOf(',') + 1), 'base64');
  const png = await sharp(buffer).trim({ threshold: 10 }).resize({ width: 800, height: 400, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  const { width, height } = await sharp(png).metadata();
  return { dataUri: `data:image/png;base64,${png.toString('base64')}`, width, height };
}

/** Runs a whole job: brief, cut-out, then every format in parallel. */
export async function runJob(job) {
  const files = jobFiles(job.id);
  const { request } = job;
  try {
    files.mime = request.photo.slice(5, request.photo.indexOf(';'));
    files.photo = Buffer.from(request.photo.slice(request.photo.indexOf(',') + 1), 'base64');
    files.scenes = {};
    files.tones = {};
    const logo = await prepareLogo(request.logo);
    files.brand = { name: request.brand, logo };
    delete request.photo;
    delete request.logo;
    saveFile(job.id, 'photo.jpg', await sharp(files.photo).jpeg({ quality: 90 }).toBuffer());

    job.stage = 'brief';
    const brief = await writeBrief({ photo: files.photo, mime: files.mime, request });
    if (!brief.usable) {
      job.status = 'error';
      job.error = brief.problem || 'No clear product was found in this photo.';
      return;
    }
    if (!HEX.test(brief.palette.primary)) brief.palette.primary = '#222222';
    if (!HEX.test(brief.palette.accent)) brief.palette.accent = '#e63946';
    job.brief = brief;

    job.stage = 'cutout';
    files.cutout = await trimCutout(await removeBackground(files.photo, files.mime, brief.product.cutout));
    saveFile(job.id, 'cutout.png', files.cutout.buffer);

    job.stage = 'scenes';
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
  }
}

/** Makes one size again (new scene, new check), e.g. when the client doesn't like it. */
export async function redoFormat(job, formatId) {
  const files = jobFiles(job.id);
  job.formats[formatId] = { stage: 'waiting' };
  delete job.videos[formatId];
  try {
    await makeFormat(job, formatId, files.cutout);
  } catch (err) {
    console.error(`[${job.id}] redo ${formatId} failed:`, err.message);
    job.formats[formatId].stage = 'error';
    job.formats[formatId].error = 'This size could not be made. Try again.';
  }
}

/** Re-typesets every finished banner with new text or style; no AI cost. */
export async function retypeset(job, { copy, style, palette }) {
  const files = jobFiles(job.id);
  job.brief.copy = { ...job.brief.copy, ...copy };
  if (style) job.brief.style = style;
  if (palette) job.brief.palette = { ...job.brief.palette, ...palette };
  job.version += 1;
  for (const [formatId, state] of Object.entries(job.formats)) {
    const scene = files.scenes?.[formatId];
    if (!scene) continue;
    const banner = await renderBanner({ scene, formatId, layoutId: state.layout, styleId: job.brief.style, copy: job.brief.copy, brand: files.brand, palette: job.brief.palette, tone: files.tones[formatId] });
    state.banner = saveFile(job.id, `banner-${formatId}-v${job.version}.png`, banner);
  }
}
