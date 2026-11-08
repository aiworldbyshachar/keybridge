'use strict';
// The small secrets of this computer - the cloud session and the account code - in secrets.json,
// a file only this user may read. On Windows the app also seals them with the system's secure
// storage (Electron safeStorage: `encrypt` / `decrypt`). The Mac app and the dev CLI keep them as
// plain text in that file (main.js says why).
const fs = require('fs');
const path = require('path');

class Secrets {
  constructor(dir, { encrypt = null, decrypt = null } = {}) {
    this.file = path.join(dir, 'secrets.json');
    this.encrypt = encrypt;
    this.decrypt = decrypt;
  }

  _all() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return {};
    }
  }

  get(name) {
    const stored = this._all()[name];
    if (stored == null) return null;
    try {
      return JSON.parse(this.decrypt ? this.decrypt(Buffer.from(stored, 'base64')) : stored);
    } catch {
      return null;
    }
  }

  set(name, value) {
    const all = this._all();
    const text = JSON.stringify(value);
    all[name] = this.encrypt ? Buffer.from(this.encrypt(text)).toString('base64') : text;
    this._write(all);
  }

  delete(name) {
    const all = this._all();
    if (!(name in all)) return;
    delete all[name];
    this._write(all);
  }

  _write(all) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(all), { mode: 0o600 });
    fs.renameSync(this.file + '.tmp', this.file);
  }
}

module.exports = { Secrets };
