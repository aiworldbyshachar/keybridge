'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { Store } = require('../src/main/store');
const { makeStore } = require('./helpers');

const rightShiftA = { type: 'hotkey', mods: ['ShiftRight'], key: 'KeyA' };

test('add, edit and read back from disk', () => {
  const { store, dir, clock } = makeStore();
  const s = store.add({ kind: 'text', text: 'line 1\r\nline 2', trigger: rightShiftA, name: 'Address' });
  assert.strictEqual(s.text, 'line 1\nline 2', 'line breaks are kept as \\n');
  assert.deepStrictEqual([s.version, s.device, s.created], [1, 'pc-1', clock.at]);

  clock.days(1);
  const edited = store.update(s.id, { text: 'new', usages: 99 });
  assert.deepStrictEqual([edited.text, edited.version, edited.usages, edited.created], ['new', 2, 0, s.created]);
  assert.strictEqual(edited.updated, clock.at);

  const again = new Store(dir);
  again.load();
  assert.deepStrictEqual(again.shortcuts(), store.shortcuts());
});

test('a trigger that cannot work is refused when editing', () => {
  const { store } = makeStore();
  assert.throws(() => store.add({ text: 'x', trigger: { type: 'hotkey', mods: [], key: 'KeyA' } }), (e) => e.code === 'needs-modifier');
  const s = store.add({ text: 'x' });
  assert.throws(() => store.update(s.id, { trigger: { type: 'abbrev', text: 'a' } }), (e) => e.code === 'too-short');
  assert.strictEqual(store.get(s.id).version, 1);
});

test('a damaged file loses only what is damaged', () => {
  const { store, dir } = makeStore();
  fs.writeFileSync(path.join(dir, 'shortcuts.json'), JSON.stringify({
    shortcuts: [{ id: 'a', text: 'kept', trigger: { type: 'hotkey', mods: ['Nope'], key: 'KeyA' } }, null, 'junk', { id: 'b', kind: 'weird', text: 'also kept' }],
    groups: 'not a list',
  }));
  store.load();
  assert.deepStrictEqual(store.shortcuts().map((s) => [s.id, s.kind, s.text, s.trigger]), [['a', 'text', 'kept', null], ['b', 'text', 'also kept', null]]);
  assert.deepStrictEqual(store.groups(), []);
});

test('deleted shortcuts go to the trash and come back', () => {
  const { store } = makeStore();
  const s = store.add({ text: 'keep me', trigger: rightShiftA });
  const entry = store.remove(s.id);
  assert.strictEqual(store.get(s.id), null);
  assert.deepStrictEqual(store.trash().map((t) => [t.id, t.reason, t.shortcut.text]), [[entry.id, 'deleted', 'keep me']]);
  store.restore(entry.id);
  assert.strictEqual(store.get(s.id).text, 'keep me');
  assert.deepStrictEqual(store.trash(), []);
});

test('restoring over a newer version keeps that one in the trash', () => {
  const { store } = makeStore();
  const s = store.add({ text: 'old' });
  const entry = store.remove(s.id);
  store.put({ ...s, text: 'newer' }, 'replaced by sync');
  store.restore(entry.id);
  assert.strictEqual(store.get(s.id).text, 'old');
  assert.deepStrictEqual(store.trash().map((t) => [t.reason, t.shortcut.text]), [['replaced', 'newer']]);
});

test('put replaces by id and keeps the replaced one', () => {
  const { store } = makeStore();
  const s = store.add({ text: 'mine' });
  assert.strictEqual(store.put({ ...s, text: 'theirs', version: 5 }, 'replaced by import'), 'replaced');
  assert.strictEqual(store.get(s.id).text, 'theirs');
  assert.deepStrictEqual(store.trash().map((t) => [t.reason, t.shortcut.text]), [['replaced by import', 'mine']]);
  assert.strictEqual(store.put({ id: 'new-one', text: 'x' }), 'added');
});

