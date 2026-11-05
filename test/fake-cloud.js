'use strict';
// A cloud in memory that keeps rows the way supabase/migrations does: per account, a rev that grows
// with every change, and a push that only goes through if the row is still at the rev the computer
// last saw (push_items in the SQL).
const path = require('path');
const { Store } = require('../src/main/store');
const { Sync } = require('../src/main/sync');
const { clock, tmpDir } = require('./helpers');

class FakeCloud {
  constructor() {
    this.accounts = new Map();
  }

  account(id) {
    if (!this.accounts.has(id)) this.accounts.set(id, { lastRev: 0, rows: new Map() });
    return this.accounts.get(id);
  }

  // What the server can see: every stored row, as text.
  dump() {
    return JSON.stringify([...this.accounts.values()].map((a) => [...a.rows.values()]));
  }

  backend(accountId) {
    const acc = this.account(accountId);
    const b = {
      offline: false,
      pushes: 0,
      async pull(cursor, limit) {
        if (b.offline) throw new Error('offline');
        return [...acc.rows.values()].filter((r) => r.rev > cursor).sort((x, y) => x.rev - y.rev).slice(0, limit).map((r) => ({ ...r }));
      },
      async push(changes) {
        if (b.offline) throw new Error('offline');
        b.pushes++;
        return changes.map((c) => {
          const row = acc.rows.get(c.id);
          if (row && row.rev !== c.base) return { id: c.id, ok: false, row: { ...row } };
          const rev = ++acc.lastRev;
          acc.rows.set(c.id, { id: c.id, rev, data: c.deleted ? null : c.data, deleted: !!c.deleted, device: c.device });
          return { id: c.id, ok: true, rev };
        });
      },
    };
    return b;
  }
}

// A computer: its own data folder, clock, store and sync, signed in to `account` with `key`.
function computer(cloud, name, key, { account = 'user-1', start, page } = {}) {
  const dir = tmpDir();
  const c = clock(start);
  const store = new Store(dir, { deviceId: name, now: c.now });
  store.load();
  const backend = cloud.backend(account);
  const sync = new Sync({ store, backend, key, deviceId: name, dir: path.join(dir, 'sync'), page });
  sync.load(account);
  return { name, dir, clock: c, store, backend, sync };
}

// What should match between computers: shortcuts (without usage counts), groups, trash.
function snapshot(pc) {
  const items = [...pc.store.syncItems().entries()].sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(items);
}

module.exports = { FakeCloud, computer, snapshot };
