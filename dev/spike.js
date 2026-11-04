// M1 keyboard spike: starts the Rust helper and wires a few demo shortcuts, the way the app will.
// Open Notepad and try them. Left Shift + the same letter stays a plain capital letter.
// Nothing here sees or logs your typing - the helper only reports which shortcut fired.
//
//   cargo build --release --manifest-path native/Cargo.toml
//   node dev/spike.js
//
// The letters are ones the current Clavier+ setup doesn't use on either side, so both can run.

const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

const exe = path.join(__dirname, '..', 'native', 'target', 'release',
  process.platform === 'win32' ? 'keybridge-helper.exe' : 'keybridge-helper');

const SHORTCUTS = [
  { id: 'address', label: 'Right Shift + D', mods: ['ShiftRight'], key: 'KeyD',
    action: 'type', text: '12 Example Street, Tel Aviv' },
  { id: 'hebrew', label: 'Right Shift + E', mods: ['ShiftRight'], key: 'KeyE',
    action: 'type', text: 'שלום! הטקסט הזה הוקלד על ידי KeyBridge' },
  { id: 'signature', label: 'Right Shift + T', mods: ['ShiftRight'], key: 'KeyT',
    action: 'paste', text: 'Best regards,\nShachar\nAI World by Shachar - small tools for everyday work' },
  { id: 'right-ctrl', label: 'Right Ctrl + 1', mods: ['ControlRight'], key: 'Digit1',
    action: 'type', text: 'Right Ctrl + 1 works, Left Ctrl + 1 is untouched' },
  { id: 'right-alt', label: 'Right Alt + Q', mods: ['AltRight'], key: 'KeyQ',
    action: 'type', text: 'Right Alt + Q works' },
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
    console.log(`keyboard layout in front: ${ev.locale} (${ev.langId})`);
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
