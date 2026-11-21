import express from 'express';
import multer from 'multer';
import { validateDealInput } from '../deals.js';
import { isCategory, DEFAULT_CATEGORY } from '../categories.js';
import { MAX_PHOTOS_PER_DEAL } from '../photos.js';
import { createImageImporter } from '../imageImport.js';
import { shorten } from '../seo.js';
import { randomToken } from '../util.js';
import {
  FORMAT_LABELS,
  ImportError,
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_PRODUCTS,
  decodeCsv,
  groupPrice,
  nameKey,
  readProductFile,
  templateCsv,
} from '../productImport.js';

// Admin → Import products: upload a CSV from another shop, check a preview, publish the ticked
// products as deals. Photos are copied from the other site in the background (src/imageImport.js).

const DAY = 24 * 3600 * 1000;
const PREVIEW_TTL_MS = 6 * 60 * 60 * 1000;
// Previews are kept in the database (admin_settings), so publishing still works if the host
// restarts the app between the preview and the click.
const PREVIEW_KEY = 'import-preview:';

const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMPORT_FILE_BYTES, files: 1, fields: 20, fieldSize: 1024, parts: 30 },
});

// Body parsers that must run before the admin's form-token check (which reads req.body).
export function importParsers(router) {
  router.post('/import', (req, res, next) =>
    csvUpload.single('file')(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        req.importError =
          err.code === 'LIMIT_FILE_SIZE'
            ? `The file is larger than ${MAX_IMPORT_FILE_BYTES / 1024 / 1024} MB. Split it into smaller files.`
            : 'The upload could not be read. Please try again.';
        return next();
      }
      next(err);
    })
  );
  // One set of fields per product (up to MAX_IMPORT_PRODUCTS rows).
  router.post('/import/confirm', express.urlencoded({ extended: false, limit: '2mb', parameterLimit: MAX_IMPORT_PRODUCTS * 6 + 20 }));
}

const DEFAULTS = { discount: 0, min_buyers: 10, days: 7, photos: 4, category: DEFAULT_CATEGORY };

function readOptions(body) {
  const num = (v, min, max, fallback, integer = true) => {
    const n = Number(String(v ?? '').replace(',', '.').replace('%', '').trim());
    if (String(v ?? '').trim() === '' || !Number.isFinite(n)) return fallback;
    const clamped = Math.min(max, Math.max(min, n));
    return integer ? Math.round(clamped) : Math.round(clamped * 10) / 10;
  };
  return {
    discount: num(body.discount, 0, 90, DEFAULTS.discount, false),
    min_buyers: num(body.min_buyers, 1, 10_000, DEFAULTS.min_buyers),
    days: num(body.days, 1, 30, DEFAULTS.days),
    photos: num(body.photos, 0, MAX_PHOTOS_PER_DEAL, DEFAULTS.photos),
    category: isCategory(String(body.category ?? '')) ? String(body.category) : DEFAULTS.category,
  };
}

// A deadline `days` from now, on the hour (never more than the 30-day maximum).
const deadlineIn = (now, days) => {
  const d = new Date(now.getTime() + days * DAY);
  d.setUTCMinutes(0, 0, 0);
  return d;
};

const euros = (cents) => (Number.isFinite(cents) ? (cents / 100).toFixed(2) : '');