test('the trash forgets after 30 days, or when asked', () => {
  const { store, dir, clock } = makeStore();
  store.remove(store.add({ text: 'a' }).id);
  clock.days(20);
  const b = store.remove(store.add({ text: 'b' }).id);
  clock.days(11);
  assert.strictEqual(store.purge(), 1);
  assert.deepStrictEqual(store.trash().map((t) => t.shortcut.text), ['b']);
  store.forget(b.id);
  assert.deepStrictEqual(store.trash(), []);
  // loading purges too
  store.remove(store.add({ text: 'c' }).id);
  clock.days(31);
  const again = new Store(dir, { now: clock.now });
  again.load();
  assert.deepStrictEqual(again.trash(), []);
});

test('groups: on/off for all their shortcuts, deleted and restored together', () => {
  const { store } = makeStore();
  const g = store.addGroup({ name: 'Work', color: '#3366ff' });
  const a = store.add({ text: 'a', groupId: g.id });
  const b = store.add({ text: 'b' });
  assert.deepStrictEqual(store.active('win').map((s) => s.id), [a.id, b.id]);
  store.updateGroup(g.id, { enabled: false });
  assert.deepStrictEqual(store.active('win').map((s) => s.id), [b.id]);

  const entry = store.removeGroup(g.id);
  assert.deepStrictEqual(store.shortcuts().map((s) => s.id), [b.id]);
  store.restore(entry.id);
  assert.strictEqual(store.group(g.id).name, 'Work');
  assert.strictEqual(store.get(a.id).groupId, g.id);
  assert.strictEqual(store.add({ text: 'c', groupId: 'no-such-group' }).groupId, '');
});

test('which shortcuts run on which system', () => {
  const { store } = makeStore();
  const all = store.add({ text: 'all' });
  const win = store.add({ kind: 'program', path: { win: 'C:\\app.exe' }, platforms: 'win' });
  const off = store.add({ text: 'off', enabled: false });
  assert.deepStrictEqual(store.active('win').map((s) => s.id), [all.id, win.id]);
  assert.deepStrictEqual(store.active('mac').map((s) => s.id), [all.id]);
  assert.ok(!store.isActive(off, 'win'));
});

test('duplicate, usage counter, search', () => {
  const { store } = makeStore();
  const s = store.add({ name: 'Home address', text: 'Herzl 1, Tel Aviv', trigger: rightShiftA });
  const copy = store.duplicate(s.id);
  assert.deepStrictEqual([copy.name, copy.text, copy.trigger], ['Home address (copy)', 'Herzl 1, Tel Aviv', null]);
  store.used(s.id);
  store.used(s.id);
  assert.deepStrictEqual([store.get(s.id).usages, store.get(s.id).version], [2, 1], 'counting uses is not an edit');
  const link = store.add({ kind: 'link', url: 'https://example.com/שלום' });
  assert.deepStrictEqual(store.search('tel aviv').map((x) => x.id), [s.id, copy.id]);
  assert.deepStrictEqual(store.search('right shift').map((x) => x.id), [s.id]);
  assert.deepStrictEqual(store.search('שלום').map((x) => x.id), [link.id]);
  assert.strictEqual(store.search('  ').length, 3);
});

test('each kind keeps only its own fields', () => {
  const { store } = makeStore();
  const p = store.add({ kind: 'program', text: 'ignored', path: { win: ' C:\\Tools\\app.exe ', mac: '/Applications/App.app' }, args: '--new' });
  assert.deepStrictEqual([p.text, p.url, p.path, p.args], ['', '', { win: 'C:\\Tools\\app.exe', mac: '/Applications/App.app' }, '--new']);
  const l = store.add({ kind: 'link', url: ' https://example.com ', args: 'x' });
  assert.deepStrictEqual([l.url, l.args, l.path], ['https://example.com', '', { win: '', mac: '' }]);
});

test('every change is announced', () => {
  const { store } = makeStore();
  const seen = [];
  store.on('change', (c) => seen.push(c.type));
  const s = store.add({ text: 'a' });
  store.update(s.id, { text: 'b' });
  store.remove(s.id);
  assert.deepStrictEqual(seen, ['add', 'update', 'remove']);
});
