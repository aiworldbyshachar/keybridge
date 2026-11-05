'use strict';
// Import from Clavier+ (Windows): reads its settings file, Clavier.ini, into KeyBridge shortcuts.
//
// The format, as Clavier+ writes it (Shortcut.cpp in its source): UTF-16 with CRLF, blocks of
// "Key=value" lines each ended by a line starting with "-". Field names are in the language
// Clavier+ runs in. "Code" = virtual key | (modifier bits << 8): Alt 1, Ctrl 2, Shift 4, Win 8 for
// the left key, the same << 16 for the right one; without "DistinguishLeftRight" either side counts.
// Text continues on lines starting with ">"; in text "\" escapes the next character and "[...]"
// holds keystrokes or commands.
const path = require('path');
const fs = require('fs');
const keys = require('../shared/keys');
const variables = require('./variables');

const DEFAULT_PATH = path.join(process.env.LOCALAPPDATA || '', 'Clavier+', 'Clavier.ini');

// Field names per language (Clavier+ IDS_TOKENS; the languages it doesn't translate use English).
const TOKENS = [
  'English;Shortcut;Code;DistinguishLeftRight;Description;Command;Text;Directory;Window;Programs;AllProgramsBut;Language;Size;Columns;Sorting;Normal;Minimized;Maximized;Win;Ctrl;Shift;Alt;Left;Right;CapsLock;NumLock;ScrollLock;Yes;No;Usages',
  'Français;Raccourci;Code;DistinguerGaucheDroite;Description;Commande;Texte;Répertoire;Fenêtre;Programmes;TousProgrammesSauf;Langue;Taille;Colonnes;Tri;Normale;Réduite;Agrandie;Win;Ctrl;Maj;Alt;Gauche;Droite;VerrMaj;VerrNum;ArrêtDéfil;Oui;Non;Utilisations',
  'Deutsch;Verknüpfung;Code;LinksRechtsUnterscheiden;Beschreibung;Befehl;Text;Ordner;Fenster;Programme;AlleProgrammeAber;Sprache;Grösse;Spalte;Sortieren;Normal;Minimiert;Maximiert;Win;Strg;Umschalt;Alt;Links;Rechts;Feststell;Num;Rollen;Ja;Nein;Verwendungszählung',
  'Italiano;Scorciatoia;Codice;DistinguiSinistraDestra;Descrizione;Comando;Testo;Cartella;Finestra;Programmi;TuttiprogrammiEccetto;Lingua;Grandezza;Colonne;Ordinamento;Normale;Ridotta;Ingrandita;Win;Ctrl;Shift;Alt;Sinistra;Destra;CapsLock;NumLock;ScrollLock;Si;No;Usi',
  'Português brasileiro;Atalho;Código;DistinguirEsquerdaDireita;Descrição;Comando;Texto;Pasta;Janela;Programas;TodosProgramasExceto;Idioma;Tamanho;Colunas;Ordenação;Normal;Minimizada;Maximizada;Win;Ctrl;Shift;Alt;Esquerda;Direita;CapsLock;NumLock;ScrollLock;Sim;Não;Usos',
  'Русский;Ярлык;Код;РазличатьЛеваяПравая;Описание;Команда;Текст;Директория;Окно;Программы;ВсехПрограммКроме;Язык;Размер;Столбцы;Сортировка;Нормально;Свернуто;Развернуто;Win;Ctrl;Shift;Alt;Left;Right;CapsLock;NumLock;ScrollLock;Да;Нет;Использований',
  'Ελληνικά;Συντόμευση;Κώδικας;ΔιάκρισηΑριστερούΔεξιού;Περιγραφή;Εντολή;Κείμενο;Κατάλογος;Παράθυρο;Προγράμματα;ΌλαΤαΠρογράμματαΕκτός;Γλώσσα;Μέγεθος;Στήλες;Ταξινόμηση;Κανονικό παράθυρο;Ελαχιστοποιημένο;Μεγιστοποιημένο;Win;Ctrl;Shift;Alt;Αριστερό;Δεξί;CapsLock;NumLock;ScrollLock;Ναι;Όχι;Χρήσεις',
].map((line) => line.split(';'));
const FIELDS = {
  2: 'code', 3: 'sided', 4: 'description', 5: 'command', 6: 'text', 7: 'directory', 9: 'programs',
  10: 'programs', 24: 'condition', 25: 'condition', 26: 'condition', 29: 'usages',
};
// Like Clavier+: the first token index that matches in any language wins.
const FIELD_OF = new Map();
for (let i = 0; i < TOKENS[0].length; i++) {
  for (const lang of TOKENS) {
    const token = lang[i].toLowerCase();
    if (!FIELD_OF.has(token)) FIELD_OF.set(token, FIELDS[i] || 'other');
  }
}

