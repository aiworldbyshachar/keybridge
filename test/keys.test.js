'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const keys = require('../src/shared/keys');

// The key names in a helper source table: ("KeyA", 0x1E) pairs.
function rustKeys(file) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'native', 'src', file), 'utf8');
  return new Set([...src.matchAll(/\("([A-Za-z0-9]+)", 0x[0-9A-Fa-f]+\)/g)].map((m) => m[1]));
}

test('the key list matches what the helper knows on each system', () => {
  for (const [platform, file] of [['win', 'win.rs'], ['mac', 'mac.rs']]) {
    const helper = rustKeys(file);
    const ours = new Set(keys.KEYS.filter((k) => keys.hasKey(k, platform)));
    assert.deepStrictEqual([...ours].filter((k) => !helper.has(k)), [], `${platform}: keys the helper can't catch`);
    assert.deepStrictEqual([...helper].filter((k) => !ours.has(k)), [], `${platform}: helper keys missing here`);
  }
});

test('modifier names: sided and either-side', () => {
  assert.ok(keys.isModifier('ShiftRight') && keys.isModifier('Meta') && !keys.isModifier('KeyA'));
  assert.strictEqual(keys.modifierBase('ControlRight'), 'Control');
  assert.strictEqual(keys.modifierLabel('AltRight', 'win'), 'Right Alt');
  assert.strictEqual(keys.modifierLabel('AltRight', 'mac'), 'Right Option');
  assert.strictEqual(keys.modifierLabel('MetaLeft', 'mac'), 'Left Cmd');
  assert.strictEqual(keys.modifierLabel('Meta', 'win'), 'Win');
});

test('key labels', () => {
  assert.strictEqual(keys.keyLabel('KeyA', 'win'), 'A');
  assert.strictEqual(keys.keyLabel('Digit7', 'mac'), '7');
  assert.strictEqual(keys.keyLabel('Numpad3', 'win'), 'Num 3');
  assert.strictEqual(keys.keyLabel('Semicolon', 'win'), ';');
  assert.strictEqual(keys.keyLabel('Enter', 'mac'), 'Return');
  assert.strictEqual(keys.keyLabel('Backspace', 'mac'), 'Delete');
  assert.strictEqual(keys.keyLabel('F13', 'win'), 'F13');
});