export function importRoutes(router, ctx) {
  const { repo, clock, config } = ctx;
  if (!ctx.imageImporter && ctx.photos) ctx.imageImporter = createImageImporter({ photos: ctx.photos, repo, clock });
  const forgetOld = () =>
    repo.deleteAdminSettingsBefore(PREVIEW_KEY, new Date(clock.now().getTime() - PREVIEW_TTL_MS).toISOString());
  const savePreview = (token, preview) => repo.setAdminSetting(PREVIEW_KEY + token, JSON.stringify(preview), clock.now().toISOString());
  // Reads and removes a preview (each one can be published once).
  const takePreview = (token) => {
    if (!/^[\w-]{16,64}$/.test(token)) return null;
    const row = repo.getAdminSetting(PREVIEW_KEY + token);
    if (!row) return null;
    repo.deleteAdminSetting(PREVIEW_KEY + token);
    if (new Date(row.updated_at).getTime() < clock.now().getTime() - PREVIEW_TTL_MS) return null;
    try {
      return JSON.parse(row.value);
    } catch {
      return null;
    }
  };

  const uploadPage = (res, status, { error = '', values = DEFAULTS } = {}) =>
    res.status(status).render('admin/import', {
      title: 'Import products',
      error,
      values,
      maxMb: MAX_IMPORT_FILE_BYTES / 1024 / 1024,
      maxProducts: MAX_IMPORT_PRODUCTS,
      maxPhotos: MAX_PHOTOS_PER_DEAL,
      photoStats: ctx.imageImporter?.stats() ?? { photosQueued: 0, failures: [] },
    });

  router.get('/import', (req, res) => uploadPage(res, 200));

  router.get('/import/template.csv', (req, res) => {
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="product-import-template.csv"');
    res.send(templateCsv());
  });

  router.post('/import', (req, res) => {
    const options = readOptions(req.body);
    if (req.importError) return uploadPage(res, 422, { error: req.importError, values: options });
    if (!req.file?.buffer?.length) return uploadPage(res, 422, { error: 'Choose a CSV file first.', values: options });
    let file;
    try {
      file = readProductFile(decodeCsv(req.file.buffer));
    } catch (err) {
      if (err instanceof ImportError) return uploadPage(res, 422, { error: err.message, values: options });
      throw err;
    }
    forgetOld();
    const token = randomToken(18);
    savePreview(token, { products: file.products, options });

    const now = clock.now();
    const existing = new Set(repo.listPublicDeals().map((d) => nameKey(d.product_name)));
    const seen = new Set();
    const products = file.products.map((p, index) => {
      const price = groupPrice(p.priceCents, options.discount);
      const notes = [...p.notes];
      const key = nameKey(p.name);
      const duplicate = existing.has(key);
      if (duplicate) notes.push('A deal with this name is already in your shop.');
      const repeated = seen.has(key);
      if (repeated) notes.push('The same name appears earlier in the file.');
      seen.add(key);
      return {
        index,
        name: p.name,
        snippet: shorten(p.headline || p.description, 140),
        sourceId: p.sourceId,
        thumb: p.images.find((u) => u.startsWith('https://')) ?? '',
        imageCount: p.images.length,
        price: euros(price),
        filePrice: options.discount && Number.isFinite(p.priceCents) ? euros(p.priceCents) : '',
        minBuyers: p.minBuyers ?? options.min_buyers,
        category: p.category || options.category,
        categoryGuessed: Boolean(p.category),
        deadline: deadlineIn(now, p.days ?? options.days),
        notes,
        include: Number.isFinite(price) && price >= 50 && !p.hidden && !duplicate && !repeated,
      };
    });
    res.render('admin/import-preview', {
      title: 'Import preview',
      token,
      products,
      skipped: file.skipped,
      total: file.total,
      formatLabel: FORMAT_LABELS[file.format],
      options,
      defaultDeadline: deadlineIn(now, options.days),
    });
  });

  router.post('/import/confirm', (req, res) => {
    const preview = takePreview(String(req.body.token ?? ''));
    if (!preview) {
      return uploadPage(res, 410, { error: 'This preview has expired or was already published. Upload the file again.' });
    }
    const { products, options } = preview;
    const now = clock.now();
    const created = [];
    const failed = [];
    let photosQueued = 0;
    products.forEach((p, i) => {
      if (req.body[`include_${i}`] !== '1') return;
      const input = {
        product_name: req.body[`name_${i}`] ?? p.name,
        description: p.description,
        headline: p.headline,
        category: req.body[`cat_${i}`] ?? p.category,
        price: req.body[`price_${i}`] ?? '',
        min_buyers: req.body[`min_${i}`] ?? '',
        tax_code: p.taxCode || config.defaultTaxCode,
        deadline_iso: deadlineIn(now, p.days ?? options.days).toISOString(),
        // Shown until the photos have been copied (or if copying fails).
        image_url: p.images.find((u) => u.startsWith('https://')) ?? '',
      };
      const { errors, deal } = validateDealInput(input, { now, defaultTaxCode: config.defaultTaxCode });
      if (!deal) {
        failed.push({ name: String(input.product_name).trim(), reason: Object.values(errors).join(' ') });
        return;
      }
      const row = repo.insertDeal(deal);
      created.push(row);
      if (options.photos > 0 && p.images.length && ctx.imageImporter) {
        const n = Math.min(options.photos, p.images.length);
        ctx.imageImporter.enqueue(row.id, p.images, options.photos);
        photosQueued += n;
      }
    });
    // Translations into the other languages are made when a visitor first opens a deal in their
    // language (src/translate.js), so a large import doesn't use up the day's translation budget.
    res.render('admin/import-done', { title: 'Import finished', created, failed, photosQueued });
  });
}
