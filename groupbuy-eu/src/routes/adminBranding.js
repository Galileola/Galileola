import multer from 'multer';
import {
  MAX_HOME_DESCRIPTION,
  MAX_HOME_TITLE,
  MAX_IMAGE_BYTES,
  MAX_SHOP_NAME,
  checkBrandImage,
  currentBrand,
  loadBranding,
  removeLogo,
  removeShareImage,
  saveBrandingText,
  saveLogo,
  saveShareImage,
} from '../branding.js';

// Admin → Settings → Branding & search (src/branding.js).

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 5, parts: 8 } });

// The image uploads are multipart; they're parsed before the admin's form-token check.
export function brandingParsers(router) {
  router.post(['/branding/logo', '/branding/share'], (req, res, next) =>
    upload.single('image')(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        req.uploadError = err.code === 'LIMIT_FILE_SIZE' ? 'The image must be smaller than 8 MB.' : 'The upload could not be read. Please try again.';
        return next();
      }
      next(err);
    })
  );
}

export function brandingRoutes(router, ctx) {
  const { config, repo, clock } = ctx;
  const page = (res, status, { values, errors = {}, flash = '' } = {}) =>
    res.status(status).render('admin/branding', {
      title: 'Branding & search',
      values: values ?? loadBranding(repo),
      errors,
      flash,
      shown: currentBrand(config),
      limits: { shopName: MAX_SHOP_NAME, homeTitle: MAX_HOME_TITLE, homeDescription: MAX_HOME_DESCRIPTION },
      sitemapUrl: `${config.baseUrl}/sitemap.xml`,
    });
  const back = (res, flash) => res.redirect(303, `/admin/branding?flash=${encodeURIComponent(flash)}`);

  router.get('/branding', (req, res) => page(res, 200, { flash: req.query.flash || '' }));

  router.post('/branding', (req, res) => {
    const { errors, values } = saveBrandingText(config, repo, req.body, clock.now().toISOString());
    if (Object.keys(errors).length) return page(res, 422, { values, errors });
    back(res, 'Saved.');
  });

  const imageRoute = (path, save, done) =>
    router.post(path, async (req, res) => {
      const error = req.uploadError || checkBrandImage(req.file);
      if (error) return back(res, error);
      try {
        await save(config, repo, req.file.buffer, clock.now().toISOString());
      } catch (err) {
        console.error(`[branding] ${path}:`, err.message);
        return back(res, 'That image could not be read. Try a PNG or JPG.');
      }
      back(res, done);
    });
  imageRoute('/branding/logo', saveLogo, 'Logo saved. It now shows in the header, the browser tab and on phones’ home screens.');
  imageRoute('/branding/share', saveShareImage, 'Share picture saved.');

  router.post('/branding/logo/delete', (req, res) => {
    removeLogo(config, repo, clock.now().toISOString());
    back(res, 'Logo removed.');
  });
  router.post('/branding/share/delete', (req, res) => {
    removeShareImage(config, repo, clock.now().toISOString());
    back(res, 'Share picture removed. The standard picture is used again.');
  });
}
