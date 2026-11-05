'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { compile } = require('../src/main/abbrev');

test('abbreviations become physical keys, Shift written out', () => {
  assert.deepStrictEqual(compile(';addr'), { keys: ['Semicolon', 'KeyA', 'KeyD', 'KeyD', 'KeyR'], word: false });
  assert.deepStrictEqual(compile('Sig!').keys, ['Shift+KeyS', 'KeyI', 'KeyG', 'Shift+Digit1']);
  assert.deepStrictEqual(compile('/q').keys, ['Slash', 'KeyQ']);
});

test('Hebrew abbreviations use the standard Hebrew layout', () => {
  assert.deepStrictEqual(compile('תודה'), { keys: ['Comma', 'KeyU', 'KeyS', 'KeyV'], word: true });
  // the same physical keys as typing it with the English layout on
  assert.deepStrictEqual(compile('שלום').keys, compile('akuo').keys);
  // ";addr" with the Hebrew layout on shows as "ףשגגר"
  assert.deepStrictEqual(compile('ףשגגר').keys, compile(';addr').keys);
});

test('whole-word abbreviations start with a letter or digit', () => {
  assert.strictEqual(compile('addr').word, true);
  assert.strictEqual(compile('2fa').word, true);
  assert.strictEqual(compile(';addr').word, false);
  assert.strictEqual(compile('..sig').word, false);
});

test('what an abbreviation cannot be', () => {
  for (const [text, code] of [['a', 'too-short'], ['', 'too-short'], ['x'.repeat(25), 'too-long'], ['a b', 'space'], ['a\tb', 'space'], ['café', 'character'], ['😀x', 'character']]) {
    assert.throws(() => compile(text), (err) => err.code === code, `${JSON.stringify(text)} -> ${code}`);
  }
});
