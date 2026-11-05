'use strict';
// Key names: W3C KeyboardEvent.code names, the same ones the helper uses (native/src/*.rs) and the
// renderer gets from a key press. Names are about the physical key, so one name works on both
// systems: Alt is Option on the Mac, Meta is Win / Cmd.

const SIDED_MODIFIERS = ['ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight'];
// "Either side" modifiers: 'Shift' matches Left Shift or Right Shift.
const GENERIC_MODIFIERS = { Control: ['ControlLeft', 'ControlRight'], Alt: ['AltLeft', 'AltRight'], Shift: ['ShiftLeft', 'ShiftRight'], Meta: ['MetaLeft', 'MetaRight'] };
// Label order, the usual one on both systems (Ctrl Alt Shift Win / Control Option Shift Cmd).
const MODIFIER_ORDER = ['Control', 'ControlLeft', 'ControlRight', 'Alt', 'AltLeft', 'AltRight', 'Shift', 'ShiftLeft', 'ShiftRight', 'Meta', 'MetaLeft', 'MetaRight'];

const range = (prefix, items) => items.map((x) => prefix + x);
const KEYS = [
  ...range('Key', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')),
  ...range('Digit', '0123456789'.split('')),
  ...range('F', Array.from({ length: 24 }, (_, i) => i + 1)),
  ...range('Numpad', '0123456789'.split('')),
  'NumpadMultiply', 'NumpadAdd', 'NumpadSubtract', 'NumpadDecimal', 'NumpadDivide', 'NumpadEnter', 'NumpadEqual',
  'Minus', 'Equal', 'BracketLeft', 'BracketRight', 'Backslash', 'Semicolon', 'Quote', 'Backquote', 'Comma',
  'Period', 'Slash', 'IntlBackslash', 'Space', 'Enter', 'Tab', 'Backspace', 'Escape', 'Delete', 'Insert',
  'Home', 'End', 'PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ContextMenu',
  'CapsLock', 'ScrollLock', 'NumLock', 'PrintScreen',
];
// Keys one system's keyboards don't send (the helper there can't catch them).
const MISSING = {
  mac: ['F21', 'F22', 'F23', 'F24', 'CapsLock', 'ScrollLock', 'PrintScreen'],
  win: ['NumpadEqual'],
};

// Keys that type a character: a hotkey on one of them needs a modifier, or typing would break.
const TYPING_KEYS = KEYS.filter((k) => /^(Key|Digit|Numpad)/.test(k) && k !== 'NumpadEnter')
  .concat(['Minus', 'Equal', 'BracketLeft', 'BracketRight', 'Backslash', 'Semicolon', 'Quote', 'Backquote', 'Comma', 'Period', 'Slash', 'IntlBackslash', 'Space']);
// Keys that may be a hotkey on their own.
const ALONE_OK = KEYS.filter((k) => /^F\d+$/.test(k)).concat(['Insert', 'PrintScreen', 'ScrollLock', 'ContextMenu']);

const isModifier = (name) => SIDED_MODIFIERS.includes(name) || name in GENERIC_MODIFIERS;
const isKey = (name) => KEYS.includes(name);
const isTypingKey = (name) => TYPING_KEYS.includes(name);
const hasKey = (name, platform) => isKey(name) && !(MISSING[platform] || []).includes(name);
// 'ShiftRight' -> 'Shift'
const modifierBase = (name) => name.replace(/(Left|Right)$/, '');

const MODIFIER_LABELS = {
  win: { Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Meta: 'Win' },
  mac: { Control: 'Control', Alt: 'Option', Shift: 'Shift', Meta: 'Cmd' },
};

function modifierLabel(name, platform) {
  const base = MODIFIER_LABELS[platform === 'mac' ? 'mac' : 'win'][modifierBase(name)];
  if (name.endsWith('Left')) return `Left ${base}`;
  if (name.endsWith('Right')) return `Right ${base}`;
  return base;
}

const SYMBOLS = {
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'",
  Backquote: '`', Comma: ',', Period: '.', Slash: '/', IntlBackslash: '<',
  NumpadMultiply: 'Num *', NumpadAdd: 'Num +', NumpadSubtract: 'Num -', NumpadDecimal: 'Num .',
  NumpadDivide: 'Num /', NumpadEnter: 'Num Enter', NumpadEqual: 'Num =',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Escape: 'Esc', Space: 'Space', Tab: 'Tab', Home: 'Home', End: 'End', PageUp: 'Page Up', PageDown: 'Page Down',
  ContextMenu: 'Menu', CapsLock: 'Caps Lock', ScrollLock: 'Scroll Lock', PrintScreen: 'Print Screen',
};
const PLATFORM_SYMBOLS = {
  win: { Enter: 'Enter', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', NumLock: 'Num Lock' },
  mac: { Enter: 'Return', Backspace: 'Delete', Delete: 'Fwd Delete', Insert: 'Help', NumLock: 'Clear' },
};

function keyLabel(name, platform) {
  const own = PLATFORM_SYMBOLS[platform === 'mac' ? 'mac' : 'win'][name];
  if (own) return own;
  if (SYMBOLS[name]) return SYMBOLS[name];
  let m = /^(?:Key|Digit)(.)$/.exec(name);
  if (m) return m[1];
  m = /^Numpad(\d)$/.exec(name);
  if (m) return `Num ${m[1]}`;
  return name;
}

module.exports = {
  SIDED_MODIFIERS, GENERIC_MODIFIERS, MODIFIER_ORDER, KEYS, MISSING, TYPING_KEYS, ALONE_OK,
  isModifier, isKey, isTypingKey, hasKey, modifierBase, modifierLabel, keyLabel,
};
