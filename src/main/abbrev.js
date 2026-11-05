'use strict';
// Abbreviations (";addr" + Space -> the address) as physical keys.
//
// The helper keeps the last few typed keys in memory and compares them with these key sequences on
// each Space or Tab. Because keys are physical, an abbreviation fires on whichever layout it was
// typed: ";addr" typed while the Hebrew layout is on (it shows as "ףשגגר") still fires, and so
// does a Hebrew abbreviation typed on the English layout.

const MIN_LENGTH = 2;
const MAX_LENGTH = 24; // the helper keeps 32 keys

// US layout: character -> [key, shift]
const US = {};
for (const c of 'abcdefghijklmnopqrstuvwxyz') {
  US[c] = [`Key${c.toUpperCase()}`, false];
  US[c.toUpperCase()] = [`Key${c.toUpperCase()}`, true];
}
'1234567890'.split('').forEach((d, i) => {
  US[d] = [`Digit${d}`, false];
  US['!@#$%^&*()'[i]] = [`Digit${d}`, true];
});
for (const [key, plain, shifted] of [
  ['Minus', '-', '_'], ['Equal', '=', '+'], ['BracketLeft', '[', '{'], ['BracketRight', ']', '}'],
  ['Backslash', '\\', '|'], ['Semicolon', ';', ':'], ['Quote', "'", '"'], ['Backquote', '`', '~'],
  ['Comma', ',', '<'], ['Period', '.', '>'], ['Slash', '/', '?'],
]) {
  US[plain] = [key, false];
  US[shifted] = [key, true];
}

// Standard Hebrew layout (SI-1452, the same letters on Windows and Mac).
const HEBREW = {
  'ק': 'KeyE', 'ר': 'KeyR', 'א': 'KeyT', 'ט': 'KeyY', 'ו': 'KeyU', 'ן': 'KeyI', 'ם': 'KeyO', 'פ': 'KeyP',
  'ש': 'KeyA', 'ד': 'KeyS', 'ג': 'KeyD', 'כ': 'KeyF', 'ע': 'KeyG', 'י': 'KeyH', 'ח': 'KeyJ', 'ל': 'KeyK',
  'ך': 'KeyL', 'ף': 'Semicolon',
  'ז': 'KeyZ', 'ס': 'KeyX', 'ב': 'KeyC', 'ה': 'KeyV', 'נ': 'KeyB', 'מ': 'KeyN', 'צ': 'KeyM', 'ת': 'Comma',
  'ץ': 'Period',
};

class AbbrevError extends Error {
  constructor(code) {
    super(`abbreviation: ${code}`);
    this.code = code;
  }
}

// ";addr" -> { keys: ['Semicolon', 'KeyA', 'KeyD', 'KeyD', 'KeyR'], word: false }
// Keys typed with Shift are written 'Shift+KeyA'. `word` abbreviations (starting with a letter or
// digit) fire only when typed as a whole word, so "addr" doesn't fire inside "myaddr".
function compile(text) {
  const chars = Array.from(String(text || '').normalize('NFC'));
  if (chars.length < MIN_LENGTH) throw new AbbrevError('too-short');
  if (chars.length > MAX_LENGTH) throw new AbbrevError('too-long');
  const keys = chars.map((c) => {
    if (/\s/.test(c)) throw new AbbrevError('space');
    if (US[c]) return US[c][1] ? `Shift+${US[c][0]}` : US[c][0];
    if (HEBREW[c]) return HEBREW[c];
    throw new AbbrevError('character');
  });
  return { keys, word: /^[\p{L}\p{N}]/u.test(chars[0]) };
}

module.exports = { compile, AbbrevError, MIN_LENGTH, MAX_LENGTH };
