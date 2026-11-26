import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Font family name -> @fontsource package name.
const PACKAGES = {
  'Playfair Display': 'playfair-display',
  Montserrat: 'montserrat',
  Oswald: 'oswald',
  Inter: 'inter',
  Manrope: 'manrope',
  Rubik: 'rubik',
  'Exo 2': 'exo-2',
  Lora: 'lora',
};

const SUBSETS = ['latin', 'latin-ext', 'cyrillic'];
const cache = new Map();

function filesDir(pkg) {
  return path.join(path.dirname(require.resolve(`@fontsource/${pkg}/package.json`)), 'files');
}

const SUFFIX = { latin: '', 'latin-ext': ' Ext', cyrillic: ' Cyr' };

// CSS font-family list for a family: the Latin file first, then the files
// with Estonian (Latin Extended) and Russian (Cyrillic) letters. Satori
// falls back along this list for letters a file doesn't have.
export function fontStack(family) {
  return SUBSETS.map((subset) => `'${family}${SUFFIX[subset]}'`).join(', ');
}

// Returns Satori font entries for one family and weight, one per character
// subset, each under its own name so fontStack() can list them.
function load(family, weight) {
  const key = `${family}:${weight}`;
  if (cache.has(key)) return cache.get(key);
  const pkg = PACKAGES[family];
  if (!pkg) throw new Error(`Unknown font: ${family}`);
  const dir = filesDir(pkg);
  const entries = SUBSETS.map((subset) => {
    const file = path.join(dir, `${pkg}-${subset}-${weight}-normal.woff`);
    if (!fs.existsSync(file)) throw new Error(`Missing font file: ${path.basename(file)}`);
    return { name: `${family}${SUFFIX[subset]}`, data: fs.readFileSync(file), weight, style: 'normal' };
  });
  cache.set(key, entries);
  return entries;
}

export function fontsForStyle(style) {
  const wanted = [
    [style.headline.font, style.headline.weight],
    [style.body.font, style.body.weight],
    [style.body.font, 700],
    [style.cta.font, style.cta.weight],
  ];
  const seen = new Set();
  const out = [];
  for (const [family, weight] of wanted) {
    const key = `${family}:${weight}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(...load(family, weight));
  }
  return out;
}
