'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const clavier = require('../src/main/clavier');
const { clavierIni } = require('./helpers');

const FIXTURE = path.join(__dirname, 'fixtures', 'clavier-sample.ini');
const hk = (mods, key) => ({ type: 'hotkey', mods, key });
const block = (code, ...rest) => ['Shortcut=x', `Code=${code}`, ...rest];
const one = (lines) => clavier.read(clavierIni([lines]));

test('the sample file: right and left Shift kept apart, text and usage counts kept', () => {
  const { items, skipped, warnings } = clavier.read(fs.readFileSync(FIXTURE));
  assert.deepStrictEqual([skipped, warnings], [[], []]);
  assert.strictEqual(items.length, 8);
  assert.deepStrictEqual(items[0], { trigger: hk(['ShiftRight'], 'KeyG'), name: '', usages: 8, enabled: true, platforms: 'all', kind: 'text', text: '12345678' });
  assert.deepStrictEqual(items[1].trigger, hk(['ShiftLeft'], 'KeyL'));
  assert.strictEqual(items[3].text, 'me@example.com');
  assert.strictEqual(items[7].text, 'שלום, זה טקסט לדוגמה');
  assert.ok(items.every((i) => i.kind === 'text' && i.enabled));
});

test('Ctrl, Alt and Win codes on each side, and either side', () => {
  const code = (vk, left, right) => vk + left * 0x100 + right * 0x1000000;
  const sided = 'DistinguishLeftRight=1';
  const cases = [
    [code(0x31, 0, 2), sided, hk(['ControlRight'], 'Digit1')],
    [code(0x51, 1, 0), sided, hk(['AltLeft'], 'KeyQ')],
    [code(0x74, 0, 8), sided, hk(['MetaRight'], 'F5')],
    [code(0x4b, 2, 4), sided, hk(['ControlLeft', 'ShiftRight'], 'KeyK')],
    [code(0xba, 0, 1), sided, hk(['AltRight'], 'Semicolon')],
    [code(0x54, 3, 0), null, hk(['Control', 'Alt'], 'KeyT')],
    [code(0x7c, 0, 0), null, hk([], 'F13')],
  ];
  for (const [c, flag, trigger] of cases) {
    const { items } = one(block(c, ...(flag ? [flag] : []), 'Text=x'));
    assert.deepStrictEqual(items[0].trigger, trigger, String(c));
  }
});

test('multi-line text, escapes and the keystrokes KeyBridge can type', () => {
  const { items, warnings } = one(block(1089, 'DistinguishLeftRight=1', 'Text=Hello \\[name\\][Tab]x', '>line 2[Enter][]end', '>[|a|b|]'));
  assert.deepStrictEqual(warnings, []);
  assert.strictEqual(items[0].text, 'Hello [name]\tx\nline 2\nend\na|b');
});

test('a literal {date} stays literal text', () => {
  assert.strictEqual(one(block(1089, 'Text=see {date}')).items[0].text, 'see {{date}');
});

test('keystrokes and commands KeyBridge cannot do: imported switched off, with the reason', () => {
  const { items, warnings } = one(block(1089, 'Text=a[{Wait,100}]b[Ctrl+V]c[[notepad.exe]]d'));
  assert.deepStrictEqual([items[0].text, items[0].enabled], ['abcd', false]);
  assert.deepStrictEqual(warnings, [{ n: 1, codes: ['text-special', 'text-keystroke', 'text-command'] }]);
});

