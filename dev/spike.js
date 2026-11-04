// M1 keyboard spike: starts the Rust helper and wires a few demo shortcuts, the way the app will.
// Open Notepad or TextEdit and try them. Left Shift + the same letter stays a plain capital letter.
// Nothing here sees or logs your typing - the helper only reports which shortcut fired.
//
//   cargo build --release --manifest-path native/Cargo.toml
//   node dev/spike.js
//
// The letters are ones the current Clavier+ setup doesn't use on either side, so both can run.
// On the Mac the first run asks for the Accessibility permission (for the app you run this from).

const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

const mac = process.platform === 'darwin';
const exe = path.join(__dirname, '..', 'native', 'target', 'release',
  process.platform === 'win32' ? 'keybridge-helper.exe' : 'keybridge-helper');

const RIGHT_CTRL = mac ? 'Right Control + 1' : 'Right Ctrl + 1';
const RIGHT_ALT = mac ? 'Right Option + Q' : 'Right Alt + Q';
const RIGHT_META = mac ? 'Right Cmd + 1' : 'Right Win + 1';

const SHORTCUTS = [
  { id: 'address', label: 'Right Shift + D', mods: ['ShiftRight'], key: 'KeyD',
    action: 'type', text: '12 Example Street, Tel Aviv' },
  { id: 'hebrew', label: 'Right Shift + E', mods: ['ShiftRight'], key: 'KeyE',
    action: 'type', text: 'שלום! הטקסט הזה הוקלד על ידי KeyBridge' },
  { id: 'signature', label: 'Right Shift + T', mods: ['ShiftRight'], key: 'KeyT',
    action: 'paste', text: 'Best regards,\nShachar\nAI World by Shachar - small tools for everyday work' },
  { id: 'right-ctrl', label: RIGHT_CTRL, mods: ['ControlRight'], key: 'Digit1',
    action: 'type', text: `${RIGHT_CTRL} works` },
  { id: 'right-alt', label: RIGHT_ALT, mods: ['AltRight'], key: 'KeyQ',
    action: 'type', text: `${RIGHT_ALT} works` },
  { id: 'right-meta', label: RIGHT_META, mods: ['MetaRight'], key: 'Digit1',
    action: 'type', text: `${RIGHT_META} works` },
];

const helper = spawn(exe, [], { stdio: ['pipe', 'pipe', 'inherit'] });
const send = (cmd) => helper.stdin.write(JSON.stringify(cmd) + '\n');

helper.on('error', (e) => {
  console.error(`Could not start ${exe}: ${e.message}\nBuild it first: cargo build --release --manifest-path native/Cargo.toml`);
  process.exit(1);
});
helper.on('exit', (code) => {
  console.log(`helper stopped (${code})`);
  process.exit(code || 0);
});

readline.createInterface({ input: helper.stdout }).on('line', (line) => {
  let ev;
  try { ev = JSON.parse(line); } catch { return console.log('?', line); }

  if (ev.event === 'ready') {
    console.log(`helper ${ev.version} ready on ${ev.platform}`);
    send({ cmd: 'setHotkeys', hotkeys: SHORTCUTS.map(({ id, mods, key }) => ({ id, mods, key })) });
    send({ cmd: 'layout' });
  } else if (ev.event === 'hotkeysSet') {
    console.log(`\n${ev.count} shortcuts on${ev.skipped.length ? ` (skipped: ${ev.skipped.join(', ')})` : ''}:`);
    for (const s of SHORTCUTS) console.log(`  ${s.label.padEnd(16)} ${s.action === 'paste' ? 'pastes' : 'types'} "${s.text.split('\n')[0]}"`);
    console.log('\nPress P + Enter here to pause or resume, Q + Enter to quit.\n');
  } else if (ev.event === 'layout') {
    console.log(`keyboard layout in front: ${ev.locale} (${ev.langId || ev.source})`);
  } else if (ev.event === 'permission') {
    console.log(ev.accessibility
      ? 'Accessibility allowed - shortcuts are on.'
      : 'Allow this app in System Settings > Privacy & Security > Accessibility, then come back.');
  } else if (ev.event === 'hotkey') {
    const s = SHORTCUTS.find((x) => x.id === ev.id);
    if (!s) return;
    console.log(`fired: ${s.label}`);
    send({ cmd: s.action, text: s.text });
  } else if (ev.event === 'error') {
    console.log(`error${ev.cmd ? ` (${ev.cmd})` : ''}: ${ev.message}`);
  }
});

let paused = false;
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const c = line.trim().toLowerCase();
  if (c === 'p') {
    paused = !paused;
    send({ cmd: 'pause', paused });
    console.log(paused ? 'paused' : 'resumed');
  } else if (c === 'q') {
    send({ cmd: 'quit' });
  }
});
process.on('SIGINT', () => send({ cmd: 'quit' }));
