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
const NAME_RE = /^[a-f0-9]{24}\.(jpg|png|webp|gif)$/;

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

export function createPhotoStore(dir) {
  return {
    dir,
    // Writes one photo and returns its file name.
    save(buffer) {
      const ext = detectImageType(buffer);
      if (!ext) throw new PhotoError('Unsupported image type.');
      fs.mkdirSync(dir, { recursive: true });
      const name = `${crypto.randomBytes(12).toString('hex')}.${ext}`;
      fs.writeFileSync(path.join(dir, name), buffer, { flag: 'wx' });
      return name;
    },
    remove(name) {
      if (!NAME_RE.test(name)) return;
      fs.rmSync(path.join(dir, name), { force: true });
    },
  };
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
