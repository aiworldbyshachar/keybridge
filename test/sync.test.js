'use strict';
const test = require('node:test');
const assert = require('node:assert');
const vault = require('../src/main/vault');
const { FakeCloud, computer, snapshot } = require('./fake-cloud');

const DAY = 24 * 3600 * 1000;
let KEY;
let OTHER_KEY;
test.before(async () => {
  KEY = await vault.deriveKey('K7QM-4XRT-P9WE');
  OTHER_KEY = await vault.deriveKey('AAAA-BBBB-CCCC');
});

const rightShift = (key) => ({ type: 'hotkey', mods: ['ShiftRight'], key });

// PC and Mac on one account; the Mac's clock runs an hour behind unless a test moves it.
function pair(opts = {}) {
  const cloud = new FakeCloud();
  const pc = computer(cloud, 'pc', KEY, opts);
  const mac = computer(cloud, 'mac', KEY, { ...opts, start: Date.UTC(2026, 10, 5, 11) });
  return { cloud, pc, mac };
}

async function syncAll(...pcs) {
  for (let i = 0; i < 2; i++) for (const p of pcs) await p.sync.run();
}

test('a shortcut made on one computer appears on the other, and the server sees only ciphertext', async () => {
  const { cloud, pc, mac } = pair();
  const g = pc.store.addGroup({ name: 'Personal' });
  pc.store.add({ name: 'Email', text: 'me@example.com', trigger: rightShift('KeyA'), groupId: g.id });
  assert.deepStrictEqual(await pc.sync.run(), { pulled: 0, pushed: 2, conflicts: 0, unreadable: 0 });
  assert.deepStrictEqual((await mac.sync.run()).pulled, 2);
  assert.strictEqual(snapshot(mac), snapshot(pc));
  assert.strictEqual(mac.store.shortcuts()[0].groupId, g.id);

  const server = cloud.dump();
  for (const secret of ['me@example.com', 'Email', 'Personal', 'ShiftRight', 'KeyA']) assert.ok(!server.includes(secret), `server sees "${secret}"`);
});

test('nothing to do when nothing changed; using a shortcut is not a change', async () => {
  const { pc, mac } = pair();
  const s = pc.store.add({ text: 'x', trigger: rightShift('KeyX') });
  await syncAll(pc, mac);
  pc.store.used(s.id);
  const pushesBefore = pc.backend.pushes;
  assert.deepStrictEqual(await pc.sync.run(), { pulled: 0, pushed: 0, conflicts: 0, unreadable: 0 });
  assert.deepStrictEqual(await mac.sync.run(), { pulled: 0, pushed: 0, conflicts: 0, unreadable: 0 });
  assert.strictEqual(pc.backend.pushes, pushesBefore, 'no request when there is nothing to push');
  assert.strictEqual(pc.store.get(s.id).usages, 1, 'the count stays on this computer');
});

test('edits, deletes, the trash and restores travel', async () => {
  const { pc, mac } = pair();
  const s = pc.store.add({ text: 'v1', trigger: rightShift('KeyB') });
  await syncAll(pc, mac);
  mac.store.update(s.id, { text: 'v2' });
  await syncAll(mac, pc);
  assert.strictEqual(pc.store.get(s.id).text, 'v2');

  pc.store.remove(s.id);
  await syncAll(pc, mac);
  assert.strictEqual(mac.store.get(s.id), null);
  assert.deepStrictEqual(mac.store.trash().map((t) => t.shortcut.text), ['v2'], 'one trash entry, from the computer that deleted');

  mac.store.restore(mac.store.trash()[0].id);
  await syncAll(mac, pc);
  assert.strictEqual(pc.store.get(s.id).text, 'v2');
  assert.deepStrictEqual([pc.store.trash(), mac.store.trash()], [[], []]);
  assert.strictEqual(snapshot(pc), snapshot(mac));
});

test('both edit the same shortcut while apart: the later edit wins, the other is in the trash on both', async () => {
  const { pc, mac } = pair();
  const s = pc.store.add({ text: 'start', trigger: rightShift('KeyC') });
  await syncAll(pc, mac);
  pc.clock.days(1);
  mac.clock.days(1);
  mac.store.update(s.id, { text: 'from the Mac, earlier' });
  pc.clock.at += 60000;
  pc.store.update(s.id, { text: 'from the PC, later' });
  // either one may reach the server first
  await mac.sync.run();
  const r = await pc.sync.run();
  assert.strictEqual(r.conflicts, 1);
  await syncAll(mac, pc);
  for (const p of [pc, mac]) {
    assert.strictEqual(p.store.get(s.id).text, 'from the PC, later', p.name);
    assert.deepStrictEqual(p.store.trash().map((t) => [t.reason, t.shortcut.text]), [['conflict', 'from the Mac, earlier']], p.name);
  }
  assert.strictEqual(snapshot(pc), snapshot(mac));
});

