'use strict';
// Settings of this computer, in settings.json in the app's data folder. (The shortcuts themselves
// are in shortcuts.json, see store.js.)
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const DEFAULTS = {
  language: '', // '' until the first run picks one from the system
  deviceId: '',
  deviceName: '',
  openAtLogin: true,
  paused: false,
  onboarded: false, // the first-run steps were seen
};

function defaultDeviceName() {
  const host = os.hostname().replace(/\.local$/i, '').trim();
  return host || (process.platform === 'darwin' ? 'Mac' : 'PC');
}

class Settings {
  constructor(dir) {
    this.file = path.join(dir, 'settings.json');
    this.data = { ...DEFAULTS };
    this.isFirstRun = false;
  }

  load() {
    let saved = null;
    try {
      saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      this.isFirstRun = true;
    }
    this.data = { ...DEFAULTS, ...(saved || {}) };
    if (!this.data.deviceId) this.data.deviceId = crypto.randomUUID();
    if (!this.data.deviceName) this.data.deviceName = defaultDeviceName();
    this.save();
  }

  get(key) {
    return this.data[key];
  }

  set(patch) {
    Object.assign(this.data, patch);
    this.save();
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    try {
      fs.renameSync(tmp, this.file);
    } catch {
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    }
  }
}

module.exports = { Settings, DEFAULTS };
