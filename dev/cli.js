'use strict';
// KeyBridge without the app window: the store, the engine and the keyboard helper, from the
// terminal. Used to try the engine before the Electron shell exists (M4).
//
//   npm run helper              build the keyboard helper first (once, and after it changes)
//   node dev/cli.js             your shortcuts, in the dev data folder
//   node dev/cli.js --data <folder> --helper <path to keybridge-helper>
//
// On the first run on Windows it offers to bring in your Clavier+ shortcuts. Type "help" for
// commands. Nothing here sees or logs your typing: the helper only says which shortcut fired.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { execFile, execFileSync } = require('child_process');
const { Store } = require('../src/main/store');
const { Engine } = require('../src/main/engine');
const { Helper, helperPath } = require('../src/main/helper');
const { opener } = require('../src/main/opener');
const triggers = require('../src/main/triggers');
const clavier = require('../src/main/clavier');
const backup = require('../src/main/backup');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    out[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return out;
}

function appDataDir(name) {
  if (process.platform === 'win32') return path.join(process.env.APPDATA || os.homedir(), name);
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', name);
  return path.join(os.homedir(), '.config', name);
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log('Usage: node dev/cli.js [--data <folder>] [--helper <path>]');
  process.exit(0);
}
const dataDir = path.resolve(args.data || appDataDir('KeyBridge-dev'));
const platform = triggers.currentPlatform();

// This computer's id, kept with the settings the app will use.
function deviceId() {
  const file = path.join(dataDir, 'settings.json');
  let settings = {};
  try {
    settings = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {}
  if (!settings.deviceId) {
    settings.deviceId = crypto.randomUUID();
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(settings, null, 2));
  }
  return settings.deviceId;
}

function readClipboard() {
  return new Promise((resolve) => {
    const [cmd, cmdArgs] = process.platform === 'win32' ? ['powershell.exe', ['-NoProfile', '-Command', 'Get-Clipboard -Raw']] : ['pbpaste', []];
    execFile(cmd, cmdArgs, { encoding: 'utf8', windowsHide: true }, (err, out) => resolve(err ? '' : out.replace(/\r?\n$/, '')));
  });
}

function clavierRunning() {
  if (process.platform !== 'win32') return false;
  try {
    return /clavier/i.test(execFileSync('tasklist', ['/FI', 'IMAGENAME eq Clavier.exe', '/NH'], { encoding: 'utf8', windowsHide: true }));
  } catch {
    return false;
  }
}

const store = new Store(dataDir, { deviceId: deviceId() });
store.load();
const helper = new Helper({ exe: args.helper ? path.resolve(args.helper) : helperPath(), log: (line) => console.log(line) });
const locale = Intl.DateTimeFormat().resolvedOptions().locale;
const engine = new Engine({ store, helper, opener, platform, locale, readClipboard });

const say = (line) => console.log(line);
const labelOf = (s) => triggers.label(s.trigger, platform) || '(no trigger)';
const preview = (s) => {
  const text = s.kind === 'text' ? s.text : s.kind === 'link' ? s.url : s.path[platform] || s.path.win || s.path.mac;
  const one = text.replace(/\n/g, ' ⏎ ');
  return one.length > 50 ? `${one.slice(0, 49)}…` : one;
};

function list() {
  const all = store.shortcuts();
  if (!all.length) return say('No shortcuts yet. "import" brings in Clavier+, "add" makes one.');
  all.forEach((s, i) => {
    const group = s.groupId && store.group(s.groupId);
    const flags = [store.isActive(s, platform) ? '' : 'off', engine.triggers.conflicts.has(s.id) ? 'clash' : '', group ? group.name : ''].filter(Boolean);
    say(`${String(i + 1).padStart(3)}  ${labelOf(s).padEnd(26)} ${s.kind.padEnd(7)} ${preview(s)}${flags.length ? `  [${flags.join(', ')}]` : ''}`);
  });
}

