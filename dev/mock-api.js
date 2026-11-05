'use strict';
// Stand-in for the Electron preload API, used only when the window is opened directly in a browser
// for design work (dev/serve.js). Not part of the built app. Made-up data only.
// ?account=ready|signed-out|waiting|code|offline|local  ?state=paused|permission|helper-error|first-run|empty
// ?platform=darwin  ?lang=he
(function () {
  const params = new URLSearchParams(location.search);
  const platform = params.get('platform') || 'win32';
  const mac = platform === 'darwin';
  const state = params.get('state') || '';
  const accountMode = params.get('account') || 'ready';
  const now = Date.now();
  const min = 60e3;
  const listeners = {};
  const emit = (ch, ...args) => (listeners[ch] || []).forEach((cb) => cb(...args));

  const hk = (mods, key, extra) => ({ type: 'hotkey', mods, key, ...extra });
  const base = { name: '', text: '', url: '', path: { win: '', mac: '' }, args: '', platforms: 'all', groupId: '', enabled: true, usages: 0, version: 1, device: 'pc' };
  const groups = [
    { id: 'g1', name: 'Personal', color: '#5550d8', enabled: true },
    { id: 'g2', name: 'Work', color: '#0e9f6e', enabled: true },
    { id: 'g3', name: 'Links', color: '#d97706', enabled: true },
  ];
  let shortcuts = [
    { id: 's1', kind: 'text', name: 'Email', text: 'dana.levi@example.com', trigger: hk(['ShiftRight'], 'KeyE'), groupId: 'g1' },
    { id: 's2', kind: 'text', name: 'Home address', text: '12 Herzl Street, Tel Aviv', trigger: hk(['ShiftRight'], 'KeyA'), groupId: 'g1' },
    { id: 's3', kind: 'text', name: 'Phone', text: '+972 50 000 0000', trigger: hk(['ShiftLeft'], 'KeyP'), groupId: 'g1' },
    { id: 's4', kind: 'text', name: 'Signature', text: 'Best regards,\nDana Levi\nExample Ltd.', trigger: { type: 'abbrev', text: ';sig' }, groupId: 'g2' },
    { id: 's5', kind: 'text', name: 'Meeting reply', text: 'Thanks! {cursor} works for me.', trigger: hk(['ControlRight'], 'Digit1', { mac: { mods: ['MetaRight'], key: 'Digit1' } }), groupId: 'g2' },
    { id: 's6', kind: 'text', name: '', text: 'שלום, תודה על הפנייה. נחזור אליך בהקדם.', trigger: { type: 'abbrev', text: 'תודה' }, groupId: 'g2' },
    { id: 's7', kind: 'link', name: 'Team calendar', url: 'https://calendar.example.com/team', trigger: hk(['AltRight'], 'KeyC'), groupId: 'g3' },
    { id: 's8', kind: 'file', name: 'Invoices', path: { win: 'C:\\Users\\Dana\\Documents\\Invoices', mac: '~/Documents/Invoices' }, trigger: hk(['ShiftRight', 'AltRight'], 'KeyI'), groupId: 'g3' },
    { id: 's9', kind: 'program', name: 'Calculator', path: { win: 'C:\\Windows\\System32\\calc.exe', mac: '/System/Applications/Calculator.app' }, trigger: hk(['MetaRight'], 'KeyK'), groupId: '' },
    { id: 's10', kind: 'text', name: 'Today', text: '{date}', trigger: hk(['ShiftRight'], 'KeyD'), groupId: '', enabled: false },
    { id: 's11', kind: 'text', name: 'Old email', text: 'dana@old.example.com', trigger: hk(['ShiftRight'], 'KeyE'), groupId: 'g1' },
  ].map((s) => ({ ...base, ...s }));
  if (state === 'empty' || state === 'first-run') shortcuts = [];
  const trash = [
    { id: 't1', at: now - 40 * min, reason: 'deleted', shortcut: { ...base, id: 'x1', kind: 'text', name: 'Old phone', text: '+972 3 000 0000', trigger: hk(['ShiftLeft'], 'KeyO') } },
    { id: 't2', at: now - 26 * 60 * min, reason: 'conflict', shortcut: { ...base, id: 's2', kind: 'text', name: 'Home address', text: '10 Herzl Street, Tel Aviv', trigger: hk(['ShiftRight'], 'KeyA') } },
    { id: 't3', at: now - 3 * 24 * 60 * min, reason: 'deleted', group: { id: 'g9', name: 'Old project', color: '#db2777', enabled: true }, shortcuts: [{}, {}] },
  ];
  const settings = { language: params.get('lang') || 'en', openAtLogin: true, paused: state === 'paused', onboarded: state !== 'first-run', deviceName: mac ? 'Dana’s MacBook' : 'DANA-PC' };
  const accountStates = { ready: 'ready', offline: 'ready', 'signed-out': 'signed-out', waiting: 'waiting-for-link', code: 'needs-code', local: 'unconfigured' };
  const account = { state: accountStates[accountMode] || 'ready', email: 'dana@example.com', lastSync: now - 2 * min, offline: accountMode === 'offline', hasCode: true };
  if (account.state === 'signed-out') account.email = '';

  // the same rules as src/main/triggers.js, enough for the preview
  function conflicts() {
    const seen = new Map();
    const out = {};
    for (const s of shortcuts) {
      if (!s.trigger || !s.enabled) continue;
      const k = JSON.stringify(s.trigger.type === 'abbrev' ? s.trigger.text : [s.trigger.mods.slice().sort(), s.trigger.key]);
      if (seen.has(k)) {
        (out[seen.get(k)] = out[seen.get(k)] || []).push(s.id);
        (out[s.id] = out[s.id] || []).push(seen.get(k));
      } else seen.set(k, s.id);
    }
    return out;
  }

  window.api = {
    platform,
    getState: async () => ({
      platform: mac ? 'mac' : 'win',
      version: '0.1.0',
      settings: { ...settings },
      shortcuts: structuredClone(shortcuts),
      groups: structuredClone(groups),
      trashCount: trash.length,
      conflicts: conflicts(),
      invalid: {},
      helper: { ready: state !== 'helper-error', error: state === 'helper-error' ? 'the keyboard helper keeps stopping' : '', permission: state === 'permission' ? false : mac ? true : null },
      account: { ...account },
      clavier: { exists: !mac, count: 22 },
      loginStatus: null,
    }),
    saveShortcut: async (f) => {
      const i = shortcuts.findIndex((s) => s.id === f.id);
      const s = { ...base, ...f, id: f.id || `n${Date.now()}` };
      if (i >= 0) shortcuts[i] = s;
      else shortcuts.push(s);
      emit('state:changed');
      return { ok: true, id: s.id };
    },
    removeShortcut: async (id) => {
      shortcuts = shortcuts.filter((s) => s.id !== id);
      emit('state:changed');
      return { ok: true };
    },
    duplicateShortcut: async (id) => {
      const s = shortcuts.find((x) => x.id === id);
      const copy = { ...s, id: `c${Date.now()}`, name: s.name ? `${s.name} (copy)` : '', trigger: null };
      shortcuts.push(copy);
      emit('state:changed');
      return { ok: true, id: copy.id };
    },
    enableShortcut: async (id, on) => {
      shortcuts.find((s) => s.id === id).enabled = on;
      emit('state:changed');
      return { ok: true };
    },
    checkTrigger: async (trigger, id) => {
      if (trigger.type === 'abbrev') {
        if ([...trigger.text].length < 2) return { error: 'too-short' };
        if (/\s/.test(trigger.text)) return { error: 'space' };
        return { trigger, notes: {}, suggestions: {}, warnings: { win: [], mac: [] }, clashes: [] };
      }
      if (!trigger.mods.length && !/^F\d+$/.test(trigger.key)) return { error: 'needs-modifier' };
      const same = shortcuts.filter((s) => s.id !== id && s.trigger && s.trigger.type === 'hotkey' && s.trigger.key === trigger.key && JSON.stringify(s.trigger.mods.slice().sort()) === JSON.stringify(trigger.mods.slice().sort()));
      const notes = {};
      const suggestions = {};
      if (trigger.mods.includes('ControlRight')) {
        notes.mac = 'mac-no-right-control';
        suggestions.mac = { mods: trigger.mods.map((m) => (m === 'ControlRight' ? 'MetaRight' : m)), key: trigger.key };
      }
      if (trigger.mods.includes('MetaRight')) {
        notes.win = 'win-no-right-win';
        suggestions.win = { mods: trigger.mods.map((m) => (m === 'MetaRight' ? 'ControlRight' : m)), key: trigger.key };
      }
      const left = trigger.mods.length === 1 && /Left$|^Control$/.test(trigger.mods[0]) && trigger.mods[0].startsWith('Control') && 'CVXZA'.includes(trigger.key.slice(-1));
      return { trigger, notes, suggestions, warnings: { win: left ? ['common'] : [], mac: [] }, clashes: same.map((s) => s.id) };
    },
    record: async () => ({ ok: false }), // the preview records with the window's own key events
    saveGroup: async (f) => {
      const i = groups.findIndex((g) => g.id === f.id);
      const g = { ...f, id: f.id || `g${Date.now()}` };
      if (i >= 0) groups[i] = g;
      else groups.push(g);
      emit('state:changed');
      return { ok: true, id: g.id };
    },
    removeGroup: async (id) => {
      groups.splice(groups.findIndex((g) => g.id === id), 1);
      shortcuts = shortcuts.filter((s) => s.groupId !== id);
      emit('state:changed');
      return { ok: true };
    },
    trash: async () => structuredClone(trash),
    restore: async (id) => {
      trash.splice(trash.findIndex((t) => t.id === id), 1);
      emit('state:changed');
      return { ok: true };
    },
    forget: async (id) => {
      trash.splice(trash.findIndex((t) => t.id === id), 1);
      return { ok: true };
    },
    choosePath: async () => (mac ? '/Applications/Notes.app' : 'C:\\Program Files\\Notes\\notes.exe'),
    importClavier: async () => ({ ok: true, added: 22, existing: 0, skipped: 0, off: 0 }),
    importJson: async () => ({ ok: false, canceled: true }),
    exportJson: async () => ({ ok: true, count: shortcuts.length }),
    setSettings: async (patch) => {
      Object.assign(settings, patch);
      emit('state:changed');
      return { ok: true };
    },
    signIn: async () => {
      account.state = 'waiting-for-link';
      account.email = 'dana@example.com';
      emit('state:changed');
      await new Promise((r) => setTimeout(r, 2500));
      account.state = 'ready';
      emit('state:changed');
      emit('account:code', 'K7QM-4XRT-P9WE');
      return { ok: true };
    },
    cancelSignIn: async () => {
      account.state = 'signed-out';
      emit('state:changed');
    },
    enterCode: async (code) => {
      if (code.replace(/[^a-z0-9]/gi, '').length !== 12) return { ok: false, error: 'bad-code' };
      account.state = 'ready';
      emit('state:changed');
      return { ok: true };
    },
    showCode: async () => 'K7QM-4XRT-P9WE',
    syncNow: async () => {
      account.lastSync = Date.now();
      emit('state:changed');
      return { ok: true };
    },
    devices: async () => ({
      ok: true,
      devices: [
        { id: 'pc', name: 'DANA-PC', platform: 'win', lastSeen: now, here: !mac },
        { id: 'mac', name: 'Dana’s MacBook', platform: 'mac', lastSeen: now - 3 * 60 * min, here: mac },
      ],
    }),
    signOutDevice: async () => ({ ok: true }),
    signOut: async () => {
      account.state = 'signed-out';
      emit('state:changed');
      return { ok: true };
    },
    deleteAccount: async () => {
      account.state = 'signed-out';
      emit('state:changed');
      return { ok: true };
    },
    openAccessibility: async () => {},
    openDataDir: async () => {},
    hide: async () => {},
    on: (ch, cb) => {
      (listeners[ch] = listeners[ch] || []).push(cb);
      return () => {};
    },
  };
})();
