'use strict';
// The shortcuts of this computer, in shortcuts.json in the app's data folder.
//
// Shortcuts and groups keep a version, the time and the device of their last change, so the cloud
// sync (M3) can merge them. Nothing is ever lost: deleted shortcuts and groups, and shortcuts
// replaced by an import, a restore or the sync, go to the trash for 30 days.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const triggers = require('./triggers');

const KINDS = ['text', 'link', 'file', 'program'];
const SCOPES = ['all', 'win', 'mac'];
const KEEP_DAYS = 30;
const FORMAT = 1;

const str = (v, max = 100000) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, max);
const newId = () => crypto.randomUUID();

// A shortcut with every field in place. `strict` throws on a trigger that can't work (editing);
// otherwise such a trigger is dropped and the rest kept (loading, importing).
function cleanShortcut(raw, strict = false) {
  const kind = KINDS.includes(raw.kind) ? raw.kind : 'text';
  let trigger = null;
  try {
    trigger = triggers.normalize(raw.trigger);
  } catch (err) {
    if (strict) throw err;
  }
  const rawPath = raw.path && typeof raw.path === 'object' ? raw.path : {};
  return {
    id: str(raw.id, 100) || newId(),
    kind,
    name: str(raw.name, 200),
    text: kind === 'text' ? str(raw.text).replace(/\r\n?/g, '\n') : '',
    url: kind === 'link' ? str(raw.url, 4000).trim() : '',
    path: kind === 'file' || kind === 'program' ? { win: str(rawPath.win, 4000).trim(), mac: str(rawPath.mac, 4000).trim() } : { win: '', mac: '' },
    args: kind === 'program' ? str(raw.args, 4000) : '',
    trigger,
    platforms: SCOPES.includes(raw.platforms) ? raw.platforms : 'all',
    groupId: str(raw.groupId, 100),
    enabled: raw.enabled !== false,
    usages: Number.isInteger(raw.usages) && raw.usages > 0 ? raw.usages : 0,
    created: Number.isFinite(raw.created) ? raw.created : 0,
    updated: Number.isFinite(raw.updated) ? raw.updated : 0,
    version: Number.isInteger(raw.version) && raw.version > 0 ? raw.version : 1,
    device: str(raw.device, 100),
  };
}

function cleanGroup(raw) {
  return {
    id: str(raw.id, 100) || newId(),
    name: str(raw.name, 200),
    color: /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : '',
    enabled: raw.enabled !== false,
    created: Number.isFinite(raw.created) ? raw.created : 0,
    updated: Number.isFinite(raw.updated) ? raw.updated : 0,
    version: Number.isInteger(raw.version) && raw.version > 0 ? raw.version : 1,
    device: str(raw.device, 100),
  };
}

class Store extends EventEmitter {
  constructor(dir, { deviceId = '', now = Date.now } = {}) {
    super();
    this.file = path.join(dir, 'shortcuts.json');
    this.deviceId = deviceId;
    this.now = now;
    this.data = { format: FORMAT, groups: [], shortcuts: [], trash: [] };
  }

