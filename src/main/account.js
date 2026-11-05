'use strict';
// Being signed in on this computer: the session, the account code, the sync and when it runs.
//
//   signed-out --signIn(email)--> waiting-for-link --link opened-->
//     the account's first computer: a new code is made and shown once (event 'code') --> ready
//     the account already has a code: needs-code --enterCode(code)--> ready
//   ready: syncs now, a moment after each change here, when the cloud nudges, and every few
//   minutes; this computer shows in the devices list.
//
// Without the project settings (no .env) or without signing in, KeyBridge works on this computer
// only - nothing here is needed for the shortcuts themselves.
const os = require('os');
const { EventEmitter } = require('events');
const { Cloud } = require('./cloud');
const { waitForLink } = require('./signin');
const { Realtime } = require('./realtime');
const { Sync } = require('./sync');
const vault = require('./vault');
const { generateCode, formatCode, isValidCode } = require('./code');

const QUIET = 2000; // a change here syncs after this pause
const EVERY = 5 * 60 * 1000;
const DEVICE_EVERY = 30 * 60 * 1000;
const SESSION_CHECK = 60 * 1000;

class AccountError extends Error {
  constructor(code) {
    super(`account: ${code}`);
    this.code = code;
  }
}

class Account extends EventEmitter {
  constructor({ dir, url, key, store, deviceId, platform, secrets, deviceName = os.hostname(), fetch, WebSocketImpl, waitForLinkImpl = waitForLink, now = Date.now }) {
    super();
    Object.assign(this, { dir, url, key, store, deviceId, platform, secrets, deviceName, waitForLinkImpl, now });
    this.state = url && key ? 'signed-out' : 'unconfigured';
    this.code = '';
    this.sync = null;
    this.lastSync = 0;
    this.offline = false;
    this.timers = {};
    if (this.state === 'unconfigured') return;
    this.cloud = new Cloud({ url, key, fetch, now });
    this.realtime = new Realtime({ url, key, cloud: this.cloud, WebSocketImpl });
    this.cloud.on('session', (s) => {
      this.secrets.set('session', s);
      this.realtime.updateToken(s.access_token);
    });
    // the session ended elsewhere: signed out from another computer, or the account deleted
    this.cloud.on('signed-out', () => {
      if (this.state !== 'signed-out' && !this.leaving) this._endHere('remote');
    });
    this.realtime.on('nudge', () => this.syncSoon(200));
    this.realtime.on('connected', () => this.syncSoon(200));
    this.onStoreChange = (c) => {
      if (c.type !== 'remote') this.syncSoon(QUIET);
    };
  }

  _setState(state) {
    this.state = state;
    this.emit('state', this.status());
  }

  status() {
    const email = (this.cloud && this.cloud.email) || this.pendingEmail || '';
    return { state: this.state, email, lastSync: this.lastSync, offline: this.offline };
  }

  // On start: back to where this computer was. With a stored session and code it's ready at once,
  // even offline; with a session but no code it asks for the code.
  async start() {
    if (this.state === 'unconfigured') return;
    const session = this.secrets.get('session');
    if (!session) return this._setState('signed-out');
    this.cloud.session = session;
    const code = this.secrets.get('code');
    if (code) return this._ready(code);
    try {
      await this._afterSignIn();
    } catch (err) {
      this.emit('problem', err);
    }
  }

