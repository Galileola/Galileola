import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSettingsFile, saveSettingsFile, settingsFilePath } from '../src/settingsFile.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gb-settings-'));

test('the running shop saves its settings once; another copy starts from them', () => {
  const dir = tmp();
  const file = path.join(dir, 'sub', 'settings.env');
  const shop = {
    BASE_URL: 'https://shop.example.eu', PORT: '3000',
    STRIPE_SECRET_KEY: 'sk_test_abc', ADMIN_PASSWORD: 'pa=ss "word"\nline', DATABASE_PATH: '../data/db.sqlite',
    NODE_OPTIONS: '--evil',
  };
  assert.equal(saveSettingsFile(shop, file, '/srv/app'), true);
  assert.equal((fs.statSync(file).mode & 0o777).toString(8), '600');
  assert.equal(saveSettingsFile({ ...shop, ADMIN_PASSWORD: 'changed' }, file, '/srv/app'), false); // never overwritten

  const copy = { BASE_URL: 'https://example.eu', ADMIN_PASSWORD: 'set-in-panel' };
  const filled = loadSettingsFile(copy, file);
  assert.deepEqual(filled.sort(), ['DATABASE_PATH', 'STRIPE_SECRET_KEY']);
  assert.equal(copy.STRIPE_SECRET_KEY, 'sk_test_abc');
  assert.equal(copy.DATABASE_PATH, '/srv/data/db.sqlite'); // stored absolute
  assert.equal(copy.ADMIN_PASSWORD, 'set-in-panel'); // the panel wins
  assert.equal(copy.BASE_URL, 'https://example.eu'); // never shared
  assert.equal(copy.NODE_OPTIONS, undefined); // only known shop settings
  assert.equal(copy.PORT, undefined);

  const other = {};
  loadSettingsFile(other, file);
  assert.equal(other.ADMIN_PASSWORD, 'pa=ss "word"\nline'); // any characters survive
});

test('no file, no Stripe key, or SETTINGS_FILE=off: nothing happens', () => {
  const file = path.join(tmp(), 'settings.env');
  assert.deepEqual(loadSettingsFile({}, file), []);
  assert.equal(saveSettingsFile({ ADMIN_PASSWORD: 'x' }, file), false);
  assert.equal(fs.existsSync(file), false);
  assert.equal(settingsFilePath({ SETTINGS_FILE: 'off' }), null);
  assert.equal(saveSettingsFile({ SETTINGS_FILE: 'off', STRIPE_SECRET_KEY: 'sk_test_x' }), false);
});