  load() {
    let saved = null;
    try {
      saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {}
    const list = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
    this.data = {
      format: FORMAT,
      groups: list(saved && saved.groups).map(cleanGroup),
      shortcuts: list(saved && saved.shortcuts).map((s) => cleanShortcut(s)),
      trash: list(saved && saved.trash).filter((t) => typeof t.id === 'string' && Number.isFinite(t.at)),
    };
    if (this.purge() === 0 && saved) return;
    this.save();
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    const json = JSON.stringify(this.data, null, 2);
    fs.writeFileSync(tmp, json);
    try {
      fs.renameSync(tmp, this.file);
    } catch {
      fs.writeFileSync(this.file, json);
    }
  }

  _changed(type, id) {
    this.save();
    this.emit('change', { type, id });
  }

  _stamp(item, isNew) {
    const at = this.now();
    if (isNew) item.created = at;
    item.updated = at;
    item.device = this.deviceId;
    if (!isNew) item.version += 1;
    return item;
  }

  // --- reading

  shortcuts() {
    return this.data.shortcuts;
  }

  groups() {
    return this.data.groups;
  }

  get(id) {
    return this.data.shortcuts.find((s) => s.id === id) || null;
  }

  group(id) {
    return this.data.groups.find((g) => g.id === id) || null;
  }

  trash() {
    return [...this.data.trash].sort((a, b) => b.at - a.at);
  }

  // On, in an enabled group (or none), and meant for this system.
  isActive(s, platform) {
    if (!s.enabled) return false;
    if (s.platforms !== 'all' && s.platforms !== platform) return false;
    const g = s.groupId && this.group(s.groupId);
    return !g || g.enabled;
  }

  active(platform) {
    return this.data.shortcuts.filter((s) => this.isActive(s, platform));
  }

  search(query, platform = triggers.currentPlatform()) {
    const q = str(query).normalize('NFC').toLocaleLowerCase().trim();
    if (!q) return this.data.shortcuts;
    return this.data.shortcuts.filter((s) =>
      [s.name, s.text, s.url, s.path.win, s.path.mac, triggers.label(s.trigger, platform)]
        .some((f) => f.normalize('NFC').toLocaleLowerCase().includes(q)),
    );
  }

  // --- shortcuts

  add(fields) {
    const s = this._stamp(cleanShortcut({ ...fields, id: newId(), version: 1, usages: 0 }, true), true);
    if (s.groupId && !this.group(s.groupId)) s.groupId = '';
    this.data.shortcuts.push(s);
    this._changed('add', s.id);
    return s;
  }

  update(id, patch) {
    const i = this.data.shortcuts.findIndex((s) => s.id === id);
    if (i < 0) throw new Error('no such shortcut');
    const old = this.data.shortcuts[i];
    const next = cleanShortcut({ ...old, ...patch, id, version: old.version, usages: old.usages, created: old.created }, true);
    if (next.groupId && !this.group(next.groupId)) next.groupId = '';
    this.data.shortcuts[i] = this._stamp(next, false);
    this._changed('update', id);
    return this.data.shortcuts[i];
  }

  remove(id) {
    const i = this.data.shortcuts.findIndex((s) => s.id === id);
    if (i < 0) return null;
    const [s] = this.data.shortcuts.splice(i, 1);
    const entry = this._toTrash({ shortcut: s }, 'deleted');
    this._changed('remove', id);
    return entry;
  }

  duplicate(id) {
    const s = this.get(id);
    if (!s) throw new Error('no such shortcut');
    // the copy starts without a trigger: two shortcuts on one trigger would clash
    return this.add({ ...s, name: s.name ? `${s.name} (copy)` : '', trigger: null });
  }

  // Puts in a whole shortcut from elsewhere (import, sync), keeping its id. A shortcut it replaces
  // goes to the trash. Returns 'added' or 'replaced'.
  put(raw, reason = 'replaced') {
    const s = cleanShortcut(raw);
    if (s.groupId && !this.group(s.groupId)) s.groupId = '';
    if (!s.created) this._stamp(s, true);
    const i = this.data.shortcuts.findIndex((x) => x.id === s.id);
    if (i >= 0) {
      this._toTrash({ shortcut: this.data.shortcuts[i] }, reason);
      this.data.shortcuts[i] = s;
    } else {
      this.data.shortcuts.push(s);
    }
    this._changed('put', s.id);
    return i >= 0 ? 'replaced' : 'added';
  }

  // Usage counter: not a content change, so no new version.
  used(id) {
    const s = this.get(id);
    if (!s) return;
    s.usages += 1;
    this.save();
  }

  // --- groups

  addGroup(fields) {
    const g = this._stamp(cleanGroup({ ...fields, id: newId(), version: 1 }), true);
    this.data.groups.push(g);
    this._changed('addGroup', g.id);
    return g;
  }

  // A whole group from elsewhere (import, sync), keeping its id.
  putGroup(raw) {
    const g = cleanGroup(raw);
    const i = this.data.groups.findIndex((x) => x.id === g.id);
    if (i >= 0) this.data.groups[i] = g;
    else this.data.groups.push(g);
    this._changed('putGroup', g.id);
    return g;
  }

  // Finds a group by name or makes it (used by imports).
  groupNamed(name) {
    return this.data.groups.find((g) => g.name === name) || this.addGroup({ name });
  }

  updateGroup(id, patch) {
    const i = this.data.groups.findIndex((g) => g.id === id);
    if (i < 0) throw new Error('no such group');
    const old = this.data.groups[i];
    this.data.groups[i] = this._stamp(cleanGroup({ ...old, ...patch, id, version: old.version, created: old.created }), false);
    this._changed('updateGroup', id);
    return this.data.groups[i];
  }

  // The group and its shortcuts go to the trash together, and come back together.
  removeGroup(id) {
    const i = this.data.groups.findIndex((g) => g.id === id);
    if (i < 0) return null;
    const [group] = this.data.groups.splice(i, 1);
    const shortcuts = this.data.shortcuts.filter((s) => s.groupId === id);
    this.data.shortcuts = this.data.shortcuts.filter((s) => s.groupId !== id);
    const entry = this._toTrash({ group, shortcuts }, 'deleted');
    this._changed('removeGroup', id);
    return entry;
  }

  // --- trash

  _toTrash(content, reason) {
    const entry = { id: newId(), at: this.now(), reason, ...content };
    this.data.trash.push(entry);
    return entry;
  }

  // Brings a trash entry back. A shortcut now in its place goes to the trash in turn.
  restore(trashId) {
    const i = this.data.trash.findIndex((t) => t.id === trashId);
    if (i < 0) throw new Error('not in the trash');
    const [entry] = this.data.trash.splice(i, 1);
    if (entry.group) {
      const g = cleanGroup(entry.group);
      if (!this.group(g.id)) this.data.groups.push(g);
    }
    for (const raw of entry.shortcut ? [entry.shortcut] : entry.shortcuts || []) {
      const s = cleanShortcut(raw);
      if (s.groupId && !this.group(s.groupId)) s.groupId = '';
      const at = this.data.shortcuts.findIndex((x) => x.id === s.id);
      if (at >= 0) {
        this._toTrash({ shortcut: this.data.shortcuts[at] }, 'replaced');
        this.data.shortcuts[at] = s;
      } else {
        this.data.shortcuts.push(s);
      }
    }
    this._changed('restore', trashId);
  }

  // "Delete forever" from the trash.
  forget(trashId) {
    const before = this.data.trash.length;
    this.data.trash = this.data.trash.filter((t) => t.id !== trashId);
    if (this.data.trash.length !== before) this._changed('forget', trashId);
  }

  // Drops trash entries older than `days`. Returns how many.
  purge(days = KEEP_DAYS) {
    const before = this.now() - days * 24 * 3600 * 1000;
    const keep = this.data.trash.filter((t) => t.at >= before);
    const removed = this.data.trash.length - keep.length;
    this.data.trash = keep;
    return removed;
  }
}

module.exports = { Store, cleanShortcut, cleanGroup, KINDS, SCOPES, KEEP_DAYS };
