'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { LANGUAGES, STRINGS, createTranslator } = require('../src/shared/i18n');

const flat = (msg) => (typeof msg === 'object' ? Object.values(msg) : [msg]);
const placeholders = (msg) => new Set(flat(msg).flatMap((s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1])));

test('every language has every string, with the same placeholders', () => {
  const keys = Object.keys(STRINGS.en);
  for (const { code } of LANGUAGES) {
    const table = STRINGS[code];
    assert.ok(table, `missing language ${code}`);
    assert.deepStrictEqual(Object.keys(table).filter((k) => !(k in STRINGS.en)), [], `${code}: keys not in English`);
    for (const key of keys) {
      assert.ok(key in table, `${code}: missing "${key}"`);
      const want = placeholders(STRINGS.en[key]);
      const got = placeholders(table[key]);
      for (const p of got) assert.ok(want.has(p) || p === 'n', `${code}.${key}: unknown placeholder {${p}}`);
      for (const p of want) if (p !== 'n') assert.ok(got.has(p), `${code}.${key}: lost placeholder {${p}}`);
      if (typeof STRINGS.en[key] === 'object') {
        assert.ok(typeof table[key] === 'object' && table[key].other, `${code}.${key}: needs plural forms`);
        // every plural form the language uses is there
        const rules = new Intl.PluralRules(code).resolvedOptions().pluralCategories;
        for (const form of rules) assert.ok(table[key][form] || table[key].other, `${code}.${key}: no "${form}" form`);
      }
    }
  }
});

test('short hyphens only: no em or en dashes in any string or UI file', () => {
  for (const { code } of LANGUAGES) {
    for (const [key, msg] of Object.entries(STRINGS[code])) {
      for (const s of flat(msg)) assert.ok(!/[–—]/.test(s), `${code}.${key} has a long dash: ${s}`);
    }
  }
  for (const file of ['src/renderer/index.html', 'src/renderer/app.js', 'src/renderer/style.css', 'src/main/main.js', 'README.md']) {
    const text = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.ok(!/[–—]/.test(text), `${file} has a long dash`);
  }
});

test('plurals and placeholders are filled in', () => {
  const en = createTranslator('en');
  assert.strictEqual(en.t('trayOnLine', { n: 1 }), '1 shortcut on');
  assert.strictEqual(en.t('countAll', { n: 1200, on: 3 }), '1,200 shortcuts · 3 on');
  assert.strictEqual(en.t('keyRight', { key: 'Shift' }), 'Right Shift');
  assert.strictEqual(en.t('toastGroupDeleted', { n: 0 }), 'Group deleted');
  const ru = createTranslator('ru');
  assert.notStrictEqual(ru.t('trayOnLine', { n: 1 }), ru.t('trayOnLine', { n: 5 }));
  const he = createTranslator('he');
  assert.strictEqual(he.dir, 'rtl');
  assert.ok(he.t('accSyncedAt', { when: 'x' }).includes('⁨x⁩'), 'values are isolated in right-to-left text');
  assert.strictEqual(createTranslator('xx').code, 'en', 'unknown language falls back to English');
});