test('the later edit also wins when it reaches the server first', async () => {
  const { pc, mac } = pair();
  const s = pc.store.add({ text: 'start' });
  await syncAll(pc, mac);
  pc.store.update(s.id, { text: 'PC, earlier' });
  mac.clock.days(1);
  mac.store.update(s.id, { text: 'Mac, later' });
  await mac.sync.run();
  await pc.sync.run();
  await syncAll(mac, pc);
  for (const p of [pc, mac]) {
    assert.strictEqual(p.store.get(s.id).text, 'Mac, later');
    assert.deepStrictEqual(p.store.trash().map((t) => t.shortcut.text), ['PC, earlier']);
  }
});

test('deleted on one, edited on the other: the edit stays, whichever syncs first', async () => {
  for (const deleterFirst of [true, false]) {
    const { pc, mac } = pair();
    const s = pc.store.add({ text: 'old' });
    await syncAll(pc, mac);
    pc.store.remove(s.id);
    mac.store.update(s.id, { text: 'edited' });
    if (deleterFirst) await syncAll(pc, mac);
    else await syncAll(mac, pc);
    for (const p of [pc, mac]) {
      assert.strictEqual(p.store.get(s.id)?.text, 'edited', `${p.name}, deleter first: ${deleterFirst}`);
      assert.deepStrictEqual(p.store.trash().map((t) => t.shortcut.text), ['old'], 'the deleted version is still in the trash');
    }
    assert.strictEqual(snapshot(pc), snapshot(mac));
  }
});

test('a group deleted with its shortcuts, and restored, on the other computer too', async () => {
  const { pc, mac } = pair();
  const g = pc.store.addGroup({ name: 'Work' });
  pc.store.add({ text: 'a', groupId: g.id });
  pc.store.add({ text: 'b', groupId: g.id });
  await syncAll(pc, mac);
  pc.store.removeGroup(g.id);
  await syncAll(pc, mac);
  assert.deepStrictEqual([mac.store.groups(), mac.store.shortcuts()], [[], []]);
  mac.store.restore(mac.store.trash()[0].id);
  await syncAll(mac, pc);
  assert.deepStrictEqual(pc.store.shortcuts().map((s) => s.text).sort(), ['a', 'b']);
  assert.strictEqual(pc.store.group(g.id).name, 'Work');
  assert.strictEqual(snapshot(pc), snapshot(mac));
});

test('the trash empties itself after 30 days on every computer', async () => {
  const { pc, mac } = pair();
  pc.store.remove(pc.store.add({ text: 'gone' }).id);
  await syncAll(pc, mac);
  assert.strictEqual(mac.store.trash().length, 1);
  pc.clock.days(31);
  pc.store.purge();
  pc.store.save();
  await syncAll(pc, mac);
  assert.deepStrictEqual(mac.store.trash(), []);
});

test('shortcuts made before signing in join the account from both computers', async () => {
  const { pc, mac } = pair();
  pc.store.add({ text: 'made on the PC' });
  mac.store.add({ text: 'made on the Mac' });
  await syncAll(pc, mac);
  for (const p of [pc, mac]) assert.deepStrictEqual(p.store.shortcuts().map((s) => s.text).sort(), ['made on the Mac', 'made on the PC']);
});

test('signing in again counts only what came in, not shortcuts already deleted here', async () => {
  const { cloud, pc, mac } = pair();
  pc.store.add({ text: 'kept', trigger: rightShift('KeyK') });
  const gone = pc.store.add({ text: 'deleted', trigger: rightShift('KeyD') });
  await syncAll(pc, mac);
  pc.store.remove(gone.id);
  await syncAll(pc, mac);
  // signed out and back in: the sync memory is gone, the shortcuts stay
  mac.sync.forget();
  assert.deepStrictEqual(await mac.sync.run(), { pulled: 0, pushed: 0, conflicts: 0, unreadable: 0 });
  // a new computer gets the shortcut and the trash entry, nothing for the deleted one
  const third = computer(cloud, 'third', KEY);
  assert.strictEqual((await third.sync.run()).pulled, 2);
  assert.strictEqual(snapshot(third), snapshot(pc));
});

