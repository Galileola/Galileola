import { fal } from '@fal-ai/client';

// fal.ai hosts every image and video model the app uses, under one key.
export const FAL_MODELS = {
  cutout: 'fal-ai/bria/background/remove',
  scene: 'openai/gpt-image-2/edit',
  sceneAlt: 'fal-ai/nano-banana-pro/edit',
  video: process.env.VIDEO_MODEL || 'fal-ai/kling-video/v3/pro/image-to-video',
};

fal.config({ credentials: () => process.env.FAL_KEY });

export function falConfigured() {
  return Boolean(process.env.FAL_KEY);
}

export function dataUri(buffer, mime) {
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

// Results come back as data URIs (sync_mode) or, for video, as file URLs.
async function download(url) {
  if (url.startsWith('data:')) return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

async function run(model, input) {
  try {
    const { data, requestId } = await fal.subscribe(model, { input });
    return { data, requestId };
  } catch (err) {
    const detail = err?.body?.detail;
    const msg = typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map((d) => d.msg).join('; ') : err.message;
    const e = new Error(`${model}: ${msg}`);
    e.status = err?.status;
    throw e;
  }
}

/**
 * Cuts the product out of an image. Returns a PNG with a transparent
 * background. `keep` names what to keep, e.g. "only the amber bottle", so
 * keys or cups next to the product are left out.
 */
export async function removeBackground(image, mime, keep) {
  const input = { image_url: dataUri(image, mime), sync_mode: true };
  if (keep) input.prompt = keep;
  const { data } = await run(FAL_MODELS.cutout, input);
  return download(data.image.url);
}

/**
 * Builds the scene around the product with GPT Image 2. The mask keeps the
 * product (black) and lets the model paint everything else (white).
 */
export async function generateScene({ canvas, mask, prompt, size }) {
  const { data } = await run(FAL_MODELS.scene, {
    prompt,
    image_urls: [dataUri(canvas, 'image/png')],
    mask_url: dataUri(mask, 'image/png'),
    image_size: size,
    quality: 'high',
    output_format: 'png',
    num_images: 1,
    sync_mode: true,
  });
  return download(data.images[0].url);
}

/** Second opinion from Nano Banana Pro, used when a GPT Image 2 scene fails the quality check. */
export async function generateSceneAlt({ canvas, prompt, ratio }) {
  const { data } = await run(FAL_MODELS.sceneAlt, {
    prompt,
    image_urls: [dataUri(canvas, 'image/png')],
    aspect_ratio: ratio,
    resolution: '2K',
    output_format: 'png',
    num_images: 1,
    sync_mode: true,
  });
  return download(data.images[0].url);
}

/** Starts a Kling video from the finished scene. Returns the fal request id. */
export async function startVideo({ image, prompt, duration = '5' }) {
  const { request_id } = await fal.queue.submit(FAL_MODELS.video, {
    input: {
      prompt,
      start_image_url: dataUri(image, 'image/jpeg'),
      duration,
      generate_audio: false,
      negative_prompt: 'text, letters, captions, watermark, logo changes, product deformation, morphing, melting, extra products, blur, low quality',
    },
  });
  return request_id;
}

/** Checks a video job. Returns { status } or { status: 'COMPLETED', video: Buffer }. */
export async function videoResult(requestId) {
  const status = await fal.queue.status(FAL_MODELS.video, { requestId });
  if (status.status !== 'COMPLETED') return { status: status.status };
  const { data } = await fal.queue.result(FAL_MODELS.video, { requestId });
  return { status: 'COMPLETED', video: await download(data.video.url) };
}
