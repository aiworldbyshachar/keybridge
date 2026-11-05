'use strict';
// Opening links, files, folders and programs for "open" shortcuts. Plain child processes, so it
// works in the CLI too; the app may hand in Electron's shell instead.
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

// "%USERPROFILE%\Documents" and "~/Documents" -> real paths.
function expandPath(p, platform = process.platform) {
  if (platform === 'win32') return p.replace(/%([^%]+)%/g, (m, name) => process.env[name] ?? m);
  return p.replace(/^~(?=\/|$)/, os.homedir());
}

// 'a "b c" d' -> ['a', 'b c', 'd']
function splitArgs(args) {
  const out = [];
  for (const m of String(args || '').matchAll(/"([^"]*)"|(\S+)/g)) out.push(m[1] ?? m[2]);
  return out;
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', ...opts });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

const win = process.platform === 'win32';

const opener = {
  openUrl(url) {
    if (/^\s*(javascript|data|vbscript):/i.test(url)) return Promise.reject(new Error('this kind of link is not opened'));
    return win ? run('rundll32.exe', ['url.dll,FileProtocolHandler', url]) : run('open', [url]);
  },

  openPath(p) {
    const real = expandPath(p);
    return win ? run('explorer.exe', [real]) : run('open', [real]);
  },

  launch(p, args) {
    const real = expandPath(p);
    const list = splitArgs(args);
    if (win) {
      if (/\.exe$/i.test(real)) return run(real, list, { cwd: path.dirname(real) });
      return run('explorer.exe', [real]); // shortcuts (.lnk), scripts: what a double-click does
    }
    if (/\.app\/?$/.test(real)) return run('open', ['-a', real, ...(list.length ? ['--args', ...list] : [])]);
    return run(real, list);
  },
};

module.exports = { opener, expandPath, splitArgs };