test('commands become links, files and folders, or programs', () => {
  const read = (cmd, ...extra) => one(block(1089, `Command=${cmd}`, ...extra));
  assert.deepStrictEqual(read('https://example.com/x?a=1&b=2').items[0], { trigger: hk(['Shift'], 'KeyA'), name: '', usages: 0, enabled: true, platforms: 'all', kind: 'link', url: 'https://example.com/x?a=1&b=2' });
  assert.strictEqual(read('www.example.org').items[0].url, 'https://www.example.org');
  assert.strictEqual(read('mailto:me@example.com').items[0].kind, 'link');

  const prog = read('"C:\\Program Files\\App\\app.exe" -new "a b"').items[0];
  assert.deepStrictEqual([prog.kind, prog.path, prog.args, prog.platforms], ['program', { win: 'C:\\Program Files\\App\\app.exe', mac: '' }, '-new "a b"', 'win']);
  const bare = read('C:\\Tools\\tool.exe --fast').items[0];
  assert.deepStrictEqual([bare.path.win, bare.args], ['C:\\Tools\\tool.exe', '--fast']);

  const folder = read('%USERPROFILE%\\My Documents', 'Directory=C:\\').items;
  assert.deepStrictEqual([folder[0].kind, folder[0].path.win, folder[0].enabled], ['file', '%USERPROFILE%\\My Documents', true]);
  assert.deepStrictEqual(read('%USERPROFILE%\\My Documents', 'Directory=C:\\').warnings, [{ n: 1, codes: ['directory'] }]);
});

test('shortcuts limited to some programs or to Caps Lock come in switched off', () => {
  const programs = one(block(1089, 'Text=x', 'Programs=notepad.exe'));
  assert.deepStrictEqual([programs.items[0].enabled, programs.warnings[0].codes], [false, ['programs']]);
  const caps = one(block(1089, 'Text=x', 'CapsLock=Yes'));
  assert.deepStrictEqual([caps.items[0].enabled, caps.warnings[0].codes], [false, ['condition']]);
});

test('keys KeyBridge cannot catch, and empty blocks, are skipped and counted', () => {
  const r = clavier.read(clavierIni([block(0x13 + 0x400, 'Text=pause key'), block(0x41, 'Text=A alone'), block(1089), block(1090, 'Text=ok')]));
  assert.deepStrictEqual(r.skipped, [{ n: 1, reason: 'key' }, { n: 2, reason: 'key' }, { n: 3, reason: 'empty' }]);
  assert.strictEqual(r.items.length, 1);
});

test('a Clavier+ running in French writes French field names', () => {
  const r = clavier.read(clavierIni([['Raccourci=Maj Droite + G', 'Code=67108935', 'DistinguerGaucheDroite=1', 'Texte=bonjour', '>ligne', 'Utilisations=3']], ['Langue=Français']));
  assert.deepStrictEqual([r.items[0].trigger, r.items[0].text, r.items[0].usages], [hk(['ShiftRight'], 'KeyG'), 'bonjour\nligne', 3]);
});

test('other encodings Clavier.ini may have', () => {
  const utf8 = Buffer.from('Shortcut=x\r\nCode=1089\r\nText=hi\r\n-\r\n', 'utf8');
  assert.strictEqual(clavier.read(utf8).items[0].text, 'hi');
  const noBom = Buffer.from('Shortcut=x\nCode=1089\nText=hi\n-\n', 'utf16le');
  assert.strictEqual(clavier.read(noBom).items[0].text, 'hi');
});

// The user's real Clavier+ settings, only on a computer that has them. Nothing from the file is
// printed: the checks compare counts only.
test('the real Clavier.ini on this computer, if there is one', { skip: !clavier.exists() && 'no Clavier+ here' }, (t) => {
  const buffer = fs.readFileSync(clavier.DEFAULT_PATH);
  const blocks = (clavier.decode(buffer).match(/^Code=/gm) || []).length;
  const { items, skipped, warnings } = clavier.read(buffer);
  assert.ok(blocks > 0, 'the file has shortcuts');
  assert.strictEqual(items.length + skipped.length, blocks, 'every shortcut is imported or counted as skipped');
  assert.ok(items.every((i) => i.trigger && i.trigger.type === 'hotkey'), 'every imported shortcut has its hotkey');
  t.diagnostic(`${items.length} imported, ${skipped.length} skipped, ${warnings.length} with warnings`);
});
