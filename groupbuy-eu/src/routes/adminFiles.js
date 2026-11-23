import crypto from 'node:crypto';
import fs from 'node:fs';
import multer from 'multer';
import { MAX_FILE_BYTES, MAX_FILES_PER_DEAL, FileTypeError, canDownload, formatSize, isDigital } from '../digital.js';
import { emailBuyer } from '../fulfilment.js';

// Admin → deal page → "Files for download" (digital products, src/digital.js): upload, remove and
// check the files buyers get, and email a buyer their download link again.

const sizeLabel = formatSize(MAX_FILE_BYTES, 'en');

// Files are written to FILES_DIR/.incoming while they arrive (they can be large), checked, then
// moved into FILES_DIR. Anything a request leaves behind there is removed when it ends.
export function fileParsers(router, ctx) {
  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        try {
          ctx.files.ensure();
          cb(null, ctx.files.incoming);
        } catch (err) {
          cb(err);
        }
      },
      filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex')),
    }),
    limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES_PER_DEAL, fields: 10, fieldSize: 4 * 1024, parts: 30 },
  });
  router.post('/deals/:id/files', (req, res, next) => {
    if (!ctx.files) {
      req.files = [];
      req.fileError = 'File storage is not set up (FILES_DIR).';
      return next();
    }
    res.on('close', () => {
      for (const f of req.files ?? []) fs.rm(f.path, { force: true }, () => {});
    });
    upload.array('files', MAX_FILES_PER_DEAL)(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        req.fileError =
          err.code === 'LIMIT_FILE_SIZE'
            ? `A file is larger than ${sizeLabel}. Make it smaller (for example a compressed PDF or a ZIP of several parts), or share very large files another way.`
            : err.code === 'LIMIT_FILE_COUNT'
              ? `Upload at most ${MAX_FILES_PER_DEAL} files at a time.`
              : `The upload didn't work (${err.code}). Please try again.`;
        req.files = [];
        return next();
      }
      next(err);
    });
  });
}

export function fileRoutes(router, ctx) {
  const { repo, clock } = ctx;
  const back = (res, dealId, flash, anchor = '#files') => res.redirect(303, `/admin/deals/${dealId}?flash=${encodeURIComponent(flash)}${anchor}`);

  router.post('/deals/:id/files', (req, res, next) => {
    const deal = repo.dealById(Number(req.params.id));
    if (!deal) return next();
    if (req.fileError) return back(res, deal.id, req.fileError);
    const uploads = req.files ?? [];
    if (!uploads.length) return back(res, deal.id, 'Choose one or more files first.');
    const room = MAX_FILES_PER_DEAL - repo.fileCount(deal.id);
    const added = [];
    const problems = [];
    for (const [i, f] of uploads.entries()) {
      if (i >= room) {
        problems.push(`"${f.originalname}" was not added: a download can have at most ${MAX_FILES_PER_DEAL} files.`);
        continue;
      }
      try {
        const stored = ctx.files.accept(f);
        repo.addFile(deal.id, stored, clock.now().toISOString());
        added.push(stored.original_name);
      } catch (err) {
        if (!(err instanceof FileTypeError)) throw err;
        problems.push(err.message);
      }
    }
    const done = added.length ? `Added ${added.map((n) => `"${n}"`).join(', ')}.` : '';
    back(res, deal.id, [done, ...problems].filter(Boolean).join(' ') || 'No files were added.');
  });

  router.post('/files/:id/delete', (req, res, next) => {
    const file = repo.fileById(Number(req.params.id));
    if (!file) return next();
    // Buyers who joined were promised these files: keep at least one (upload the new version
    // first, then remove the old one).
    if (repo.fileCount(file.deal_id) === 1 && repo.participantCount(file.deal_id) > 0) {
      return back(res, file.deal_id, 'Buyers have joined, so the download must keep at least one file. Upload the new version first, then remove this one.');
    }
    repo.deleteFile(file.id);
    ctx.files?.remove(file.filename);
    back(res, file.deal_id, `Removed "${file.original_name}".`);
  });

  // The owner's own check of a file, exactly as buyers get it.
  router.get('/files/:id', (req, res, next) => {
    const file = repo.fileById(Number(req.params.id));
    const path = file && ctx.files?.pathOf(file.filename);
    if (!path || !ctx.files.exists(file.filename)) return next();
    res.download(path, file.original_name, {
      headers: { 'Content-Type': file.content_type, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" },
    }, (err) => {
      if (err && !res.headersSent) next(err);
    });
  });

  // A buyer lost the email: send the "payment received" email with the download link again.
  router.post('/participants/:id/resend-download', async (req, res, next) => {
    try {
      const p = repo.participantById(Number(req.params.id));
      if (!p) return next();
      const deal = repo.dealById(p.deal_id);
      if (!isDigital(deal) || !canDownload(p, deal)) return back(res, deal.id, `Order #${p.id} has no download to send (it isn't paid).`, '#buyers');
      await emailBuyer(ctx, 'paid', deal, p);
      back(res, deal.id, `The download link was emailed to ${p.email} again.`, '#buyers');
    } catch (err) {
      next(err);
    }
  });
}
