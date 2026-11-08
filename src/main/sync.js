'use strict';
// Cloud sync: keeps this computer's shortcuts, groups and trash the same as the account's, sealed end
// to end (vault.js), with nothing lost when two computers change the same thing.
//
// The server keeps one row per item: { id, rev, data (sealed), deleted, device }. `rev` grows with
// every change to the account, so "what changed since rev N" is one query. This computer remembers,
// per item, the rev and the content it last agreed on with the server (sync.json): an item whose
// content differs is a change to push, a remembered item that's gone was deleted here.
//
// When both sides changed one item since the last sync, the later edit wins and the other version
// goes to the trash; an edit always beats a delete (the deleting computer already put the old
// version in the trash, and that syncs too).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const vault = require('./vault');

const PAGE = 500;
const TYPES = ['group', 'shortcut', 'trash'];

const hashOf = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32);

// The later of two versions; a tie goes to the higher device id, so every computer picks the same.
function later(a, b) {
  const at = (x) => (x.t === 'trash' ? x.v.at : x.v.updated) || 0;
  if (at(a) !== at(b)) return at(a) > at(b) ? a : b;
  return String(a.v.device || '') >= String(b.v.device || '') ? a : b;
}

class Sync extends EventEmitter {
  constructor({ store, backend, key, deviceId, dir, page = PAGE }) {
    super();
    Object.assign(this, { store, backend, key, deviceId, page });
    this.file = path.join(dir, 'sync.json');
    this.state = { account: '', cursor: 0, known: {} };
    this.running = null;
    this.again = false;
  }

  // What this computer last agreed on with `account`. Another account starts from scratch: the
  // shortcuts here are then added to it.
  load(account) {
    let saved = null;
    try {
      saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {}
    const ok = saved && saved.account === account && Number.isFinite(saved.cursor) && saved.known && typeof saved.known === 'object';
    this.state = ok ? saved : { account, cursor: 0, known: {} };
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.state));
    fs.renameSync(this.file + '.tmp', this.file);
  }

  // Signing out: the shortcuts stay on this computer, the sync memory goes.
  forget() {
    this.state = { account: '', cursor: 0, known: {} };
    fs.rmSync(this.file, { force: true });
  }

  // One sync: pull what changed, push what changed here. Calls during a sync make one more after it.
  run() {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      let result;
      do {
        this.again = false;
        result = await this._run();
      } while (this.again);
      return result;
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  async _run() {
    const result = { pulled: 0, pushed: 0, conflicts: 0, unreadable: 0 };
    for (;;) {
      const rows = await this.backend.pull(this.state.cursor, this.page);
      this._apply(rows, result);
      for (const row of rows) this.state.cursor = Math.max(this.state.cursor, row.rev);
      this.save();
      if (rows.length < this.page) break;
    }
    // A push the server turns down (another computer got there first) brings the server's version:
    // that's settled like a pulled change, and what's left is pushed again.
    for (let round = 0; round < 3; round++) {
      const changes = this._localChanges();
      if (!changes.length) break;
      const theirs = [];
      for (let i = 0; i < changes.length; i += this.page) {
        const batch = changes.slice(i, i + this.page);
        const replies = new Map((await this.backend.push(batch.map((c) => c.wire))).map((r) => [r.id, r]));
        for (const c of batch) {
          const reply = replies.get(c.id);
          if (reply && reply.ok) {
            result.pushed++;
            if (c.value) this.state.known[c.id] = { rev: reply.rev, hash: c.hash };
            else delete this.state.known[c.id];
          } else if (reply && reply.row) {
            theirs.push(reply.row);
          }
        }
        this.save();
      }
      if (!theirs.length) break;
      this._apply(theirs, result);
      this.save();
    }
    this.emit('synced', result);
    return result;
  }

  // Changes here since the last sync, ready to send (groups first, so shortcuts find theirs).
  _localChanges() {
    const local = this.store.syncItems();
    const changes = [];
    for (const [id, value] of local) {
      const hash = hashOf(value);
      const known = this.state.known[id];
      if (known && known.hash === hash) continue;
      const wire = { id, base: known ? known.rev : 0, data: vault.seal(this.key, id, value), deleted: false, device: this.deviceId };
      changes.push({ id, value, hash, wire });
    }
    for (const [id, known] of Object.entries(this.state.known)) {
      if (local.has(id)) continue;
      changes.push({ id, value: null, hash: '', wire: { id, base: known.rev, data: null, deleted: true, device: this.deviceId } });
    }
    return changes;
  }

  // Settles rows from the server against what's here.
  _apply(rows, result) {
    if (!rows.length) return;
    const local = this.store.syncItems();
    const apply = [];
    const taken = []; // [id, rev]: the server's version is now ours
    const losers = [];
    for (const row of rows) {
      const known = this.state.known[row.id];
      if (known && known.rev === row.rev) continue; // our own change coming back
      let remote = null;
      if (!row.deleted) {
        try {
          remote = vault.open(this.key, row.id, row.data);
        } catch {
          remote = null;
        }
        if (!remote || !TYPES.includes(remote.t) || !remote.v || typeof remote.v !== 'object') {
          result.unreadable++;
          this.emit('unreadable', row.id);
          continue;
        }
      }
      const mine = local.get(row.id) || null;
      const changedHere = mine ? !known || known.hash !== hashOf(mine) : !!known;
      if (!changedHere) {
        // a delete of something that isn't here changes nothing
        if (mine || remote) {
          apply.push({ id: row.id, value: remote });
          result.pulled++;
        }
        taken.push([row.id, row.rev]);
        continue;
      }
      // Both sides changed it since the last sync.
      if (!mine && !remote) {
        delete this.state.known[row.id]; // deleted on both
        continue;
      }
      if (mine && remote && hashOf(mine) === hashOf(remote)) {
        taken.push([row.id, row.rev]); // the same change on both
        continue;
      }
      result.conflicts++;
      if (!remote) {
        // deleted there, edited here: the edit stays and goes over the delete
        this.state.known[row.id] = { rev: row.rev, hash: '' };
      } else if (!mine) {
        // deleted here, edited there: the edit comes back
        apply.push({ id: row.id, value: remote });
        taken.push([row.id, row.rev]);
      } else if (later(mine, remote) === remote) {
        apply.push({ id: row.id, value: remote });
        taken.push([row.id, row.rev]);
        losers.push(mine);
      } else {
        // ours is later: it stays, and is pushed over theirs
        this.state.known[row.id] = { rev: row.rev, hash: hashOf(remote) };
        losers.push(remote);
      }
    }
    this.store.applyRemote(apply);
    // remember the version as it now is here, so a field filled in on the way in isn't a change
    const after = this.store.syncItems();
    for (const [id, rev] of taken) {
      if (after.has(id)) this.state.known[id] = { rev, hash: hashOf(after.get(id)) };
      else delete this.state.known[id];
    }
    for (const loser of losers) this.store.keepInTrash(loser, 'conflict');
  }
}

module.exports = { Sync, hashOf, later };