// Windows virtual keys -> physical key names (a US-style layout, as Clavier+ stores them).
const VK = {
  0x08: 'Backspace', 0x09: 'Tab', 0x0d: 'Enter', 0x14: 'CapsLock', 0x1b: 'Escape', 0x20: 'Space',
  0x21: 'PageUp', 0x22: 'PageDown', 0x23: 'End', 0x24: 'Home', 0x25: 'ArrowLeft', 0x26: 'ArrowUp',
  0x27: 'ArrowRight', 0x28: 'ArrowDown', 0x2c: 'PrintScreen', 0x2d: 'Insert', 0x2e: 'Delete',
  0x5d: 'ContextMenu', 0x6a: 'NumpadMultiply', 0x6b: 'NumpadAdd', 0x6d: 'NumpadSubtract',
  0x6e: 'NumpadDecimal', 0x6f: 'NumpadDivide', 0x90: 'NumLock', 0x91: 'ScrollLock',
  0xba: 'Semicolon', 0xbb: 'Equal', 0xbc: 'Comma', 0xbd: 'Minus', 0xbe: 'Period', 0xbf: 'Slash',
  0xc0: 'Backquote', 0xdb: 'BracketLeft', 0xdc: 'Backslash', 0xdd: 'BracketRight', 0xde: 'Quote',
  0xe2: 'IntlBackslash',
};
for (let i = 0; i < 10; i++) {
  VK[0x30 + i] = `Digit${i}`;
  VK[0x60 + i] = `Numpad${i}`;
}
for (let i = 0; i < 26; i++) VK[0x41 + i] = `Key${String.fromCharCode(65 + i)}`;
for (let i = 0; i < 24; i++) VK[0x70 + i] = `F${i + 1}`;
VK[0x0c] = 'Numpad5'; // VK_CLEAR, as Clavier+ itself reads it

const MOD_BITS = [[2, 'Control'], [1, 'Alt'], [4, 'Shift'], [8, 'Meta']];

// Clavier.ini bytes -> text. Clavier+ writes UTF-16 LE with a BOM.
function decode(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString('utf16le');
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return buffer.subarray(3).toString('utf8');
  if (buffer.length > 1 && buffer[1] === 0) return buffer.toString('utf16le');
  return buffer.toString('utf8');
}

// Text -> raw blocks ({ code, sided, text, ... }) in file order.
function parse(content) {
  const blocks = [];
  let block = {};
  let last = null;
  for (const line of content.split(/\r\n|\r|\n/)) {
    if (line.startsWith('-')) {
      blocks.push(block);
      block = {};
      last = null;
      continue;
    }
    if (!line) continue;
    if (line.startsWith('>') && last === 'text') {
      block.text += '\r\n' + line.slice(1);
      continue;
    }
    const name = line.match(/^[^ =]*/)[0];
    const field = FIELD_OF.get(name.toLowerCase());
    last = field || null;
    if (!field) continue;
    const eq = line.indexOf('=');
    const value = eq >= 0 ? line.slice(eq + 1) : '';
    if (field === 'condition') block.conditions = true;
    else if (field === 'code') block.code = block.code || Number.parseInt(value, 10) || 0;
    else if (field !== 'other') block[field] = value;
  }
  if (Object.keys(block).length) blocks.push(block);
  return blocks.filter((b) => b.code);
}

function hotkeyOf(block) {
  const key = VK[block.code & 0xff];
  if (!key || !keys.hasKey(key, 'win')) return null;
  const modCode = Math.floor(block.code / 256);
  const sided = Number.parseInt(block.sided, 10) > 0;
  const left = modCode & 0xffff;
  const right = Math.floor(modCode / 0x10000) & 0xffff;
  const mods = [];
  for (const [bit, name] of MOD_BITS) {
    if (!sided) {
      if ((left | right) & bit) mods.push(name);
      continue;
    }
    if (left & bit) mods.push(`${name}Left`);
    if (right & bit) mods.push(`${name}Right`);
  }
  if (!mods.length && !keys.ALONE_OK.includes(key)) return null;
  return { type: 'hotkey', mods, key };
}

const unescapeText = (s) => s.replace(/\\(.)/gs, '$1');

