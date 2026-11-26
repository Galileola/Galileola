// Ad sizes and their layouts. All layout boxes are fractions of the
// banner's width (x, w) and height (y, h), so one layout works at any size.
//
// product: where the product stands (fitted inside, centred, resting on the bottom)
// text:    headline + subline (+ button when cta is 'flow')
// cta:     the button box, or 'flow' to place it under the text
// brand:   brand name or logo
// badge:   offer sticker (centre and diameter as a fraction of the shorter side)
// scrim:   where a soft shade goes behind the text so it stays readable
// hint:    told to the image AI so it keeps that area calm for the text

export const FORMATS = {
  post: {
    label: 'Post 1:1',
    width: 1080,
    height: 1080,
    gen: { width: 1024, height: 1024 },
    altRatio: '1:1',
    layouts: {
      stack: {
        brand: { x: 0.06, y: 0.045, w: 0.88, h: 0.05, align: 'center' },
        text: { x: 0.08, y: 0.1, w: 0.84, h: 0.22, align: 'center', valign: 'top' },
        product: { x: 0.2, y: 0.34, w: 0.6, h: 0.52 },
        cta: { x: 0.2, y: 0.885, w: 0.6, h: 0.072, align: 'center' },
        badge: { cx: 0.83, cy: 0.4, size: 0.19 },
        scrim: 'top-bottom',
        hint: 'the top third of the image and a thin strip along the bottom edge',
      },
      split: {
        brand: { x: 0.06, y: 0.07, w: 0.44, h: 0.05, align: 'left' },
        text: { x: 0.06, y: 0.16, w: 0.46, h: 0.68, align: 'left', valign: 'center' },
        cta: 'flow',
        product: { x: 0.53, y: 0.08, w: 0.43, h: 0.86 },
        badge: { cx: 0.87, cy: 0.15, size: 0.18 },
        scrim: 'left',
        hint: 'the left half of the image',
      },
    },
  },
  story: {
    label: 'Story 9:16',
    width: 1080,
    height: 1920,
    gen: { width: 1024, height: 1824 },
    altRatio: '9:16',
    layouts: {
      stack: {
        brand: { x: 0.08, y: 0.1, w: 0.84, h: 0.03, align: 'center' },
        text: { x: 0.08, y: 0.145, w: 0.84, h: 0.21, align: 'center', valign: 'top' },
        product: { x: 0.13, y: 0.38, w: 0.74, h: 0.4 },
        cta: { x: 0.22, y: 0.8, w: 0.56, h: 0.048, align: 'center' },
        badge: { cx: 0.79, cy: 0.41, size: 0.21 },
        scrim: 'top-bottom',
        hint: 'the upper third and the bottom fifth of the image',
      },
    },
  },
  wide: {
    label: 'Banner 1.91:1',
    width: 1200,
    height: 628,
    gen: { width: 1536, height: 800 },
    altRatio: '16:9',
    layouts: {
      split: {
        brand: { x: 0.05, y: 0.09, w: 0.5, h: 0.07, align: 'left' },
        text: { x: 0.05, y: 0.21, w: 0.5, h: 0.62, align: 'left', valign: 'center' },
        cta: 'flow',
        product: { x: 0.57, y: 0.07, w: 0.39, h: 0.87 },
        badge: { cx: 0.91, cy: 0.2, size: 0.25 },
        scrim: 'left',
        hint: 'the left half of the image',
      },
    },
  },
};

export const FORMAT_IDS = Object.keys(FORMATS);

// Tall products (bottles, boxes standing up) look better beside the text in a
// square post; wide or round ones look better under it.
export function pickLayout(formatId, productAspect) {
  const layouts = FORMATS[formatId].layouts;
  if (formatId === 'post') return productAspect > 1.25 ? 'split' : 'stack';
  return Object.keys(layouts)[0];
}
