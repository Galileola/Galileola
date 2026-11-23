import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { detectImageType } from './photos.js';
import { intlLocale } from './i18n/index.js';

// Digital products: a deal whose kind is 'digital' sells files (PDFs, e-books, audio, video, ZIP
// archives…) instead of goods to deliver. The group-buy rules are the same: buyers save a payment
// method, and are charged only if the deal reaches its minimum. Once a buyer's payment has gone
// through, they get a personal download link (/download/<their token>) by email and on their order
// page.
//
// Only buyers in Estonia can buy them (DIGITAL_COUNTRIES): the order form asks for an Estonian
// address, which is also the evidence of where the buyer lives for VAT.
//
// The files are stored in FILES_DIR (default: a "files" folder next to the database), which is
// never served as a folder: each download is checked against the buyer's order first.
//
// The 14-day right of withdrawal: for digital content that isn't on a physical medium, it ends
// once the download is made available, if the buyer asked for that before the withdrawal period
// ended and confirmed that they then lose the right (Directive 2011/83/EU, Article 16(m); in
// Estonia the Law of Obligations Act, § 53(4)). The order form asks for this, the "joined" and
// "paid" emails confirm it (Article 8(7)), and until the download is available the buyer can
// withdraw as usual.

export const KINDS = ['goods', 'digital'];
export const isDigital = (deal) => deal?.kind === 'digital';
// The countries digital products are sold to (ISO codes).
export const DIGITAL_COUNTRIES = ['EE'];
export const isDigitalCountry = (code) => DIGITAL_COUNTRIES.includes(String(code ?? '').toUpperCase());
// Estonian postcodes have five digits.
export const isEstonianPostcode = (value) => /^\d{5}$/.test(String(value ?? '').replace(/\s/g, ''));

// Stripe Tax product codes for downloads (the admin picks one; Stripe Tax works out the VAT rate,
// e.g. Estonia's reduced rate for books).
export const DEFAULT_DIGITAL_TAX_CODE = 'txcd_10000000';
export const DIGITAL_TAX_CODES = [
  ['txcd_10000000', 'General – electronically supplied services'],
  ['txcd_10302000', 'Digital books (e-books) – downloaded, permanent rights'],
  ['txcd_10503000', 'Other digital documents – downloadable, permanent rights'],
  ['txcd_10401100', 'Digital audio (music, audiobooks) – downloaded, permanent rights'],
  ['txcd_10402100', 'Digital video – downloaded, permanent rights'],
  ['txcd_10501000', 'Digital photos and images – downloaded, permanent rights'],
  ['txcd_10505001', 'Digital artwork – downloaded, permanent rights'],
];

// Orders whose files can be downloaded: paid (a SEPA debit still processing waits until it has
// gone through), not withdrawn or refunded, and not anonymised.
export const canDownload = (p, deal) => isDigital(deal) && p?.status === 'paid' && !p.erased_at && !p.refund_id;

// ---------------------------------------------------------------- files

export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_FILES_PER_DEAL = 10;
export const MAX_FILE_NAME = 120;
// What the file picker offers. The type is always checked from the file's first bytes.
export const FILE_ACCEPT = '.pdf,.epub,.zip,.docx,.xlsx,.pptx,.mp3,.m4a,.m4b,.wav,.mp4,.mov,.jpg,.jpeg,.png';
const NAME_RE = /^[a-f0-9]{32}\.(pdf|epub|zip|docx|xlsx|pptx|mp3|m4a|m4b|wav|mp4|mov|jpg|png)$/;

const ZIP_TYPES = {
  epub: 'application/epub+zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
};
const MEDIA_TYPES = {
  pdf: 'application/pdf',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  m4b: 'audio/mp4',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  jpg: 'image/jpeg',
  png: 'image/png',
  ...ZIP_TYPES,
};
// Short labels for buyers ("PDF · 2.4 MB").
const LABELS = { pdf: 'PDF', epub: 'EPUB', zip: 'ZIP', docx: 'Word', xlsx: 'Excel', pptx: 'PowerPoint', mp3: 'MP3', m4a: 'M4A', m4b: 'M4B', wav: 'WAV', mp4: 'MP4', mov: 'MOV', jpg: 'JPG', png: 'PNG' };
export const fileLabel = (ext) => LABELS[ext] ?? String(ext).toUpperCase();
export const contentTypeOf = (ext) => MEDIA_TYPES[ext] ?? 'application/octet-stream';

const extOf = (name) => (String(name ?? '').toLowerCase().match(/\.([a-z0-9]{1,5})$/) ?? [])[1] ?? '';

// The file type from its first bytes (and, for ZIP containers and MP4 audio, the name's ending),
// or null for anything else: web pages, SVG, programs and scripts are never accepted.
export function detectFileType(head, originalName = '') {
  if (!head || head.length < 8) return null;
  const ext = extOf(originalName);
  if (head.toString('latin1', 0, 5) === '%PDF-') return 'pdf';
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) {
    return ZIP_TYPES[ext] ? ext : 'zip';
  }
  if (head.length >= 12 && head.toString('latin1', 4, 8) === 'ftyp') {
    const brand = head.toString('latin1', 8, 12);
    if (brand === 'qt  ') return 'mov';
    if (['m4a', 'm4b'].includes(ext) || /^M4[AB] /.test(brand)) return ext === 'm4b' || brand === 'M4B ' ? 'm4b' : 'm4a';
    return 'mp4';
  }
  if (head.toString('latin1', 0, 3) === 'ID3' || (head[0] === 0xff && [0xfb, 0xf3, 0xf2].includes(head[1]))) return 'mp3';
  if (head.length >= 12 && head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WAVE') return 'wav';
  const image = detectImageType(head);
  if (image === 'jpg' || image === 'png') return image;
  return null;
}

