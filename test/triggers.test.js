'use strict';
const test = require('node:test');
const assert = require('node:assert');
const t = require('../src/main/triggers');

const hotkey = (mods, key, extra = {}) => ({ type: 'hotkey', mods, key, ...extra });

test('hotkeys are cleaned: known names, no repeats, the usual order', () => {
  assert.deepStrictEqual(t.normalize(hotkey(['ShiftRight', 'ControlRight', 'ShiftRight'], 'KeyA')), hotkey(['ControlRight', 'ShiftRight'], 'KeyA'));
  // 'Shift' next to 'ShiftLeft' adds nothing
  assert.deepStrictEqual(t.normalize(hotkey(['Shift', 'ShiftLeft'], 'KeyA')).mods, ['ShiftLeft']);
  assert.strictEqual(t.normalize(null), null);
  for (const [bad, code] of [
    [hotkey(['ShiftRight'], 'KeyÄ'), 'unknown-key'],
    [hotkey(['Hyper'], 'KeyA'), 'unknown-modifier'],
    [hotkey([], 'KeyA'), 'needs-modifier'],
    [{ type: 'mouse' }, 'unknown-type'],
  ]) {
    assert.throws(() => t.normalize(bad), (err) => err.code === code, code);
  }
  assert.deepStrictEqual(t.normalize(hotkey([], 'F13')), hotkey([], 'F13'), 'F keys may stand alone');
});

test('overrides per system are kept and used', () => {
  const trig = t.normalize(hotkey(['ControlRight'], 'Digit1', { mac: { mods: ['MetaRight'], key: 'Digit1' } }));
  assert.deepStrictEqual(t.comboFor(trig, 'win'), { mods: ['ControlRight'], key: 'Digit1' });
  assert.deepStrictEqual(t.comboFor(trig, 'mac'), { mods: ['MetaRight'], key: 'Digit1' });
  assert.strictEqual(t.label(trig, 'win'), 'Right Ctrl + 1');
  assert.strictEqual(t.label(trig, 'mac'), 'Right Cmd + 1');
});

test('abbreviation triggers', () => {
  assert.deepStrictEqual(t.normalize({ type: 'abbrev', text: ';addr' }), { type: 'abbrev', text: ';addr' });
  assert.throws(() => t.normalize({ type: 'abbrev', text: 'a b' }), (err) => err.code === 'space');
  assert.strictEqual(t.label({ type: 'abbrev', text: ';addr' }, 'win'), ';addr');
});

test('either-side modifiers become every left/right set for the helper', () => {
  assert.deepStrictEqual(t.expand(['Shift', 'ControlRight']), [['ShiftLeft', 'ControlRight'], ['ShiftRight', 'ControlRight']]);
  assert.strictEqual(t.expand(['Control', 'Shift']).length, 4);
  const { hotkeys } = t.forHelper([{ id: 'a', trigger: hotkey(['Shift'], 'F5') }], 'win');
  assert.deepStrictEqual(hotkeys, [{ id: 'a', mods: ['ShiftLeft'], key: 'F5' }, { id: 'a', mods: ['ShiftRight'], key: 'F5' }]);
});

test('right and left are different triggers; the same trigger twice is a conflict', () => {
  const list = [
    { id: 'right', trigger: hotkey(['ShiftRight'], 'KeyA') },
    { id: 'left', trigger: hotkey(['ShiftLeft'], 'KeyA') },
    { id: 'again', trigger: hotkey(['ShiftRight'], 'KeyA') },
    { id: 'either', trigger: hotkey(['Shift'], 'KeyA') },
    { id: 'abbr1', trigger: { type: 'abbrev', text: ';x1' } },
    { id: 'abbr2', trigger: { type: 'abbrev', text: ';x1' } },
    { id: 'none', trigger: null },
  ];
  const r = t.forHelper(list, 'win');
  assert.deepStrictEqual(r.hotkeys.map((h) => h.id), ['right', 'left'], 'the first one keeps a shared combo');
  assert.deepStrictEqual([...r.conflicts.get('right')].sort(), ['again', 'either']);
  assert.deepStrictEqual([...r.conflicts.get('either')].sort(), ['left', 'right']);
  assert.deepStrictEqual(r.abbrevs.map((a) => a.id), ['abbr1']);
  assert.ok(r.conflicts.get('abbr2').has('abbr1'));
});

test('an abbreviation typed on the Hebrew layout is the same keys as on English', () => {
  const r = t.forHelper([{ id: 'he', trigger: { type: 'abbrev', text: 'שלום' } }, { id: 'en', trigger: { type: 'abbrev', text: 'akuo' } }], 'win');
  assert.ok(r.conflicts.get('en').has('he'));
});

test('keys a system lacks are reported, not sent', () => {
  const r = t.forHelper([{ id: 'f24', trigger: hotkey(['ControlRight'], 'F24') }], 'mac');
  assert.deepStrictEqual(r.hotkeys, []);
  assert.deepStrictEqual(r.invalid, [{ id: 'f24', reason: 'key-missing' }]);
});

test('notes and suggested overrides for keys most keyboards lack', () => {
  const rc = t.normalize(hotkey(['ControlRight'], 'Digit1'));
  assert.strictEqual(t.note(rc, 'mac'), 'mac-no-right-control');
  assert.strictEqual(t.note(rc, 'win'), null);
  assert.strictEqual(t.note(t.normalize(hotkey(['MetaRight'], 'KeyQ')), 'win'), 'win-no-right-win');
  assert.strictEqual(t.note({ ...rc, mac: { mods: ['MetaRight'], key: 'Digit1' } }, 'mac'), null, 'an override answers the note');

  assert.deepStrictEqual(t.suggestOverride(rc, 'mac', []), { mods: ['MetaRight'], key: 'Digit1' });
  // Right Cmd + 1 is taken: Right Option + 1 is next
  const taken = [{ id: 'x', trigger: hotkey(['MetaRight'], 'Digit1') }];
  assert.deepStrictEqual(t.suggestOverride(rc, 'mac', taken), { mods: ['AltRight'], key: 'Digit1' });
  assert.strictEqual(t.suggestOverride(t.normalize(hotkey(['ShiftRight'], 'KeyA')), 'mac', []), null);
});

test('warnings: system combos, everyday app shortcuts on the left key, Shift on either side', () => {
  assert.deepStrictEqual(t.warnings(hotkey(['ControlLeft', 'AltLeft'], 'Delete'), 'win'), ['system']);
  assert.deepStrictEqual(t.warnings(hotkey(['Control'], 'KeyC'), 'win'), ['common']);
  assert.deepStrictEqual(t.warnings(hotkey(['ControlLeft'], 'KeyV'), 'win'), ['common']);
  assert.deepStrictEqual(t.warnings(hotkey(['ControlRight'], 'KeyC'), 'win'), [], 'Right Ctrl + C leaves copy alone');
  assert.deepStrictEqual(t.warnings(hotkey(['MetaRight'], 'KeyC'), 'mac'), []);
  assert.deepStrictEqual(t.warnings(hotkey(['MetaLeft'], 'KeyC'), 'mac'), ['common']);
  assert.deepStrictEqual(t.warnings(hotkey(['Meta'], 'Space'), 'mac'), ['system']);
  assert.deepStrictEqual(t.warnings(hotkey(['Shift'], 'KeyA'), 'win'), ['blocks-capital']);
  assert.deepStrictEqual(t.warnings(hotkey(['ShiftRight'], 'KeyA'), 'win'), []);
});