// Clavier+ text -> plain text. Keystrokes and commands KeyBridge can't do are dropped and named.
function convertText(raw) {
  let out = '';
  const dropped = [];
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === '\n') continue; // part of "\r\n"
    if (c === '\r') {
      out += '\n';
      continue;
    }
    if (c === '\\') {
      if (i + 1 < raw.length) out += raw[++i] === '\r' ? '\n' : raw[i];
      continue;
    }
    if (c !== '[') {
      out += c;
      continue;
    }
    let j = i + 1;
    let escaping = false;
    while (j < raw.length && !(raw[j] === ']' && !escaping)) {
      escaping = !escaping && raw[j] === '\\';
      j++;
    }
    if (j >= raw.length) {
      dropped.push('unfinished');
      break;
    }
    const inside = raw.slice(i + 1, j);
    if (!inside) {
      // "[]": does nothing
    } else if (inside[0] === '[') {
      dropped.push('command');
      j++;
    } else if (inside[0] === '{' && inside.endsWith('}')) {
      dropped.push('special');
    } else if (inside.length >= 2 && inside[0] === '|' && inside.endsWith('|')) {
      out += unescapeText(inside.slice(1, -1)).replace(/\r\n?/g, '\n');
    } else {
      const key = unescapeText(inside).trim().toLowerCase();
      if (key === 'enter' || key === 'return') out += '\n';
      else if (key === 'tab') out += '\t';
      else dropped.push('keystroke');
    }
    i = j;
  }
  return { text: variables.escape(out), dropped };
}

// A Clavier+ command line -> link, file / folder, or program.
function convertCommand(command) {
  const cmd = command.trim();
  if (/^(https?|ftp|mailto):/i.test(cmd)) return { kind: 'link', url: cmd };
  if (/^www\./i.test(cmd)) return { kind: 'link', url: `https://${cmd}` };
  let target = cmd;
  let args = '';
  const quoted = /^"([^"]*)"\s*(.*)$/.exec(cmd);
  const program = /^(.+?\.(?:exe|com|bat|cmd|lnk|msc|ps1|vbs))(?:\s+(.*))?$/i.exec(cmd);
  if (quoted) [, target, args] = quoted;
  else if (program) [, target, args = ''] = program;
  const isProgram = /\.(exe|com|bat|cmd|lnk|msc|ps1|vbs)$/i.test(target);
  if (isProgram) return { kind: 'program', path: { win: target, mac: '' }, args: args.trim() };
  return { kind: 'file', path: { win: target, mac: '' }, warn: args ? ['arguments'] : [] };
}

// Clavier.ini bytes -> { items, skipped, warnings }. `items` are store fields, in file order.
// skipped: [{ n, reason }], warnings: [{ n, codes }] with n counted from 1.
function read(buffer) {
  const items = [];
  const skipped = [];
  const warnings = [];
  parse(decode(buffer)).forEach((block, i) => {
    const n = i + 1;
    const trigger = hotkeyOf(block);
    if (!trigger) {
      skipped.push({ n, reason: 'key' });
      return;
    }
    const codes = [];
    const item = { trigger, name: block.description || '', usages: Number.parseInt(block.usages, 10) || 0, enabled: true, platforms: 'all' };
    if (block.text !== undefined && block.command === undefined) {
      const { text, dropped } = convertText(block.text);
      Object.assign(item, { kind: 'text', text });
      if (dropped.length) codes.push(...new Set(dropped.map((d) => `text-${d}`)));
    } else if (block.command) {
      const { warn = [], ...target } = convertCommand(block.command);
      Object.assign(item, target);
      if (target.kind !== 'link') item.platforms = 'win';
      if (block.directory) codes.push('directory');
      codes.push(...warn);
    } else {
      skipped.push({ n, reason: 'empty' });
      return;
    }
    // Limited to some programs, or to Caps Lock on/off: KeyBridge can't, so it comes in switched off.
    if (block.programs) codes.push('programs');
    if (block.conditions) codes.push('condition');
    if (codes.some((c) => c !== 'directory')) item.enabled = false;
    if (codes.length) warnings.push({ n, codes });
    items.push(item);
  });
  return { items, skipped, warnings };
}

function readFile(file = DEFAULT_PATH) {
  return read(fs.readFileSync(file));
}

const exists = (file = DEFAULT_PATH) => fs.existsSync(file);

module.exports = { DEFAULT_PATH, decode, parse, hotkeyOf, convertText, convertCommand, read, readFile, exists };
