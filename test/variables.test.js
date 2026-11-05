'use strict';
const test = require('node:test');
const assert = require('node:assert');
const v = require('../src/main/variables');

const now = new Date(2026, 10, 5, 14, 30);

test('date and time follow the language', () => {
  assert.strictEqual(v.expand('{date}', { now, locale: 'he-IL' }).text, '5.11.2026');
  assert.strictEqual(v.expand('{date}', { now, locale: 'en-US' }).text, '11/5/2026');
  assert.strictEqual(v.expand('{time}', { now, locale: 'he-IL' }).text, '14:30');
});

test('clipboard goes in where it is asked for', () => {
  assert.strictEqual(v.expand('Re: {clipboard}!', { clipboard: 'invoice 42' }).text, 'Re: invoice 42!');
  assert.ok(v.uses('a {clipboard}', 'clipboard'));
  assert.ok(!v.uses('a {{clipboard}', 'clipboard'));
});

test('{cursor} says how far back the caret goes', () => {
  assert.deepStrictEqual(v.expand('Dear {cursor},\nThanks'), { text: 'Dear ,\nThanks', left: 8 });
  assert.deepStrictEqual(v.expand('no cursor'), { text: 'no cursor', left: 0 });
  // an emoji is one step back, not two
  assert.deepStrictEqual(v.expand('{cursor}😀'), { text: '😀', left: 1 });
});

test('"{{" is a plain brace, other braces stay as typed', () => {
  assert.strictEqual(v.expand('{{date} {name} {').text, '{date} {name} {');
  assert.strictEqual(v.escape('see {date} and {x}'), 'see {{date} and {x}');
  assert.strictEqual(v.expand(v.escape('{time}{cursor}')).text, '{time}{cursor}');
});
