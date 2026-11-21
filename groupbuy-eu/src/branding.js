import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { detectImageType, loadSharp } from './photos.js';
import { isPlaceholder } from './businessSettings.js';

// Admin → Settings → Branding & search: the shop's name and logo, the picture shown when a link
// to the shop is shared, the home page's search title and description, and the verification
// codes Google Search Console and Bing Webmaster Tools ask for. Stored as one admin setting;
// uploaded images go to UPLOAD_DIR under random names.

const KEY = 'branding';
export const DEFAULT_SHOP_NAME = 'Group Buy';
export const MAX_SHOP_NAME = 60;
export const MAX_HOME_TITLE = 120;
export const MAX_HOME_DESCRIPTION = 300;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const DEFAULT_ICONS = {
  favicon: '/static/icons/favicon-48.png',
  faviconSvg: '/static/icons/favicon.svg',
  appleTouch: '/static/icons/apple-touch-icon.png',
  icon192: '/static/icons/icon-192.png',
  icon512: '/static/icons/icon-512.png',
  maskable: '/static/icons/icon-maskable-512.png',
};
export const DEFAULT_SHARE_IMAGE = '/static/icons/share-default.jpg';

const FILE_RE = /^[a-f0-9]{24}-(logo|logo-\d+|share)\.(png|jpg|webp|gif)$/;

export function loadBranding(repo) {
  try {
    const data = JSON.parse(repo?.getAdminSetting?.(KEY)?.value || '{}');
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function saveBranding(repo, data, now) {
  repo.setAdminSetting(KEY, JSON.stringify(data), now);
}

// What every page needs: the name to show, the logo and icon addresses, the share picture and
// the verification codes. `config.business.name` is the legal company name; the shop name
// falls back to it, and then to "Group Buy".
export function brandFor(config, data) {
  const shopName = data.shopName || (isPlaceholder(config.business?.name) ? DEFAULT_SHOP_NAME : config.business.name);
  const up = (name) => (name && FILE_RE.test(name) ? `/uploads/${name}` : null);
  const logo = data.logo ?? null;
  return {
    name: shopName,
    logo: up(logo?.main),
    icons: logo
      ? {
          favicon: up(logo.sizes?.[48]) ?? up(logo.main),
          faviconSvg: null,
          appleTouch: up(logo.sizes?.[180]) ?? up(logo.main),
          icon192: up(logo.sizes?.[192]) ?? up(logo.main),
          icon512: up(logo.sizes?.[512]) ?? up(logo.main),
          maskable: null,
        }
      : DEFAULT_ICONS,
    shareImage: up(data.shareImage) ?? DEFAULT_SHARE_IMAGE,
    customShareImage: Boolean(up(data.shareImage)),
    homeTitle: data.homeTitle || '',
    homeDescription: data.homeDescription || '',
    googleVerification: data.googleVerification || '',
    bingVerification: data.bingVerification || '',
  };
}

// Reads the saved branding into config.brandData; pages call currentBrand(config), so a changed
// company name (Shop details) shows at once too.
export function applyBranding(config, repo) {
  config.brandData = loadBranding(repo);
  return currentBrand(config);
}
export const currentBrand = (config) => brandFor(config, config.brandData ?? {});

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max + 1);

// Search engines' verification: people paste either the code or the whole <meta> tag.
export function verificationCode(input) {
  const s = String(input ?? '').trim();
  const fromTag = s.match(/content\s*=\s*["']([^"']+)["']/i);
  const code = (fromTag ? fromTag[1] : s).trim();
  return /^[A-Za-z0-9_\-+/=.]{0,100}$/.test(code) ? code : null;
}

// The text fields of the form. Returns { errors, values }.
export function saveBrandingText(config, repo, body, now) {
  const data = loadBranding(repo);
  const values = {
    shopName: clean(body.shopName, MAX_SHOP_NAME),
    homeTitle: clean(body.homeTitle, MAX_HOME_TITLE),
    homeDescription: clean(body.homeDescription, MAX_HOME_DESCRIPTION),
    googleVerification: String(body.googleVerification ?? '').trim(),
    bingVerification: String(body.bingVerification ?? '').trim(),
  };
  const errors = {};
  if (values.shopName.length > MAX_SHOP_NAME) errors.shopName = `At most ${MAX_SHOP_NAME} characters.`;
  if (values.homeTitle.length > MAX_HOME_TITLE) errors.homeTitle = `At most ${MAX_HOME_TITLE} characters.`;
  if (values.homeDescription.length > MAX_HOME_DESCRIPTION) errors.homeDescription = `At most ${MAX_HOME_DESCRIPTION} characters.`;
  for (const k of ['googleVerification', 'bingVerification']) {
    const code = verificationCode(values[k]);
    if (code === null) errors[k] = 'Paste the code (letters, digits and - _) or the whole <meta> tag.';
    else values[k] = code;
  }
  if (Object.keys(errors).length) return { errors, values };
  saveBranding(repo, { ...data, ...values }, now);
  applyBranding(config, repo);
  return { errors, values };
}

const base = () => crypto.randomBytes(12).toString('hex');
const write = (dir, name, buf) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), buf, { flag: 'wx' });
  return name;
};

