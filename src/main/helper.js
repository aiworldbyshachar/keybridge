'use strict';
// The keyboard helper process (native/): starts it, talks JSON lines with it, and starts it again
// if it stops unexpectedly. See native/src/main.rs for the commands and events.
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

const EXE = process.platform === 'win32' ? 'keybridge-helper.exe' : 'keybridge-helper';
const MAX_RESTARTS = 5; // a minute; then it gives up and says so

// Next to the app when packaged, in native/target when developing.
function helperPath() {
  const packaged = process.resourcesPath && path.join(process.resourcesPath, EXE);
  if (packaged && fs.existsSync(packaged)) return packaged;
  return path.join(__dirname, '..', '..', 'native', 'target', 'release', EXE);
}

class Helper extends EventEmitter {
  constructor({ exe = helperPath(), log = () => {} } = {}) {
    super();
    this.exe = exe;
    this.log = log;
    this.child = null;
    this.stopped = true;
    this.restarts = [];
  }

  start() {
    this.stopped = false;
    const child = spawn(this.exe, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.child = child;
    child.on('error', (err) => {
      // e.g. the file is missing: starting again won't help
      this.stopped = true;
      this.child = null;
      this.emit('problem', err);
    });
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      let ev;
      try {
        ev = JSON.parse(line);
      } catch {
        return;
      }
      this.emit('event', ev);
    });
    readline.createInterface({ input: child.stderr }).on('line', (line) => this.log(`helper: ${line}`));
    child.on('exit', (code) => {
      if (this.child === child) this.child = null;
      this.emit('exit', code);
      if (!this.stopped) this._restart();
    });
  }

  _restart() {
    const now = Date.now();
    this.restarts = this.restarts.filter((t) => now - t < 60000);
    if (this.restarts.length >= MAX_RESTARTS) {
      this.stopped = true;
      this.emit('problem', new Error('the keyboard helper keeps stopping'));
      return;
    }
    this.restarts.push(now);
    setTimeout(() => {
      if (!this.stopped) this.start();
    }, 500 * this.restarts.length).unref();
  }

  get running() {
    return !!this.child;
  }

  send(cmd) {
    if (this.child && this.child.stdin.writable) this.child.stdin.write(JSON.stringify(cmd) + '\n');
  }

  stop() {
    this.stopped = true;
    const child = this.child;
    if (!child) return;
    this.send({ cmd: 'quit' });
    child.stdin.end();
    setTimeout(() => {
      if (child.exitCode === null) child.kill();
    }, 1000).unref();
  }
}

module.exports = { Helper, helperPath };