function importClavier(file = clavier.DEFAULT_PATH) {
  const { items, skipped, warnings } = clavier.readFile(file);
  const r = backup.addImported(store, items, 'Clavier+');
  say(`Clavier+: ${r.added} added${r.existing ? `, ${r.existing} already here` : ''}${skipped.length ? `, ${skipped.length} skipped (keys KeyBridge can't catch)` : ''}.`);
  for (const w of warnings) say(`  shortcut ${w.n}: brought in switched off (${w.codes.join(', ')}) - check it, then "on" it`);
}

// "ShiftRight+KeyA" or ";abbr"
function parseTrigger(spec) {
  if (!spec.includes('+')) return { type: 'abbrev', text: spec };
  const parts = spec.split('+');
  return { type: 'hotkey', key: parts.pop(), mods: parts };
}

const byNumber = (n) => store.shortcuts()[Number(n) - 1] || null;

const HELP = `Commands:
  list                     your shortcuts (also "l")
  import                   bring in Clavier+ (on Windows), or: import <file.ini | backup.json>
  export <file.json>       save everything to a file
  add <trigger> <text>     e.g.  add ShiftRight+KeyQ Hello   or   add ;sig Best regards,\\nShachar
  on <n> / off <n>         switch a shortcut on or off
  rm <n>                   delete (goes to the trash)
  trash / restore <n>      the trash, and bringing something back
  p                        pause or resume all shortcuts
  q                        quit`;

function command(line) {
  const [cmd, ...rest] = line.trim().split(/\s+/);
  const arg = line.trim().slice((cmd || '').length).trim();
  try {
    switch ((cmd || '').toLowerCase()) {
      case '':
        return;
      case 'l':
      case 'list':
        return list();
      case 'import': {
        if (!arg) return clavier.exists() ? importClavier() : say('No Clavier+ settings found. Try: import <file>');
        if (/\.ini$/i.test(arg)) return importClavier(path.resolve(arg));
        const r = backup.importData(store, JSON.parse(fs.readFileSync(path.resolve(arg), 'utf8')));
        return say(`Imported: ${r.added} added, ${r.replaced} replaced (old versions in the trash), ${r.same} unchanged.`);
      }
      case 'export': {
        if (!arg) return say('export <file.json>');
        fs.writeFileSync(path.resolve(arg), JSON.stringify(backup.exportData(store), null, 2));
        return say(`Saved ${store.shortcuts().length} shortcuts to ${path.resolve(arg)}`);
      }
      case 'add': {
        const [spec, ...words] = rest;
        if (!spec || !words.length) return say('add <trigger> <text>');
        const s = store.add({ kind: 'text', trigger: parseTrigger(spec), text: words.join(' ').replace(/\\n/g, '\n') });
        return say(`Added: ${labelOf(s)}`);
      }
      case 'on':
      case 'off': {
        const s = byNumber(arg);
        if (!s) return say('No shortcut with that number - "list" shows them.');
        store.update(s.id, { enabled: cmd.toLowerCase() === 'on' });
        return say(`${labelOf(s)} is ${cmd.toLowerCase()}.`);
      }
      case 'rm': {
        const s = byNumber(arg);
        if (!s) return say('No shortcut with that number - "list" shows them.');
        store.remove(s.id);
        return say(`${labelOf(s)} moved to the trash (30 days).`);
      }
      case 'trash': {
        const items = store.trash();
        if (!items.length) return say('The trash is empty.');
        return items.forEach((t, i) => {
          const what = t.group ? `group "${t.group.name}" (${t.shortcuts.length} shortcuts)` : `${labelOf(t.shortcut)}  ${preview(t.shortcut)}`;
          say(`${String(i + 1).padStart(3)}  ${new Date(t.at).toLocaleString(locale)}  ${t.reason.padEnd(9)} ${what}`);
        });
      }
      case 'restore': {
        const t = store.trash()[Number(arg) - 1];
        if (!t) return say('No trash item with that number - "trash" shows them.');
        store.restore(t.id);
        return say('Restored.');
      }
      case 'p':
        engine.setPaused(!engine.paused);
        return say(engine.paused ? 'Paused: no shortcuts until you resume.' : 'Resumed.');
      case 'q':
      case 'quit':
        helper.stop();
        return setTimeout(() => process.exit(0), 300);
      case 'help':
        return say(HELP);
      default:
        return say('Unknown command - "help" lists them.');
    }
  } catch (err) {
    say(`Can't do that: ${err.code || err.message}`);
  }
}

engine.on('ready', (ev) => {
  say(`Keyboard helper ${ev.version || ''} ready on ${ev.platform || platform}. ${store.active(platform).length} shortcuts on.`);
});
// Notes about clashes and triggers that can't work, each said once.
const noted = new Set();
const note = (line) => {
  if (!noted.has(line)) say(line);
  noted.add(line);
};
engine.on('triggers', (t) => {
  const owners = new Set(t.hotkeys.concat(t.abbrevs).map((h) => h.id));
  for (const [id, others] of t.conflicts) {
    const s = store.get(id);
    if (s && owners.has(id)) note(`Note: ${labelOf(s)} is also on ${others.size} other shortcut(s) - only the first in the list works.`);
  }
  for (const bad of t.invalid) {
    const s = store.get(bad.id);
    if (s) note(`Note: ${labelOf(s)} can't work on this computer (${bad.reason}).`);
  }
});
engine.on('fired', ({ id }) => {
  const s = store.get(id);
  if (s) say(`fired: ${labelOf(s)}`);
});
engine.on('problem', (err) => say(`Problem: ${err.message}`));
engine.on('skipped', (ids) => say(`The helper skipped ${ids.length} trigger(s) it doesn't know.`));
engine.on('permission', (allowed) =>
  say(allowed ? 'Accessibility allowed - shortcuts are on.' : 'Allow this app in System Settings > Privacy & Security > Accessibility, then come back.'),
);
helper.on('problem', (err) => {
  say(`The keyboard helper isn't running: ${err.message}`);
  say('Build it with "npm run helper", then start this again.');
});

engine.start();
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function begin() {
  say(`KeyBridge (dev) - data in ${dataDir}`);
  if (clavierRunning()) say('Clavier+ is running too. KeyBridge answers first, but to be sure, quit Clavier+ while you try this.');
  helper.start();
  say('Type "help" for commands. Open Notepad or TextEdit and try your shortcuts.\n');
  rl.on('line', command);
}

if (!store.shortcuts().length && clavier.exists()) {
  const n = clavier.readFile().items.length;
  rl.question(`Bring in your ${n} Clavier+ shortcuts? (y/n) `, (answer) => {
    if (/^y/i.test(answer.trim())) importClavier();
    begin();
  });
} else {
  begin();
}
process.on('SIGINT', () => command('q'));
