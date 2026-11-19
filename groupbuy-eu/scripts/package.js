// Builds dist/groupbuy-eu.zip from the last commit, ready to upload as a Hostinger Node.js app.
// Excludes node_modules, .env, the database and tests (see .gitattributes).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const status = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
if (status) console.warn('Note: you have uncommitted changes; the ZIP contains the last commit only.\n');
fs.mkdirSync('dist', { recursive: true });
const out = 'dist/groupbuy-eu.zip';
execFileSync('git', ['archive', '--format=zip', '--output', out, 'HEAD']);
const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
console.log(`Wrote ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB, commit ${commit}).`);