  // Sends the email and waits for its link to be opened on this computer.
  async signIn(email) {
    if (this.state === 'unconfigured') throw new AccountError('not-configured');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) throw new AccountError('bad-email');
    const link = await this.waitForLinkImpl(); // listening before the email goes out
    let verifier;
    try {
      verifier = await this.cloud.sendLink(email);
    } catch (err) {
      link.close();
      throw err;
    }
    this.pendingLink = link;
    this.pendingEmail = String(email).trim();
    this._setState('waiting-for-link');
    try {
      await this.cloud.finishSignIn(await link.code, verifier);
    } catch (err) {
      this._setState('signed-out');
      throw err;
    } finally {
      this.pendingLink = null;
      this.pendingEmail = '';
    }
    await this._afterSignIn();
  }

  cancelSignIn() {
    if (this.pendingLink) this.pendingLink.close();
  }

  async _afterSignIn() {
    const profile = await this.cloud.profile();
    if (profile && profile.key_check) {
      this.keyCheck = profile.key_check;
      return this._setState('needs-code');
    }
    // this is the account's first computer: it makes the code
    const code = generateCode();
    const key = await vault.deriveKey(code);
    if (!(await this.cloud.setKeyCheck(vault.makeCheck(key)))) return this._afterSignIn(); // another computer was quicker
    this.emit('code', code);
    return this._ready(code, key);
  }

  // The code typed on a new computer.
  async enterCode(code) {
    if (this.state !== 'needs-code') throw new AccountError('not-asking');
    if (!isValidCode(code)) throw new AccountError('bad-code');
    const key = await vault.deriveKey(code);
    if (!vault.checkMatches(key, this.keyCheck)) throw new AccountError('wrong-code');
    return this._ready(code, key);
  }

  async _ready(code, key) {
    this.code = formatCode(code);
    this.key = key || (await vault.deriveKey(code));
    this.secrets.set('code', this.code);
    this.sync = new Sync({ store: this.store, backend: this.cloud.backend(), key: this.key, deviceId: this.deviceId, dir: this.dir });
    this.sync.load(this.cloud.userId);
    this.store.on('change', this.onStoreChange);
    this.timers.every = setInterval(() => this.syncSoon(0), EVERY);
    this.timers.device = setInterval(() => this._saveDevice(), DEVICE_EVERY);
    this.timers.session = setInterval(() => this._checkSession(), SESSION_CHECK);
    for (const t of [this.timers.every, this.timers.device, this.timers.session]) if (t.unref) t.unref();
    this._setState('ready');
    this.realtime.start();
    this._saveDevice();
    return this.syncNow();
  }

  syncSoon(wait = QUIET) {
    if (this.state !== 'ready') return;
    clearTimeout(this.timers.soon);
    this.timers.soon = setTimeout(() => this.syncNow(), wait);
    if (this.timers.soon.unref) this.timers.soon.unref();
  }

  async syncNow() {
    if (this.state !== 'ready') return null;
    try {
      // signed out from another computer, or the account deleted: notice within a minute
      if (this.now() - (this.sessionChecked || 0) > SESSION_CHECK) {
        await this.cloud.checkSession();
        this.sessionChecked = this.now();
      }
      if (this.state !== 'ready') return null;
      const result = await this.sync.run();
      this.lastSync = this.now();
      this.offline = false;
      this.emit('synced', result);
      return result;
    } catch (err) {
      this.offline = err.code === 'offline';
      this.emit('sync-failed', err);
      return null;
    }
  }

  // Ended elsewhere? The cloud's 'signed-out' event then signs this computer out (see constructor).
  async _checkSession() {
    if (this.state !== 'ready') return;
    try {
      await this.cloud.checkSession();
      this.sessionChecked = this.now();
    } catch {}
  }

  async _saveDevice() {
    try {
      await this.cloud.saveDevice({ id: this.deviceId, name: vault.seal(this.key, `device:${this.deviceId}`, this.deviceName), platform: this.platform });
    } catch {}
  }

  // [{ id, name, platform, lastSeen, here }]
  async devices() {
    const rows = (await this.cloud.devices()) || [];
    return rows.map((d) => {
      let name = '';
      try {
        name = vault.open(this.key, `device:${d.id}`, d.name);
      } catch {}
      return { id: d.id, name, platform: d.platform, lastSeen: Date.parse(d.last_seen), here: d.id === this.deviceId };
    });
  }

  async signOutDevice(id) {
    if (id === this.deviceId) return this.signOut();
    await this.cloud.signOutDevice(id);
  }

  // The shortcuts stay on this computer; the session, the code and the sync memory go.
  async signOut() {
    this.leaving = true;
    await this.cloud.signOut();
    this._endHere('signed-out');
  }

  async deleteAccount() {
    this.leaving = true;
    try {
      await this.cloud.deleteAccount();
    } catch (err) {
      this.leaving = false;
      throw err;
    }
    this._endHere('deleted');
  }

  _endHere(why) {
    this.leaving = false;
    this.store.off('change', this.onStoreChange);
    for (const t of Object.values(this.timers)) clearTimeout(t);
    this.timers = {};
    this.realtime.stop();
    if (this.sync) this.sync.forget();
    this.sync = null;
    this.code = '';
    this.key = null;
    this.secrets.delete('session');
    this.secrets.delete('code');
    this.cloud.session = null;
    this._setState('signed-out');
    if (why !== 'signed-out') this.emit('ended', why);
  }

  stop() {
    for (const t of Object.values(this.timers)) clearTimeout(t);
    if (this.realtime) this.realtime.stop();
  }
}

module.exports = { Account, AccountError };
