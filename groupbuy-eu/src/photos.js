import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Product photos uploaded in the admin.
//
// Files are stored in UPLOAD_DIR under random names and served at /uploads/<name>. Keep that
// folder outside the app folder: Hostinger replaces the app folder on every redeploy.
// The type is detected from the file's first bytes, never from the browser-supplied name or
// MIME type, and only raster formats are accepted (no SVG, which can carry scripts).

export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
export const MAX_PHOTOS_PER_DEAL = 8;
export const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';
const NAME_RE = /^[a-f0-9]{24}(-sm)?\.(jpg|png|webp|gif)$/;
// Shop pages use a main photo of at most MAIN_SIZE px (JPEG, which every link preview and email
// client shows) and a thumbnail of THUMB_SIZE px (WebP) for deal cards and the gallery strip.
export const MAIN_SIZE = 1600;
export const THUMB_SIZE = 480;

// sharp (an optional dependency) resizes photos. Without it the originals are used as they are.
let sharpPromise;
export function loadSharp() {
  sharpPromise ??= import('sharp').then((m) => m.default ?? m).catch(() => null);
  return sharpPromise;
}

export class PhotoError extends Error {}

export function detectImageType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (/^GIF8[79]a$/.test(buf.toString('latin1', 0, 6))) return 'gif';
  return null;
}

// Checks uploaded files (multer memory storage) before anything is written.
// Returns an error message, or '' when every file is a supported image.
export function checkPhotos(files) {
  for (const f of files ?? []) {
    if (!detectImageType(f.buffer)) {
      return `"${f.originalname}" isn't a supported photo. Use JPG, PNG, WebP or GIF.`;
    }
  }
  return '';
}

const newBase = () => crypto.randomBytes(12).toString('hex');

export function createPhotoStore(dir, { sharp: sharpOverride } = {}) {
  const write = (name, buffer) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), buffer, { flag: 'wx' });
    return name;
  };
  const store = {
    dir,
    // Writes one photo exactly as it is and returns its file name.
    save(buffer) {
      const ext = detectImageType(buffer);
      if (!ext) throw new PhotoError('Unsupported image type.');
      return write(`${newBase()}.${ext}`, buffer);
    },

    // Writes a shop-ready copy of a photo: turned the right way up, without its metadata (camera
    // details, GPS location), at most MAIN_SIZE px as a JPEG, plus a THUMB_SIZE px WebP thumbnail.
    // Animated GIFs keep their animation (the thumbnail shows the first frame). Returns
    // { filename, thumb, width, height }; without sharp, or if the photo can't be read by it,
    // the original is saved and thumb is ''.
    async store(buffer) {
      const ext = detectImageType(buffer);
      if (!ext) throw new PhotoError('Unsupported image type.');
      const sharp = sharpOverride === undefined ? await loadSharp() : sharpOverride;
      if (!sharp) return { filename: store.save(buffer), thumb: '', width: null, height: null };
      const base = newBase();
      try {
        const thumb = await sharp(buffer, { animated: false, failOn: 'none' })
          .rotate()
          .resize({ width: THUMB_SIZE, height: THUMB_SIZE, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 76 })
          .toBuffer();
        let filename;
        let info;
        if (ext === 'gif') {
          info = await sharp(buffer, { animated: false, failOn: 'none' }).metadata();
          filename = write(`${base}.gif`, buffer);
        } else {
          const out = await sharp(buffer, { failOn: 'none' })
            .rotate()
            .resize({ width: MAIN_SIZE, height: MAIN_SIZE, fit: 'inside', withoutEnlargement: true })
            .flatten({ background: '#ffffff' })
            .jpeg({ quality: 82, progressive: true, mozjpeg: true })
            .toBuffer({ resolveWithObject: true });
          info = out.info;
          filename = write(`${base}.jpg`, out.data);
        }
        const thumbName = write(`${base}-sm.webp`, thumb);
        return { filename, thumb: thumbName, width: info.width ?? null, height: info.height ?? null };
      } catch (err) {
        console.warn(`[photos] could not resize a photo, keeping the original: ${err.message}`);
        return { filename: store.save(buffer), thumb: '', width: null, height: null };
      }
    },

    // A copy of a stored photo under new names (duplicating a deal).
    duplicate({ filename, thumb }) {
      if (!NAME_RE.test(filename)) throw new PhotoError('Unknown photo.');
      const base = newBase();
      const copy = (name, suffix) => {
        const target = `${base}${suffix}${path.extname(name)}`;
        fs.mkdirSync(dir, { recursive: true });
        fs.copyFileSync(path.join(dir, name), path.join(dir, target), fs.constants.COPYFILE_EXCL);
        return target;
      };
      return { filename: copy(filename, ''), thumb: thumb && NAME_RE.test(thumb) && fs.existsSync(path.join(dir, thumb)) ? copy(thumb, '-sm') : '' };
    },

    // Removes a photo's files (its main file and, if given, its thumbnail).
    remove(name, thumb = '') {
      for (const n of [name, thumb]) if (n && NAME_RE.test(n)) fs.rmSync(path.join(dir, n), { force: true });
    },
  };
  return store;
}

// The thumbnail address of a photo row (the main photo when it has no thumbnail yet).
export const thumbUrl = (photo) => `/uploads/${photo.thumb || photo.filename}`;

// Makes shop-ready copies of photos uploaded before resizing existed (runs once in the background
// at startup). The original files stay, so links already shared keep working.
export async function optimizeStoredPhotos({ repo, photos, log = console }) {
  if (!(await loadSharp())) return 0;
  let done = 0;
  for (const ph of repo.photosWithoutThumbs()) {
    try {
      const buffer = fs.readFileSync(path.join(photos.dir, ph.filename));
      const out = await photos.store(buffer);
      if (!out.thumb) {
        photos.remove(out.filename);
        continue;
      }
      repo.updatePhoto(ph.id, out);
      done += 1;
    } catch (err) {
      log.warn?.(`[photos] ${ph.filename} not optimised: ${err.message}`);
    }
  }
  if (done) log.log?.(`[photos] made shop-ready copies of ${done} older photo(s)`);
  return done;
}

export const photoUrl = (name) => `/uploads/${name}`;

// Friendly messages for multer's limit errors.
export function uploadErrorMessage(err) {
  switch (err.code) {
    case 'LIMIT_FILE_SIZE':
      return `Each photo must be smaller than ${MAX_PHOTO_BYTES / 1024 / 1024} MB.`;
    case 'LIMIT_FILE_COUNT':
    case 'LIMIT_UNEXPECTED_FILE':
      return `Upload at most ${MAX_PHOTOS_PER_DEAL} photos at a time.`;
    default:
      return 'The upload could not be read. Please try again.';
  }
}
