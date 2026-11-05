'use strict';
// Shared bits for the tests: a temp data folder, a clock the test moves, and Clavier.ini files.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../src/main/store');

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'keybridge-'));

function clock(start = Date.UTC(2026, 10, 5, 12)) {
  const c = { at: start, now: () => c.at, days: (n) => (c.at += n * 24 * 3600 * 1000) };
  return c;
}

function makeStore(opts = {}) {
  const dir = opts.dir || tmpDir();
  const c = opts.clock || clock();
  const store = new Store(dir, { deviceId: opts.deviceId || 'pc-1', now: c.now });
  store.load();
  return { store, dir, clock: c };
}

// Blocks of Clavier.ini lines -> the bytes Clavier+ writes (UTF-16 LE with a BOM, CRLF).
function clavierIni(blocks, header = ['Language=English', 'Size=637,439,0,0', 'Columns=35,20,15,10', 'Sorting=0', '']) {
  const lines = [...header];
  for (const block of blocks) lines.push(...block, '-');
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(lines.join('\r\n') + '\r\n', 'utf16le')]);
}

module.exports = { tmpDir, clock, makeStore, clavierIni };