// The name buyers see: the uploaded name without folders and odd characters, ending with the real
// file type ("Guide.pdf").
export function cleanFileName(name, ext) {
  let base = String(name ?? '')
    .split(/[\\/]/)
    .pop()
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  base = base.replace(/\.[a-z0-9]{1,5}$/i, '').trim() || 'download';
  const suffix = `.${ext === 'jpg' ? 'jpg' : ext}`;
  return `${base.slice(0, MAX_FILE_NAME - suffix.length)}${suffix}`;
}

// "2.4 MB" in the visitor's language.
export function formatSize(bytes, lang = 'en') {
  const n = Number(bytes) || 0;
  const [value, unit] = n >= 1024 ** 3 ? [n / 1024 ** 3, 'gigabyte'] : n >= 1024 ** 2 ? [n / 1024 ** 2, 'megabyte'] : [Math.max(n / 1024, 0.1), 'kilobyte'];
  try {
    return new Intl.NumberFormat(intlLocale(lang), { style: 'unit', unit, unitDisplay: 'short', maximumFractionDigits: 1 }).format(value);
  } catch {
    return `${value.toFixed(1)} ${unit === 'gigabyte' ? 'GB' : unit === 'megabyte' ? 'MB' : 'kB'}`;
  }
}

export class FileTypeError extends Error {}

const readHead = (file) => {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(16);
    const n = fs.readSync(fd, buf, 0, 16, 0);
    return buf.subarray(0, n);
  } finally {
    fs.closeSync(fd);
  }
};

// The private file store. Uploads are written to dir/.incoming first (multer), checked, then moved
// into dir under a random name.
export function createFileStore(dir) {
  const incoming = path.join(dir, '.incoming');
  const store = {
    dir,
    incoming,
    ensure() {
      fs.mkdirSync(incoming, { recursive: true });
    },
    // Checks an uploaded file (multer disk storage: { path, originalname, size }) and moves it into
    // the store. Returns { filename, original_name, content_type, size_bytes }. Throws FileTypeError
    // for a file type that isn't accepted (the upload is removed).
    accept(upload) {
      try {
        const ext = detectFileType(readHead(upload.path), upload.originalname);
        if (!ext) throw new FileTypeError(`"${upload.originalname}" isn't a supported file. Use PDF, EPUB, ZIP, Word, Excel, PowerPoint, MP3, M4A, WAV, MP4, MOV, JPG or PNG.`);
        if (!upload.size) throw new FileTypeError(`"${upload.originalname}" is empty.`);
        const filename = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
        fs.mkdirSync(dir, { recursive: true });
        fs.renameSync(upload.path, path.join(dir, filename));
        return { filename, original_name: cleanFileName(upload.originalname, ext), content_type: contentTypeOf(ext), size_bytes: upload.size, ext };
      } finally {
        fs.rmSync(upload.path, { force: true });
      }
    },
    // The full path of a stored file, or null for a name the store didn't make.
    pathOf(filename) {
      return NAME_RE.test(String(filename)) ? path.join(dir, filename) : null;
    },
    exists(filename) {
      const p = store.pathOf(filename);
      return Boolean(p && fs.existsSync(p));
    },
    remove(filename) {
      const p = store.pathOf(filename);
      if (p) fs.rmSync(p, { force: true });
    },
    // A copy under a new name (duplicating a deal).
    duplicate(filename) {
      const from = store.pathOf(filename);
      if (!from) throw new Error(`Unknown file ${filename}`);
      const copy = `${crypto.randomBytes(16).toString('hex')}.${extOf(filename)}`;
      fs.copyFileSync(from, path.join(dir, copy), fs.constants.COPYFILE_EXCL);
      return copy;
    },
    // Uploads that were never finished (a dropped connection) are removed after a day.
    cleanIncoming(now = Date.now()) {
      let names = [];
      try {
        names = fs.readdirSync(incoming);
      } catch {
        return 0;
      }
      let removed = 0;
      for (const name of names) {
        const p = path.join(incoming, name);
        try {
          if (now - fs.statSync(p).mtimeMs > 24 * 3600 * 1000) {
            fs.rmSync(p, { force: true });
            removed += 1;
          }
        } catch {
          /* already gone */
        }
      }
      return removed;
    },
  };
  return store;
}

// Copies the files of one deal to another (duplicating a deal).
export function copyFiles(ctx, fromDealId, toDealId) {
  if (!ctx.files) return 0;
  const now = ctx.clock.now().toISOString();
  let copied = 0;
  for (const f of ctx.repo.filesForDeal(fromDealId)) {
    try {
      const filename = ctx.files.duplicate(f.filename);
      ctx.repo.addFile(toDealId, { ...f, filename }, now);
      copied += 1;
    } catch (err) {
      console.warn(`[duplicate] file ${f.filename} not copied: ${err.message}`);
    }
  }
  return copied;
}

// Files as the public pages show them: name, type and size.
export const describeFiles = (files, lang) =>
  files.map((f) => ({ id: f.id, name: f.original_name, label: fileLabel(extOf(f.filename)), size: formatSize(f.size_bytes, lang) }));
