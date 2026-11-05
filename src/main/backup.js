'use strict';
// Export and import: a JSON file with every group and shortcut (the account's "export" too), and
// bringing imported shortcuts (Clavier+, later espanso / TextExpander) into the store.
const { cleanShortcut } = require('./store');

const APP = 'KeyBridge';
const FORMAT = 1;

function exportData(store, now = new Date()) {
  return {
    app: APP,
    format: FORMAT,
    exported: now.toISOString(),
    groups: structuredClone(store.groups()),
    shortcuts: structuredClone(store.shortcuts()),
  };
}

class ImportError extends Error {
  constructor(code) {
    super(`import: ${code}`);
    this.code = code;
  }
}

// Same trigger and same content.
function sameShortcut(a, b) {
  const pick = (s) => JSON.stringify([s.kind, s.text, s.url, s.path, s.args, s.trigger]);
  return pick(a) === pick(b);
}

// Puts an export back. A shortcut with the same id and different content replaces what's there
// (the old version goes to the trash); the same content is left alone, so importing a backup
// twice changes nothing. -> { added, replaced, same, skipped }
function importData(store, data) {
  if (!data || data.app !== APP || !Array.isArray(data.shortcuts)) throw new ImportError('not-keybridge');
  if (data.format > FORMAT) throw new ImportError('newer-format');
  for (const raw of Array.isArray(data.groups) ? data.groups : []) {
    if (!raw || typeof raw.id !== 'string' || store.group(raw.id)) continue;
    store.putGroup(raw);
  }
  const result = { added: 0, replaced: 0, same: 0, skipped: 0 };
  for (const raw of data.shortcuts) {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') {
      result.skipped++;
      continue;
    }
    const mine = store.get(raw.id);
    if (mine && sameShortcut(mine, cleanShortcut(raw))) {
      result.same++;
      continue;
    }
    result[store.put(raw, 'replaced by import')]++;
  }
  return result;
}

// Adds shortcuts from another app into the group `groupName` (made if missing). Shortcuts already
// there from an earlier import are left alone. -> { added, existing }
function addImported(store, items, groupName) {
  const group = store.groupNamed(groupName);
  const result = { added: 0, existing: 0 };
  for (const item of items) {
    const clean = cleanShortcut({ ...item, groupId: group.id });
    if (store.shortcuts().some((s) => sameShortcut(s, clean))) {
      result.existing++;
      continue;
    }
    store.put({ ...clean, version: 1, created: 0, device: store.deviceId });
    result.added++;
  }
  return result;
}

module.exports = { exportData, importData, addImported, ImportError, APP, FORMAT };
