'use strict';
// The engine: keeps the helper's hotkeys and abbreviations in step with the store, and runs a
// shortcut when the helper says its trigger fired. The helper never tells it what was typed,
// only which shortcut fired.
const { EventEmitter } = require('events');
const triggers = require('./triggers');
const variables = require('./variables');

// Longer text is pasted (faster, and the clipboard comes back after); shorter text is typed.
const PASTE_OVER = 200;
const insertMode = (text) => (text.length > PASTE_OVER || /[\r\n]/.test(text) ? 'paste' : 'type');

class Engine extends EventEmitter {
  constructor({ store, helper, opener, platform = triggers.currentPlatform(), locale = 'en', readClipboard = async () => '', now = () => new Date() }) {
    super();
    Object.assign(this, { store, helper, opener, platform, locale, readClipboard, now });
    this.paused = false;
    this.triggers = { hotkeys: [], abbrevs: [], conflicts: new Map(), invalid: [] };
    this.pushPending = false;
  }

  start() {
    this.helper.on('event', (ev) => this._event(ev));
    this.store.on('change', () => this._schedulePush());
  }

  setPaused(paused) {
    this.paused = !!paused;
    this.helper.send({ cmd: 'pause', paused: this.paused });
    this.emit('paused', this.paused);
  }

  // Many changes in a row (an import) make one push.
  _schedulePush() {
    if (this.pushPending) return;
    this.pushPending = true;
    setImmediate(() => {
      this.pushPending = false;
      this.push();
    });
  }

  push() {
    const t = triggers.forHelper(this.store.active(this.platform), this.platform);
    this.triggers = t;
    this.helper.send({ cmd: 'setHotkeys', hotkeys: t.hotkeys });
    this.helper.send({ cmd: 'setAbbrevs', abbrevs: t.abbrevs.map(({ id, keys, word }) => ({ id, keys, word })) });
    this.emit('triggers', t);
  }

  _event(ev) {
    const fail = (err) => this.emit('problem', err);
    switch (ev.event) {
      case 'ready':
        this.push();
        if (this.paused) this.helper.send({ cmd: 'pause', paused: true });
        this.emit('ready', ev);
        break;
      case 'hotkey':
        this.fire(ev.id).catch(fail);
        break;
      case 'abbrev':
        this.fire(ev.id, { erase: ev.erase, end: ev.end }).catch(fail);
        break;
      case 'permission':
        this.emit('permission', ev.accessibility);
        break;
      case 'hotkeysSet':
      case 'abbrevsSet':
        if (ev.skipped && ev.skipped.length) this.emit('skipped', ev.skipped);
        break;
      case 'error':
        fail(new Error(ev.message));
        break;
    }
  }

  // Runs a shortcut. `erase` is how many typed characters an abbreviation left to delete; `end`
  // the key that finished it ('space' comes back after the text, 'tab' doesn't).
  async fire(id, { erase = 0, end } = {}) {
    const s = this.store.get(id);
    if (!s || !this.store.isActive(s, this.platform)) return;
    if (s.kind === 'text') {
      const clipboard = variables.uses(s.text, 'clipboard') ? await this.readClipboard() : '';
      let { text, left } = variables.expand(s.text, { now: this.now(), locale: this.locale, clipboard });
      if (end === 'space') {
        text += ' ';
        if (left) left += 1;
      }
      const mode = insertMode(text);
      if (mode === 'paste' && this.platform === 'win') text = text.replace(/\r?\n/g, '\r\n');
      this.helper.send({ cmd: mode, text, erase, left });
    } else {
      if (erase) this.helper.send({ cmd: 'type', text: '', erase });
      if (s.kind === 'link') {
        await this.opener.openUrl(s.url);
      } else {
        const target = s.path[this.platform];
        if (!target) throw new Error('this shortcut has no path for this computer');
        await (s.kind === 'file' ? this.opener.openPath(target) : this.opener.launch(target, s.args));
      }
    }
    this.store.used(id);
    this.emit('fired', { id, kind: s.kind });
  }
}

module.exports = { Engine, insertMode, PASTE_OVER };
