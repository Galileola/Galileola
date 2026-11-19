// Turns the Expo web export (dist/) into the GitHub Pages site (../docs/).
// The app's JavaScript is inlined into index.html, so the site works at any
// address, including https://<user>.github.io/<repo>/. The web/ folder adds
// the icon and manifest that let iPhone and Android install it to the home screen.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(app, 'dist');
const web = path.join(app, 'web');
const out = path.join(app, '..', 'docs');

let html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');

// Collect the bundled scripts and run them at the end of <body>, after #root exists.
const scripts = [];
html = html.replace(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g, (_, src) => {
  scripts.push(fs.readFileSync(path.join(dist, src.replace(/^\//, '')), 'utf8').replace(/<\/script/gi, '<\\/script'));
  return '';
});
if (!scripts.length) throw new Error('No bundled script found in dist/index.html. Run `npx expo export --platform web` first.');
// Function replacements insert the text literally ($& and $' in minified code stay intact).
html = html.replace('</body>', () => scripts.map((js) => `<script>${js}</script>`).join('\n') + '\n</body>');

// Phone-friendly head: notch-safe viewport, home-screen install, icons.
const head = [
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />',
  '<meta name="description" content="Confidence and communication coaching in English, Russian and Estonian." />',
  '<meta name="theme-color" content="#101B31" />',
  '<meta name="apple-mobile-web-app-capable" content="yes" />',
  '<meta name="mobile-web-app-capable" content="yes" />',
  '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />',
  '<meta name="apple-mobile-web-app-title" content="SPEAK POWER" />',
  '<link rel="manifest" href="manifest.webmanifest" />',
  '<link rel="apple-touch-icon" href="apple-touch-icon.png" />',
  '<link rel="icon" type="image/png" href="favicon.png" />',
  '<style>html,body{background:#101B31;overscroll-behavior:none}</style>',
].join('\n    ');
html = html.replace(/<meta name="viewport"[^>]*>/, '').replace('</head>', () => `    ${head}\n  </head>`);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'index.html'), html);
for (const f of fs.readdirSync(web)) fs.copyFileSync(path.join(web, f), path.join(out, f));
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log(`GitHub Pages site written to ${path.relative(process.cwd(), out) || out} (${Math.round(html.length / 1024)} KB index.html)`);
