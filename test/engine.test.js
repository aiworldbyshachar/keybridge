'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const { Engine } = require('../src/main/engine');
const { makeStore } = require('./helpers');

// A helper that records what it's told, and an opener that records what it opens.
function setup({ platform = 'win', clipboard = '' } = {}) {
  const { store } = makeStore();
  const helper = new EventEmitter();
  helper.sent = [];
  helper.send = (cmd) => helper.sent.push(cmd);
  const opened = [];
  const opener = {
    openUrl: async (url) => opened.push(['url', url]),
    openPath: async (p) => opened.push(['path', p]),
    launch: async (p, args) => opened.push(['launch', p, args]),
  };
  const engine = new Engine({ store, helper, opener, platform, locale: 'he-IL', readClipboard: async () => clipboard, now: () => new Date(2026, 10, 5, 14, 30) });
  const problems = [];
  engine.on('problem', (e) => problems.push(e.message));
  engine.start();
  // the last command that inserts text (pushes of the trigger lists may come after it)
  const last = () => helper.sent.filter((c) => c.cmd === 'type' || c.cmd === 'paste').at(-1);
  return { store, helper, engine, opened, problems, last };
}
const tick = () => new Promise((r) => setImmediate(r));
const rightShift = (key) => ({ type: 'hotkey', mods: ['ShiftRight'], key });

test('when the helper is ready it gets the hotkeys and abbreviations of active shortcuts', () => {
  const { store, helper } = setup();
  const a = store.add({ text: 'a', trigger: rightShift('KeyA') });
  store.add({ text: 'off', trigger: rightShift('KeyB'), enabled: false });
  store.add({ text: 'mac only', trigger: rightShift('KeyC'), platforms: 'mac' });
  const ab = store.add({ text: 'addr', trigger: { type: 'abbrev', text: ';addr' } });
  helper.sent = [];
  helper.emit('event', { event: 'ready', platform: 'windows' });
  assert.deepStrictEqual(helper.sent, [
    { cmd: 'setHotkeys', hotkeys: [{ id: a.id, mods: ['ShiftRight'], key: 'KeyA' }] },
    { cmd: 'setAbbrevs', abbrevs: [{ id: ab.id, keys: ['Semicolon', 'KeyA', 'KeyD', 'KeyD', 'KeyR'], word: false }] },
  ]);
});

test('changes reach the helper once, even many at once', async () => {
  const { store, helper } = setup();
  helper.sent = [];
  for (let i = 0; i < 5; i++) store.add({ text: `t${i}`, trigger: rightShift(`Digit${i}`) });
  await tick();
  const pushes = helper.sent.filter((c) => c.cmd === 'setHotkeys');
  assert.strictEqual(pushes.length, 1);
  assert.strictEqual(pushes[0].hotkeys.length, 5);
});

test('a hotkey types short text and counts the use', async () => {
  const { store, helper, last } = setup();
  const s = store.add({ text: 'me@example.com', trigger: rightShift('KeyA') });
  helper.emit('event', { event: 'hotkey', id: s.id });
  await tick();
  assert.deepStrictEqual(last(), { cmd: 'type', text: 'me@example.com', erase: 0, left: 0 });
  assert.strictEqual(store.get(s.id).usages, 1);
});

test('long or multi-line text is pasted, with Windows line breaks on Windows', async () => {
  const win = setup();
  const s = win.store.add({ text: 'line 1\nline 2' });
  await win.engine.fire(s.id);
  assert.deepStrictEqual(win.last(), { cmd: 'paste', text: 'line 1\r\nline 2', erase: 0, left: 0 });
  const long = win.store.add({ text: 'x'.repeat(201) });
  await win.engine.fire(long.id);
  assert.strictEqual(win.last().cmd, 'paste');

  const mac = setup({ platform: 'mac' });
  const m = mac.store.add({ text: 'line 1\nline 2' });
  await mac.engine.fire(m.id);
  assert.strictEqual(mac.last().text, 'line 1\nline 2');
});

test('an abbreviation erases what was typed; Space comes back after the text, Tab does not', async () => {
  const { store, helper, engine, last } = setup();
  const s = store.add({ text: 'Dear {cursor},', trigger: { type: 'abbrev', text: ';dear' } });
  helper.emit('event', { event: 'abbrev', id: s.id, erase: 5, end: 'space' });
  await tick();
  assert.deepStrictEqual(last(), { cmd: 'type', text: 'Dear , ', erase: 5, left: 2 });
  await engine.fire(s.id, { erase: 5, end: 'tab' });
  assert.deepStrictEqual(last(), { cmd: 'type', text: 'Dear ,', erase: 5, left: 1 });
});

test('variables: date, time and clipboard', async () => {
  const { store, engine, last } = setup({ clipboard: 'invoice 42' });
  const s = store.add({ text: '{date} {time} {clipboard}' });
  await engine.fire(s.id);
  assert.strictEqual(last().text, '5.11.2026 14:30 invoice 42');
});

test('links, files and programs open; an abbreviation for one is erased first', async () => {
  const { store, engine, opened, helper, problems } = setup();
  const link = store.add({ kind: 'link', url: 'https://example.com' });
  const folder = store.add({ kind: 'file', path: { win: 'C:\\Work', mac: '~/Work' } });
  const app = store.add({ kind: 'program', path: { win: 'C:\\app.exe' }, args: '-x' });
  const macOnly = store.add({ kind: 'file', path: { mac: '/Users/me' } });
  await tick();
  helper.sent = [];
  await engine.fire(link.id, { erase: 3, end: 'space' });
  await engine.fire(folder.id);
  await engine.fire(app.id);
  await assert.rejects(engine.fire(macOnly.id), /no path for this computer/);
  assert.deepStrictEqual(opened, [['url', 'https://example.com'], ['path', 'C:\\Work'], ['launch', 'C:\\app.exe', '-x']]);
  assert.deepStrictEqual(helper.sent, [{ cmd: 'type', text: '', erase: 3 }]);
  assert.deepStrictEqual(problems, []);
});

test('switched-off shortcuts do nothing even if the helper still fires them', async () => {
  const { store, engine, helper } = setup();
  const s = store.add({ text: 'x', enabled: false });
  await tick();
  helper.sent = [];
  await engine.fire(s.id);
  await engine.fire('no-such-id');
  assert.deepStrictEqual(helper.sent, []);
});

test('pause reaches the helper, also after it starts again', () => {
  const { engine, helper } = setup();
  engine.setPaused(true);
  assert.deepStrictEqual(helper.sent.at(-1), { cmd: 'pause', paused: true });
  helper.sent = [];
  helper.emit('event', { event: 'ready' });
  assert.deepStrictEqual(helper.sent.at(-1), { cmd: 'pause', paused: true });
});

test('helper errors and skipped triggers are reported', () => {
  const { engine, helper, problems } = setup();
  const skipped = [];
  engine.on('skipped', (ids) => skipped.push(...ids));
  helper.emit('event', { event: 'error', message: 'Windows blocked the keys' });
  helper.emit('event', { event: 'hotkeysSet', count: 0, skipped: ['x'] });
  assert.deepStrictEqual([problems, skipped], [['Windows blocked the keys'], ['x']]);
});
