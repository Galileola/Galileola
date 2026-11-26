import sharp from 'sharp';
import { FORMATS } from './formats.js';

// The box around the visible (non-transparent) pixels of a cut-out. Cut-outs
// can keep the old colours under transparent pixels, so only alpha counts.
async function alphaBox(png) {
  const { data, info } = await sharp(png).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (data[row + x] > 24) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1, imageWidth: width, imageHeight: height };
}

// Removes stray specks a cut-out sometimes keeps (a bit of a lamp, a
// reflection): finds the connected shapes on a small copy of the mask and
// keeps only the big ones (the product, or its parts if it has several).
export async function cleanCutout(png) {
  const { data: rgba, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;
  const scale = Math.min(1, 400 / Math.max(W, H));
  const w = Math.max(1, Math.round(W * scale));
  const h = Math.max(1, Math.round(H * scale));
  const { data: small } = await sharp(png).ensureAlpha().extractChannel(3).resize(w, h, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });

  const label = new Int32Array(w * h).fill(-1);
  const sizes = [];
  const stack = [];
  for (let start = 0; start < w * h; start++) {
    if (small[start] <= 64 || label[start] !== -1) continue;
    const id = sizes.length;
    let size = 0;
    label[start] = id;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop();
      size++;
      const x = p % w;
      const y = (p - x) / w;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
        if (q >= 0 && small[q] > 64 && label[q] === -1) {
          label[q] = id;
          stack.push(q);
        }
      }
    }
    sizes.push(size);
  }
  if (!sizes.length) return png;
  const largest = Math.max(...sizes);
  const keep = sizes.map((n) => n >= largest * 0.1);

  // Keep mask, grown by one pixel so the product's soft edge survives.
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let on = false;
      for (let dy = -1; dy <= 1 && !on; dy++) {
        for (let dx = -1; dx <= 1 && !on; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h) {
            const l = label[yy * w + xx];
            on = l >= 0 && keep[l];
          }
        }
      }
      mask[y * w + x] = on ? 255 : 0;
    }
  }
  const { data: full } = await sharp(Buffer.from(mask), { raw: { width: w, height: h, channels: 1 } })
    .resize(W, H, { fit: 'fill', kernel: 'linear' })
    .extractChannel(0)
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let i = 0; i < W * H; i++) rgba[i * 4 + 3] = Math.round((rgba[i * 4 + 3] * full[i]) / 255);
  return sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
}

/** Cleans and crops a cut-out product to its visible pixels. */
export async function trimCutout(cutoutPng) {
  const clean = await cleanCutout(cutoutPng);
  const box = await alphaBox(clean);
  if (!box) throw Object.assign(new Error('Cut-out is empty'), { userMessage: 'No product could be cut out of this photo. Try a clearer photo of the product.' });
  const buffer = await sharp(clean).extract({ left: box.left, top: box.top, width: box.width, height: box.height }).png().toBuffer();
  return { buffer, width: box.width, height: box.height, aspect: box.height / box.width };
}

// Where the product goes, as fractions of the banner: fitted inside the
// layout's product box, centred, standing on the bottom of the box.
export function placement(cutout, box, canvasW, canvasH) {
  const boxW = box.w * canvasW;
  const boxH = box.h * canvasH;
  const scale = Math.min(boxW / cutout.width, boxH / cutout.height) * 0.94;
  const w = cutout.width * scale;
  const h = cutout.height * scale;
  const x = box.x * canvasW + (boxW - w) / 2;
  const y = box.y * canvasH + boxH - h;
  return { x: x / canvasW, y: y / canvasH, w: w / canvasW, h: h / canvasH };
}

async function placeAt(cutout, place, W, H) {
  const width = Math.max(1, Math.round(place.w * W));
  const height = Math.max(1, Math.round(place.h * H));
  const input = await sharp(cutout.buffer).resize(width, height, { fit: 'fill' }).png().toBuffer();
  return { input, left: Math.round(place.x * W), top: Math.round(place.y * H) };
}

/**
 * Builds what the image AI receives: the product on a plain background at
 * the right spot, and a mask (white = paint here, black = keep the product).
 */
export async function buildCanvas({ formatId, layoutId, cutout }) {
  const format = FORMATS[formatId];
  const { width: W, height: H } = format.gen;
  const place = placement(cutout, format.layouts[layoutId].product, W, H);
  const layer = await placeAt(cutout, place, W, H);

  const canvas = await sharp({ create: { width: W, height: H, channels: 3, background: '#9a9a9a' } })
    .composite([layer])
    .png()
    .toBuffer();

  const productAlpha = await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([layer])
    .extractChannel(3)
    .png()
    .toBuffer();
  const mask = await sharp(productAlpha)
    .threshold(12)
    .negate()
    .toColourspace('b-w')
    .png()
    .toBuffer();

  return { canvas, mask, place, size: { width: W, height: H } };
}

/**
 * Finds where the image AI drew the product: the box around the cut-out of
 * the scene, as fractions of the scene. Returns null if nothing was found.
 */
export async function locate(sceneCutoutPng) {
  const b = await alphaBox(await cleanCutout(sceneCutoutPng));
  if (!b || b.width * b.height < b.imageWidth * b.imageHeight * 0.005) return null;
  return { x: b.left / b.imageWidth, y: b.top / b.imageHeight, w: b.width / b.imageWidth, h: b.height / b.imageHeight, aspect: b.height / b.width };
}

// Average colour of the visible pixels of a cut-out.
async function meanColour(png) {
  const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    n++;
  }
  return n ? [r / n, g / n, b / n] : null;
}

// Tints the real product towards the scene's light (colour and brightness),
// using how the image AI lit its own copy of the product.
async function matchLight(cutout, aiProduct) {
  const [real, lit] = await Promise.all([meanColour(cutout.buffer), meanColour(aiProduct)]);
  if (!real || !lit) return cutout;
  const gain = real.map((v, i) => Math.min(1.3, Math.max(0.75, (lit[i] + 1) / (v + 1))));
  const buffer = await sharp(cutout.buffer).linear([...gain, 1], [0, 0, 0, 0]).png().toBuffer();
  return { ...cutout, buffer };
}

/**
 * Sizes the scene to the banner. When `box` is given, the original product
 * pixels go back on top at that spot, so the label, logo and shape are
 * exactly the real product. `aiProduct` (the AI's own copy, cut out) is
 * used to match the light.
 */
export async function finishScene({ scene, formatId, cutout, box, aiProduct }) {
  const { width: W, height: H } = FORMATS[formatId];
  let img = sharp(scene).resize(W, H, { fit: 'cover' });
  if (box) {
    const product = aiProduct ? await matchLight(cutout, aiProduct) : cutout;
    const place = placement(product, box, W, H);
    // placement() shrinks to 94% for breathing room; here the box is the
    // product itself, so undo that and stand it on the box's bottom edge.
    const grow = 1 / 0.94;
    const w = place.w * grow;
    const h = place.h * grow;
    img = img.composite([await placeAt(product, { x: box.x + (box.w - w) / 2, y: box.y + box.h - h, w, h }, W, H)]);
  }
  return img.png().toBuffer();
}