test('the same backup imported on both before signing in is not a conflict', async () => {
  const { pc, mac } = pair();
  const s = pc.store.add({ text: 'same' });
  mac.store.put(structuredClone(pc.store.get(s.id)));
  await syncAll(pc, mac);
  assert.deepStrictEqual([pc.store.trash(), mac.store.trash(), mac.store.shortcuts().length], [[], [], 1]);
});

test('rows sealed with another code, or tampered with, are skipped and counted', async () => {
  const { cloud, pc, mac } = pair();
  pc.store.add({ text: 'a' });
  pc.store.add({ text: 'b' });
  await pc.sync.run();
  // a computer with the wrong code reads nothing
  const stranger = computer(cloud, 'stranger', OTHER_KEY);
  assert.deepStrictEqual(await stranger.sync.run(), { pulled: 0, pushed: 0, conflicts: 0, unreadable: 2 });
  assert.deepStrictEqual(stranger.store.shortcuts(), []);
  // the server swaps two rows' contents: both refuse to open
  const rows = [...cloud.account('user-1').rows.values()];
  [rows[0].data, rows[1].data] = [rows[1].data, rows[0].data];
  assert.strictEqual((await mac.sync.run()).unreadable, 2);
  assert.deepStrictEqual(mac.store.shortcuts(), []);
});

test('offline: nothing changes until the cloud is back, then everything goes', async () => {
  const { pc, mac } = pair();
  pc.backend.offline = true;
  pc.store.add({ text: 'written offline' });
  await assert.rejects(pc.sync.run(), /offline/);
  pc.backend.offline = false;
  await syncAll(pc, mac);
  assert.deepStrictEqual(mac.store.shortcuts().map((s) => s.text), ['written offline']);
});

test('many changes go in pages', async () => {
  const { pc, mac } = pair({ page: 3 });
  for (let i = 0; i < 10; i++) pc.store.add({ text: `t${i}` });
  assert.strictEqual((await pc.sync.run()).pushed, 10);
  assert.strictEqual((await mac.sync.run()).pulled, 10);
  assert.strictEqual(snapshot(pc), snapshot(mac));
});

test('a sync asked for during a sync runs right after it', async () => {
  const { pc, mac } = pair();
  pc.store.add({ text: 'first' });
  const one = pc.sync.run();
  pc.store.add({ text: 'second' });
  const two = pc.sync.run();
  assert.strictEqual(one, two);
  await one;
  await mac.sync.run();
  assert.strictEqual(mac.store.shortcuts().length, 2);
});

test('another account starts from scratch; the sync memory survives a restart', async () => {
  const { pc, mac } = pair();
  pc.store.add({ text: 'x' });
  await syncAll(pc, mac);
  const cursor = mac.sync.state.cursor;
  mac.sync.load('user-1');
  assert.strictEqual(mac.sync.state.cursor, cursor);
  mac.sync.load('someone-else');
  assert.deepStrictEqual(mac.sync.state, { account: 'someone-else', cursor: 0, known: {} });
});

test('the vault: right code opens, wrong code and another id do not', () => {
  const sealed = vault.seal(KEY, 'id-1', { t: 'shortcut', v: { text: 'שלום' } });
  assert.deepStrictEqual(vault.open(KEY, 'id-1', sealed), { t: 'shortcut', v: { text: 'שלום' } });
  assert.notStrictEqual(sealed, vault.seal(KEY, 'id-1', { t: 'shortcut', v: { text: 'שלום' } }), 'a fresh IV every time');
  assert.throws(() => vault.open(OTHER_KEY, 'id-1', sealed), (e) => e.code === 'unreadable');
  assert.throws(() => vault.open(KEY, 'id-2', sealed), (e) => e.code === 'unreadable');
  assert.throws(() => vault.open(KEY, 'id-1', 'garbage'), (e) => e.code === 'unreadable');
  const check = vault.makeCheck(KEY);
  assert.ok(vault.checkMatches(KEY, check));
  assert.ok(!vault.checkMatches(OTHER_KEY, check));
});

test('codes: 12 characters, no look-alikes, typed any way', async () => {
  const { generateCode, isValidCode, normalizeCode } = require('../src/main/code');
  const code = generateCode();
  assert.match(code, /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
  assert.ok(isValidCode(code.toLowerCase().replace(/-/g, ' ')));
  assert.ok(!isValidCode('K7QM-4XRT-P9W0'), '0 is not in the alphabet');
  assert.ok(!isValidCode('K7QM-4XRT'));
  assert.deepStrictEqual(await vault.deriveKey('k7qm 4xrt p9we'), KEY, 'spaces, dashes and case do not matter');
  assert.strictEqual(normalizeCode(' k7qm-4xrt-p9we '), 'K7QM4XRTP9WE');
});