// Checks an uploaded image (type from its first bytes, size). Returns an error message or ''.
export function checkBrandImage(file) {
  if (!file?.buffer?.length) return 'Choose an image first.';
  if (file.size > MAX_IMAGE_BYTES || file.buffer.length > MAX_IMAGE_BYTES) return 'The image must be smaller than 8 MB.';
  if (!detectImageType(file.buffer)) return 'Use a PNG, JPG, WebP or GIF image.';
  return '';
}

// The logo: kept as uploaded (at most 512 px) and, with sharp, as square PNG icons for the
// browser tab (48 px), phones' home screens (180, 192 and 512 px).
export async function saveLogo(config, repo, buffer, now) {
  const dir = config.uploadDir;
  const sharp = await loadSharp();
  const id = base();
  const logo = { main: '', sizes: {} };
  if (sharp) {
    const main = await sharp(buffer, { animated: false, failOn: 'none' })
      .rotate()
      .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
    logo.main = write(dir, `${id}-logo.png`, main);
    for (const size of [48, 180, 192, 512]) {
      // Apple's home-screen icon can't be transparent: it gets a white background.
      let icon = sharp(buffer, { animated: false, failOn: 'none' })
        .rotate()
        .resize({ width: size, height: size, fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: size === 180 ? 1 : 0 } });
      if (size === 180) icon = icon.flatten({ background: '#ffffff' });
      icon = await icon.png().toBuffer();
      logo.sizes[size] = write(dir, `${id}-logo-${size}.png`, icon);
    }
  } else {
    logo.main = write(dir, `${id}-logo.${detectImageType(buffer)}`, buffer);
  }
  const data = loadBranding(repo);
  removeLogoFiles(dir, data.logo);
  saveBranding(repo, { ...data, logo }, now);
  applyBranding(config, repo);
}

// The picture for link previews (Facebook, WhatsApp, X …): 1200 × 630 is the usual size.
export async function saveShareImage(config, repo, buffer, now) {
  const dir = config.uploadDir;
  const sharp = await loadSharp();
  let name;
  if (sharp) {
    const out = await sharp(buffer, { animated: false, failOn: 'none' })
      .rotate()
      .resize({ width: 1200, height: 630, fit: 'cover', position: 'attention' })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 84, mozjpeg: true })
      .toBuffer();
    name = write(dir, `${base()}-share.jpg`, out);
  } else {
    name = write(dir, `${base()}-share.${detectImageType(buffer)}`, buffer);
  }
  const data = loadBranding(repo);
  removeFile(dir, data.shareImage);
  saveBranding(repo, { ...data, shareImage: name }, now);
  applyBranding(config, repo);
}

export function removeLogo(config, repo, now) {
  const data = loadBranding(repo);
  removeLogoFiles(config.uploadDir, data.logo);
  delete data.logo;
  saveBranding(repo, data, now);
  applyBranding(config, repo);
}

export function removeShareImage(config, repo, now) {
  const data = loadBranding(repo);
  removeFile(config.uploadDir, data.shareImage);
  delete data.shareImage;
  saveBranding(repo, data, now);
  applyBranding(config, repo);
}

function removeFile(dir, name) {
  if (name && FILE_RE.test(name)) fs.rmSync(path.join(dir, name), { force: true });
}
function removeLogoFiles(dir, logo) {
  if (!logo) return;
  removeFile(dir, logo.main);
  for (const name of Object.values(logo.sizes ?? {})) removeFile(dir, name);
}

// The web app manifest: lets phones add the shop to the home screen with its name and icon.
export function webManifest(brand, { lang = 'en', description = '' } = {}) {
  const icons = [
    { src: brand.icons.icon192, sizes: '192x192', type: 'image/png' },
    { src: brand.icons.icon512, sizes: '512x512', type: 'image/png' },
  ];
  if (brand.icons.maskable) icons.push({ src: brand.icons.maskable, sizes: '512x512', type: 'image/png', purpose: 'maskable' });
  return {
    name: brand.name,
    short_name: brand.name.length > 12 ? brand.name.split(/\s+/)[0].slice(0, 12) : brand.name,
    description,
    lang,
    start_url: '/?utm_source=homescreen',
    scope: '/',
    display: 'standalone',
    background_color: '#fbf7ff',
    theme_color: '#6d28d9',
    icons,
  };
}
