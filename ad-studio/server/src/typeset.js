import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { FORMATS } from './formats.js';
import { STYLES } from './styles.js';
import { fontsForStyle, fontStack } from './fonts.js';

const HEX = /^#[0-9a-f]{6}$/i;

function h(type, style, ...children) {
  const kids = children.flat().filter((c) => c !== null && c !== undefined && c !== false && c !== '');
  return { type, props: { style, children: kids.length === 1 ? kids[0] : kids } };
}

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance([r, g, b]) {
  const f = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrastText(hex) {
  return luminance(rgb(hex)) > 0.45 ? '#111111' : '#ffffff';
}

function rgba(hex, a) {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

// How bright the scene is under the text, so the text can be dark on light
// backgrounds and white on dark ones.
export async function sceneTone(sceneBuffer, layout) {
  const meta = await sharp(sceneBuffer).metadata();
  const box = layout.text;
  const left = Math.round(box.x * meta.width);
  const top = Math.round(box.y * meta.height);
  const width = Math.max(1, Math.round(box.w * meta.width));
  const height = Math.max(1, Math.round(box.h * meta.height));
  const { channels } = await sharp(sceneBuffer).extract({ left, top, width, height }).removeAlpha().stats();
  const lum = luminance([channels[0].mean, channels[1].mean, channels[2].mean]);
  return lum > 0.4 ? 'light' : 'dark';
}

// Chooses the headline size: tries 1 to 3 lines and keeps the biggest size
// that fits both the width and the height of the text box.
function headlineSize(text, boxW, boxH, style, maxSize) {
  const factor = style.headline.width * (style.headline.uppercase ? 1.12 : 1);
  let best = 0;
  for (let lines = 1; lines <= 3; lines++) {
    const perLine = Math.ceil((text.length / lines) * (lines > 1 ? 1.15 : 1));
    const byWidth = boxW / (Math.max(perLine, 4) * factor);
    const byHeight = (boxH * 0.6) / (lines * 1.08);
    best = Math.max(best, Math.min(byWidth, byHeight, maxSize));
  }
  return Math.floor(best);
}

function scrimLayer(kind, W, H, tone) {
  if (kind === 'none') return null;
  const shade = tone === 'light' ? '255,255,255' : '0,0,0';
  const layers = [];
  if (kind === 'top-bottom' || kind === 'top') {
    layers.push(h('div', {
      position: 'absolute', left: 0, top: 0, width: W, height: Math.round(H * 0.42),
      backgroundImage: `linear-gradient(to bottom, rgba(${shade},0.62), rgba(${shade},0))`,
    }));
  }
  if (kind === 'top-bottom') {
    layers.push(h('div', {
      position: 'absolute', left: 0, top: Math.round(H * 0.8), width: W, height: Math.round(H * 0.2),
      backgroundImage: `linear-gradient(to top, rgba(${shade},0.5), rgba(${shade},0))`,
    }));
  }
  if (kind === 'left') {
    layers.push(h('div', {
      position: 'absolute', left: 0, top: 0, width: Math.round(W * 0.62), height: H,
      backgroundImage: `linear-gradient(to right, rgba(${shade},0.66), rgba(${shade},0))`,
    }));
  }
  return layers;
}

function ctaButton({ text, style, accent, textColor, size }) {
  const s = style.cta;
  const label = s.uppercase ? text.toUpperCase() : text;
  const bg = s.outline ? 'transparent' : accent;
  const color = s.outline ? textColor : contrastText(accent);
  return h('div', {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: `${Math.round(size * 0.62)}px ${Math.round(size * 1.5)}px`,
    backgroundColor: bg,
    border: s.outline ? `${Math.max(2, Math.round(size * 0.07))}px solid ${textColor}` : 'none',
    borderRadius: s.radius,
    color, fontFamily: fontStack(s.font), fontWeight: s.weight, fontSize: size,
    letterSpacing: `${s.tracking}em`, lineHeight: 1,
  }, label);
}

/**
 * Renders the text layer of a banner as a transparent PNG: shade, brand,
 * headline, subline, button and offer badge. The scene goes underneath it.
 */
export async function renderOverlay({ formatId, layoutId, width, height, styleId, copy, brand, palette, tone }) {
  const format = FORMATS[formatId];
  const layout = format.layouts[layoutId];
  const style = STYLES[styleId];
  const W = width ?? format.width;
  const H = height ?? format.height;
  const minSide = Math.min(W, H);
  const textColor = tone === 'light' ? '#111111' : '#ffffff';
  const accent = HEX.test(palette?.accent || '') ? palette.accent : '#e63946';
  const shadow = tone === 'light' ? 'none' : '0 2px 12px rgba(0,0,0,0.35)';

  const children = [];
  const scrim = scrimLayer(layout.scrim, W, H, tone);
  if (scrim) children.push(...scrim);

  // Brand: logo if given, otherwise the brand name in small capitals.
  const b = layout.brand;
  const brandBox = { position: 'absolute', left: Math.round(b.x * W), top: Math.round(b.y * H), width: Math.round(b.w * W), height: Math.round(b.h * H), display: 'flex', alignItems: 'center', justifyContent: b.align === 'center' ? 'center' : 'flex-start' };
  if (brand?.logo) {
    const maxH = Math.round(b.h * H);
    const maxW = Math.round(b.w * W * 0.6);
    const scale = Math.min(maxH / brand.logo.height, maxW / brand.logo.width);
    children.push(h('div', brandBox, {
      type: 'img',
      props: { src: brand.logo.dataUri, width: Math.round(brand.logo.width * scale), height: Math.round(brand.logo.height * scale) },
    }));
  } else if (brand?.name) {
    children.push(h('div', {
      ...brandBox, color: textColor, fontFamily: fontStack(style.body.font), fontWeight: 700,
      fontSize: Math.round(Math.min(b.h * H * 0.6, minSide * 0.032)), letterSpacing: '0.22em', textShadow: shadow,
    }, brand.name.toUpperCase()));
  }

  // Headline, subline and (in 'flow' layouts) the button.
  const t = layout.text;
  const boxW = Math.round(t.w * W);
  const boxH = Math.round(t.h * H);
  const headline = style.headline.uppercase ? copy.headline.toUpperCase() : copy.headline;
  const hSize = headlineSize(headline, boxW, boxH, style, minSide * (formatId === 'wide' ? 0.13 : 0.12));
  const subSize = Math.round(Math.min(Math.max(hSize * 0.34, minSide * 0.03), minSide * 0.046));
  const ctaSize = Math.round(minSide * (formatId === 'wide' ? 0.04 : 0.032));
  const alignItems = t.align === 'center' ? 'center' : 'flex-start';
  const textBlock = [
    h('div', {
      color: textColor, fontFamily: fontStack(style.headline.font), fontWeight: style.headline.weight,
      fontSize: hSize, lineHeight: 1.04, textAlign: t.align, textShadow: shadow,
      letterSpacing: style.headline.uppercase ? '0.01em' : '-0.01em',
    }, headline),
  ];
  if (copy.subline) {
    textBlock.push(h('div', {
      marginTop: Math.round(hSize * 0.32), color: textColor, fontFamily: fontStack(style.body.font),
      fontWeight: style.body.weight, fontSize: subSize, lineHeight: 1.3, textAlign: t.align,
      letterSpacing: `${style.subTracking}em`, textShadow: shadow, opacity: 0.92,
    }, style.subUppercase ? copy.subline.toUpperCase() : copy.subline));
  }
  if (layout.cta === 'flow' && copy.cta) {
    textBlock.push(h('div', { display: 'flex', marginTop: Math.round(hSize * 0.5) },
      ctaButton({ text: copy.cta, style, accent, textColor, size: ctaSize })));
  }
  children.push(h('div', {
    position: 'absolute', left: Math.round(t.x * W), top: Math.round(t.y * H), width: boxW, height: boxH,
    display: 'flex', flexDirection: 'column', alignItems,
    justifyContent: t.valign === 'center' ? 'center' : 'flex-start',
  }, textBlock));

  if (layout.cta !== 'flow' && copy.cta) {
    const c = layout.cta;
    children.push(h('div', {
      position: 'absolute', left: Math.round(c.x * W), top: Math.round(c.y * H), width: Math.round(c.w * W), height: Math.round(c.h * H),
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }, ctaButton({ text: copy.cta, style, accent, textColor, size: ctaSize })));
  }

  // Offer badge, slightly turned, in the accent colour.
  if (copy.badge) {
    const g = layout.badge;
    const d = Math.round(g.size * minSide);
    const len = copy.badge.length;
    const fs = Math.round(d * (len <= 4 ? 0.3 : len <= 8 ? 0.2 : 0.14));
    children.push(h('div', {
      position: 'absolute', left: Math.round(g.cx * W - d / 2), top: Math.round(g.cy * H - d / 2), width: d, height: d,
      borderRadius: d / 2, backgroundColor: accent, display: 'flex', alignItems: 'center', justifyContent: 'center',
      transform: 'rotate(-10deg)', boxShadow: '0 6px 24px rgba(0,0,0,0.25)',
    }, h('div', {
      color: contrastText(accent), fontFamily: fontStack(style.headline.font), fontWeight: style.headline.weight,
      fontSize: fs, lineHeight: 1.02, textAlign: 'center', padding: Math.round(d * 0.12),
    }, copy.badge)));
  }

  const tree = h('div', { position: 'relative', display: 'flex', width: W, height: H }, children);
  const svg = await satori(tree, { width: W, height: H, fonts: fontsForStyle(style) });
  return new Resvg(svg, { fitTo: { mode: 'original' } }).render().asPng();
}

// Puts the text layer on top of the scene and returns the finished banner.
export async function renderBanner({ scene, formatId, layoutId, styleId, copy, brand, palette, tone }) {
  const format = FORMATS[formatId];
  const overlay = await renderOverlay({ formatId, layoutId, styleId, copy, brand, palette, tone });
  return sharp(scene)
    .resize(format.width, format.height, { fit: 'cover' })
    .composite([{ input: overlay }])
    .png()
    .toBuffer();
}
