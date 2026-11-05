'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const backup = require('../src/main/backup');
const clavier = require('../src/main/clavier');
const { makeStore } = require('./helpers');

test('export and import give back every group and shortcut', () => {
  const { store: a } = makeStore();
  const g = a.addGroup({ name: 'Links', color: '#22aa55' });
  a.add({ kind: 'link', url: 'https://example.com', groupId: g.id, trigger: { type: 'abbrev', text: ';ex' } });
  a.add({ kind: 'text', text: 'שלום\nעולם', trigger: { type: 'hotkey', mods: ['AltRight'], key: 'KeyQ', mac: { mods: ['MetaRight'], key: 'KeyQ' } } });
  const file = JSON.parse(JSON.stringify(backup.exportData(a)));
  assert.strictEqual(file.app, 'KeyBridge');

  const { store: b } = makeStore({ deviceId: 'mac-1' });
  assert.deepStrictEqual(backup.importData(b, file), { added: 2, replaced: 0, same: 0, skipped: 0 });
  assert.deepStrictEqual(b.shortcuts(), a.shortcuts());
  assert.deepStrictEqual(b.groups(), a.groups());

  // importing it again changes nothing
  assert.deepStrictEqual(backup.importData(b, file), { added: 0, replaced: 0, same: 2, skipped: 0 });
  assert.deepStrictEqual(b.trash(), []);
});

test('an import over edited shortcuts keeps the edits in the trash', () => {
  const { store } = makeStore();
  const s = store.add({ text: 'original' });
  const file = backup.exportData(store);
  store.update(s.id, { text: 'edited since' });
  assert.deepStrictEqual(backup.importData(store, file), { added: 0, replaced: 1, same: 0, skipped: 0 });
  assert.strictEqual(store.get(s.id).text, 'original');
  assert.deepStrictEqual(store.trash().map((t) => [t.reason, t.shortcut.text]), [['replaced by import', 'edited since']]);
});

test('files that are not KeyBridge exports are refused', () => {
  const { store } = makeStore();
  for (const [data, code] of [[null, 'not-keybridge'], [{ app: 'Other', shortcuts: [] }, 'not-keybridge'], [{ app: 'KeyBridge', format: 99, shortcuts: [] }, 'newer-format']]) {
    assert.throws(() => backup.importData(store, data), (e) => e.code === code);
  }
  assert.deepStrictEqual(backup.importData(store, { app: 'KeyBridge', format: 1, shortcuts: [null, { text: 'no id' }] }), { added: 0, replaced: 0, same: 0, skipped: 2 });
});

test('Clavier+ shortcuts go into their own group, once', () => {
  const { store } = makeStore();
  const { items } = clavier.read(fs.readFileSync(path.join(__dirname, 'fixtures', 'clavier-sample.ini')));
  assert.deepStrictEqual(backup.addImported(store, items, 'Clavier+'), { added: 8, existing: 0 });
  assert.deepStrictEqual(store.groups().map((g) => g.name), ['Clavier+']);
  assert.ok(store.shortcuts().every((s) => s.groupId === store.groups()[0].id && s.device === 'pc-1' && s.created > 0));
  assert.strictEqual(store.shortcuts()[0].usages, 8, 'Clavier+ usage counts come along');

  assert.deepStrictEqual(backup.addImported(store, items, 'Clavier+'), { added: 0, existing: 8 });
  assert.strictEqual(store.groups().length, 1);
});
