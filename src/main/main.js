'use strict';
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  nativeTheme,
  ipcMain,
  shell,
  dialog,
  clipboard,
  safeStorage,
  Notification,
  systemPreferences,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { Settings } = require('./settings');
const { Store } = require('./store');
const { Engine } = require('./engine');
const { Helper, helperPath } = require('./helper');
const { opener, expandPath } = require('./opener');
const { Account } = require('./account');
const { Secrets } = require('./secrets');
const { cloudConfig } = require('./config');
const triggers = require('./triggers');
const clavier = require('./clavier');
const backup = require('./backup');
const { LANGUAGES, createTranslator } = require('../shared/i18n');

const isMac = process.platform === 'darwin';
const platform = isMac ? 'mac' : 'win';
const ASSETS = path.join(__dirname, '..', '..', 'assets');

let tr = createTranslator('en');
const t = (key, vars) => tr.t(key, vars);

// KEYBRIDGE_PROFILE runs an independent copy with its own data. Running from the source is the
// "dev" profile - the same data folder as dev/cli.js - so an installed KeyBridge is never touched.
const profile = process.env.KEYBRIDGE_PROFILE || (app.isPackaged ? '' : 'dev');
if (profile) app.setPath('userData', path.join(app.getPath('appData'), `KeyBridge-${profile}`));

let settings, store, helper, engine, account, tray, win;
let quitting = false;
const helperState = { ready: false, error: '', permission: null };

// A small log file in the data folder, for troubleshooting. Never anything typed.
let logFile = null;
function log(...args) {
  const line = `${new Date().toISOString()} ${args.map((a) => (a instanceof Error ? a.stack : String(a))).join(' ')}\n`;
  if (!app.isPackaged) process.stdout.write(line);
  if (!logFile) return;
  try {
    fs.appendFileSync(logFile, line);
  } catch {}
}
// A startup step that takes long gets a line in the log (the Mac's keychain, login items or a first
// check of an unsigned program can take seconds).
function timed(name, fn) {
  const t0 = Date.now();
  const out = fn();
  const ms = Date.now() - t0;
  if (ms > 300) log(`slow: ${name} took ${ms} ms`);
  return out;
}

process.on('uncaughtException', (err) => log('uncaught:', err));
process.on('unhandledRejection', (err) => log('unhandled rejection:', err));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  app.whenReady().then(init).catch((err) => {
    dialog.showErrorBox('KeyBridge', `KeyBridge failed to start:\n${err.stack || err}`);
    app.quit();
  });
}

// macOS: clicking the Dock icon opens the window. Ignored right after launch, so starting at
// login doesn't pop the window up.
let acceptActivate = false;
app.on('activate', () => {
  if (acceptActivate) showWindow();
});

app.on('before-quit', () => {
  quitting = true;
});

app.on('will-quit', () => {
  if (account) account.stop();
  if (helper) helper.stop();
});

// Keep running in the tray when the window is closed.
app.on('window-all-closed', () => {});

function systemLanguage() {
  const wanted = (app.getPreferredSystemLanguages()[0] || app.getLocale() || 'en').slice(0, 2).toLowerCase();
  return LANGUAGES.some((l) => l.code === wanted) ? wanted : 'en';
}

async function init() {
  if (isMac) {
    try {
      systemPreferences.setUserDefault('NSAppSleepDisabled', 'boolean', true);
    } catch {}
  }
  const userData = app.getPath('userData');
  fs.mkdirSync(userData, { recursive: true });
  logFile = path.join(userData, 'keybridge.log');
  try {
    if (fs.statSync(logFile).size > 1024 * 1024) fs.rmSync(logFile);
  } catch {}
  log(`starting KeyBridge ${app.getVersion()} on ${process.platform}${profile ? ` (profile ${profile})` : ''}`);

  settings = new Settings(userData);
  settings.load();
  if (!settings.get('language')) settings.set({ language: systemLanguage() });
  tr = createTranslator(settings.get('language'));
  buildAppMenu();

  store = new Store(userData, { deviceId: settings.get('deviceId') });
  store.load();
  store.on('change', () => sendState());
  setInterval(() => {
    if (store.purge()) {
      store.save();
      store.emit('change', { type: 'purge', id: null });
    }
  }, 6 * 3600 * 1000).unref();

  timed('keyboard', startKeyboard);
  timed('account', startAccount);
  setupIpc();
  timed('tray', createTray);

  const show = settings.isFirstRun || !settings.get('onboarded') || !timed('login check', launchedAtLogin);
  if (show) timed('window', () => showWindow());
  setTimeout(() => (acceptActivate = true), 1500);
  // registering the login item can be slow on macOS, so it waits until the window is up
  setTimeout(() => timed('login item', applyLoginItem), 2000);
  if (process.env.KEYBRIDGE_SCREENSHOT) captureForTesting(process.env.KEYBRIDGE_SCREENSHOT);
}

// ---------- the keyboard: helper + engine ----------

const appOpener = {
  openUrl: (url) => shell.openExternal(url),
  openPath: async (p) => {
    const problem = await shell.openPath(expandPath(p));
    if (problem) throw new Error(problem);
  },
  launch: (p, args) => opener.launch(p, args),
};

function startKeyboard() {
  // KEYBRIDGE_HELPER points at another helper build while developing.
  helper = new Helper({ exe: process.env.KEYBRIDGE_HELPER || helperPath(), log: (line) => log(line) });
  engine = new Engine({
    store,
    helper,
    opener: appOpener,
    platform,
    locale: app.getSystemLocale ? app.getSystemLocale() : app.getLocale(),
    readClipboard: async () => clipboard.readText(),
  });
  engine.on('ready', () => {
    helperState.ready = true;
    helperState.error = '';
    log(`keyboard helper ready (${Date.now() - helper.startedAt} ms)`);
    sendState();
  });
  engine.on('permission', (allowed) => {
    helperState.permission = allowed;
    log(`accessibility: ${allowed ? 'allowed' : 'not allowed yet'}`);
    sendState();
    if (allowed) send('toast', 'toastPermissionOk');
  });
  engine.on('triggers', () => sendState());
  engine.on('skipped', (ids) => log(`helper skipped ${ids.length} trigger(s)`));
  engine.on('problem', (err) => {
    log('engine:', err.message);
    send('toast', 'toastRunFailed', { reason: err.message });
  });
  helper.on('event', (ev) => {
    if (ev.event === 'recorded') send('recorded', { mods: ev.mods || [], key: ev.key || '' });
  });
  helper.on('exit', (code) => {
    helperState.ready = false;
    log(`keyboard helper stopped (${code})`);
    sendState();
  });
  helper.on('problem', (err) => {
    helperState.ready = false;
    helperState.error = err.message;
    log('keyboard helper:', err.message);
    sendState();
  });
  engine.start();
  engine.setPaused(settings.get('paused'));
  timed('helper start', () => helper.start());
}

// ---------- the account ----------

function startAccount() {
  let config = { url: '', key: '' };
  try {
    config = cloudConfig();
  } catch (err) {
    log('cloud config:', err.message);
  }
  // Sealed on Windows only. On the Mac the secure storage is the keychain, which - for an app
  // without a paid signature - asks for the Mac password at the first start and after every update
  // and holds the app until it's answered (17 s, and the page never loaded). There they stay in the
  // user-only file next to the shortcuts, which are plain on disk anyway (the user's choice).
  const sealed = !isMac && timed('secure storage', () => safeStorage.isEncryptionAvailable())
    ? { encrypt: (s) => safeStorage.encryptString(s), decrypt: (b) => safeStorage.decryptString(b) }
    : {};
  account = new Account({
    dir: path.join(app.getPath('userData'), 'sync'),
    url: config.url,
    key: config.key,
    store,
    deviceId: settings.get('deviceId'),
    platform,
    secrets: new Secrets(app.getPath('userData'), sealed),
    deviceName: settings.get('deviceName'),
  });
  // a sync that changed nothing stays out of the log (one every 5 minutes); sign-in steps don't
  let lastState = account.state;
  account.on('state', (s) => {
    if (s.state !== lastState) log(`account: ${s.state}`);
    lastState = s.state;
    sendState();
    updateTrayMenu();
  });
  account.on('synced', (r) => {
    if (r.pulled || r.pushed || r.conflicts) log(`synced: ${r.pulled} in, ${r.pushed} out, ${r.conflicts} conflicts`);
    sendState();
  });
  account.on('sync-failed', (err) => {
    log('sync failed:', err.code || err.message);
    sendState();
  });
  account.on('code', (code) => {
    showWindow();
    send('account:code', code);
  });
  account.on('ended', (why) => {
    log(`account ended here: ${why}`);
    notify(t(why === 'deleted' ? 'notifyDeletedTitle' : 'notifySignedOutTitle'), t('notifyKeptBody'));
  });
  account.on('problem', (err) => log('account:', err.code || err.message));
  account.start().catch((err) => log('account start:', err.code || err.message));
}

function notify(title, body) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body });
  n.on('click', () => showWindow());
  n.show();
}

// ---------- state for the window ----------

function send(channel, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

let stateTimer = null;
function sendState() {
  if (stateTimer) return;
  stateTimer = setTimeout(() => {
    stateTimer = null;
    send('state:changed');
    updateTrayMenu();
  }, 50);
}

let clavierInfo = null;
function clavierState() {
  if (isMac) return { exists: false, count: 0 };
  if (!clavierInfo) {
    try {
      clavierInfo = clavier.exists() ? { exists: true, count: clavier.readFile().items.length } : { exists: false, count: 0 };
    } catch {
      clavierInfo = { exists: false, count: 0 };
    }
  }
  return clavierInfo;
}

function getState() {
  const conflicts = {};
  for (const [id, others] of engine.triggers.conflicts) conflicts[id] = [...others];
  const invalid = {};
  for (const bad of engine.triggers.invalid) invalid[bad.id] = bad.reason;
  const attention = {};
  for (const s of store.shortcuts()) {
    const open = triggers.unanswered(s);
    if (open) attention[s.id] = open;
  }
  return {
    platform,
    version: app.getVersion(),
    settings: {
      language: tr.code,
      openAtLogin: settings.get('openAtLogin'),
      paused: settings.get('paused'),
      onboarded: settings.get('onboarded'),
      deviceName: settings.get('deviceName'),
    },
    shortcuts: store.shortcuts(),
    groups: store.groups(),
    trashCount: store.trash().length,
    conflicts,
    invalid,
    attention,
    helper: { ...helperState },
    account: { ...account.status(), hasCode: !!account.code },
    clavier: clavierState(),
    loginStatus,
  };
}

// Notes, warnings and clashes for a trigger being edited.
function checkTrigger(raw, id, scope) {
  let trigger;
  try {
    trigger = triggers.normalize(raw);
  } catch (err) {
    return { error: err.code || 'bad-trigger' };
  }
  if (!trigger) return {};
  const others = store.shortcuts().filter((s) => s.id !== id && s.trigger);
  const forPlatform = (p) => others.filter((s) => s.platforms === 'all' || s.platforms === p);
  const me = { id: id || 'new', trigger };
  const clashes = new Set();
  const notes = {};
  const suggestions = {};
  const warnings = {};
  for (const p of triggers.PLATFORMS) {
    if (scope !== 'all' && scope !== p) continue;
    const r = triggers.forHelper([...forPlatform(p), me], p);
    for (const other of r.conflicts.get(me.id) || []) clashes.add(other);
    notes[p] = triggers.note(trigger, p);
    if (notes[p] && notes[p] !== 'key-missing') suggestions[p] = triggers.suggestOverride(trigger, p, forPlatform(p));
    warnings[p] = triggers.warnings(trigger, p);
  }
  return { trigger, notes, suggestions, warnings, clashes: [...clashes] };
}

// ---------- IPC ----------

const fail = (err) => ({ ok: false, error: err.code || err.message });

function setupIpc() {
  ipcMain.handle('state:get', () => getState());

  ipcMain.handle('shortcut:save', (_e, fields) => {
    try {
      const f = { ...fields };
      if (f.kind === 'link' && f.url && !/^[a-z][a-z0-9+.-]*:/i.test(f.url.trim())) f.url = `https://${f.url.trim()}`;
      const s = f.id && store.get(f.id) ? store.update(f.id, f) : store.add(f);
      return { ok: true, id: s.id };
    } catch (err) {
      return fail(err);
    }
  });
  ipcMain.handle('shortcut:remove', (_e, id) => ({ ok: !!store.remove(id) }));
  ipcMain.handle('shortcut:duplicate', (_e, id) => {
    try {
      return { ok: true, id: store.duplicate(id).id };
    } catch (err) {
      return fail(err);
    }
  });
  ipcMain.handle('shortcut:enable', (_e, id, on) => {
    try {
      store.update(id, { enabled: !!on });
      return { ok: true };
    } catch (err) {
      return fail(err);
    }
  });
  ipcMain.handle('trigger:check', (_e, raw, id, scope) => checkTrigger(raw, id, scope || 'all'));
  ipcMain.handle('record', (_e, on) => {
    helper.send({ cmd: 'record', on: !!on });
    return { ok: helperState.ready };
  });

  ipcMain.handle('group:save', (_e, fields) => {
    try {
      const g = fields.id && store.group(fields.id) ? store.updateGroup(fields.id, fields) : store.addGroup(fields);
      return { ok: true, id: g.id };
    } catch (err) {
      return fail(err);
    }
  });
  ipcMain.handle('group:remove', (_e, id) => ({ ok: !!store.removeGroup(id) }));

  ipcMain.handle('trash:list', () => store.trash());
  ipcMain.handle('trash:restore', (_e, id) => {
    try {
      store.restore(id);
      return { ok: true };
    } catch (err) {
      return fail(err);
    }
  });
  ipcMain.handle('trash:forget', (_e, id) => {
    store.forget(id);
    return { ok: true };
  });

  // 'program' picks a file; 'any' (folder or file) picks either on the Mac - Windows can't offer
  // both in one dialog, so there it picks a folder (a file's path can be typed or pasted).
  ipcMain.handle('path:choose', async (_e, what) => {
    const res = await dialog.showOpenDialog(win, {
      properties: what === 'program' ? ['openFile'] : isMac ? ['openFile', 'openDirectory'] : ['openDirectory'],
      defaultPath: isMac && what === 'program' ? '/Applications' : undefined,
    });
    return res.canceled || !res.filePaths[0] ? null : res.filePaths[0];
  });

  ipcMain.handle('import:clavier', () => {
    try {
      clavierInfo = null;
      const { items, skipped, warnings } = clavier.readFile();
      const r = backup.addImported(store, items, 'Clavier+');
      return { ok: true, added: r.added, existing: r.existing, skipped: skipped.length, off: warnings.filter((w) => w.codes.some((c) => c !== 'directory')).length };
    } catch (err) {
      return fail(err);
    }
  });
  ipcMain.handle('import:json', async () => {
    const res = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'KeyBridge', extensions: ['json'] }] });
    if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true };
    try {
      return { ok: true, ...backup.importData(store, JSON.parse(fs.readFileSync(res.filePaths[0], 'utf8'))) };
    } catch (err) {
      return fail(err);
    }
  });
  ipcMain.handle('export:json', async () => {
    const stamp = new Date().toISOString().slice(0, 10);
    const res = await dialog.showSaveDialog(win, { defaultPath: `KeyBridge ${stamp}.json`, filters: [{ name: 'KeyBridge', extensions: ['json'] }] });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    try {
      fs.writeFileSync(res.filePath, JSON.stringify(backup.exportData(store), null, 2));
      return { ok: true, count: store.shortcuts().length };
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('settings:set', (_e, patch) => applySettings(patch || {}));

  ipcMain.handle('account:signin', async (_e, email) => {
    try {
      await account.signIn(email);
      return { ok: true };
    } catch (err) {
      // the reason only - Supabase's error code (e.g. over_email_send_rate_limit), never the address
      const code = /^[a-z0-9_]+$/.test(err.detail || '') ? ` ${err.detail}` : '';
      log(`sign-in failed: ${err.code || 'error'}${err.status ? ` ${err.status}` : ''}${code}`);
      return fail(err);
    }
  });
  ipcMain.handle('account:cancel', () => account.cancelSignIn());
  ipcMain.handle('account:code', async (_e, code) => {
    try {
      await account.enterCode(code);
      return { ok: true };
    } catch (err) {
      return fail(err);
    }
  });
  ipcMain.handle('account:show-code', () => account.code);
  ipcMain.handle('account:sync', async () => ({ ok: !!(await account.syncNow()) }));
  ipcMain.handle('account:devices', async () => {
    try {
      return { ok: true, devices: await account.devices() };
    } catch (err) {
      return fail(err);
    }
  });
  ipcMain.handle('account:signout-device', async (_e, id) => {
    try {
      await account.signOutDevice(id);
      return { ok: true };
    } catch (err) {
      return fail(err);
    }
  });
  ipcMain.handle('account:signout', async () => {
    try {
      await account.signOut();
      return { ok: true };
    } catch (err) {
      return fail(err);
    }
  });
  ipcMain.handle('account:delete', async () => {
    try {
      await account.deleteAccount();
      return { ok: true };
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('mac:open-accessibility', () =>
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'),
  );
  ipcMain.handle('app:open-data-dir', () => shell.openPath(app.getPath('userData')));
  ipcMain.handle('app:hide', () => hideWindow());
}

function applySettings(patch) {
  if ('language' in patch && LANGUAGES.some((l) => l.code === patch.language)) {
    settings.set({ language: patch.language });
    tr = createTranslator(patch.language);
    buildAppMenu();
    updateTrayMenu();
  }
  if ('paused' in patch) {
    settings.set({ paused: !!patch.paused });
    engine.setPaused(!!patch.paused);
    updateTrayMenu();
  }
  if ('openAtLogin' in patch) {
    settings.set({ openAtLogin: !!patch.openAtLogin });
    applyLoginItem();
  }
  if ('onboarded' in patch) settings.set({ onboarded: !!patch.onboarded });
  if ('deviceName' in patch) {
    const name = String(patch.deviceName || '').trim().slice(0, 60);
    if (!name) return { ok: false, error: 'name-empty' };
    settings.set({ deviceName: name });
    account.deviceName = name;
  }
  sendState();
  return { ok: true };
}

// The Mac's login item state for Settings ("enabled", "requires-approval"...), read when it's set
// rather than on every state request - asking macOS can be slow.
let loginStatus = null;

function applyLoginItem() {
  if (!app.isPackaged) return;
  try {
    // `args` is Windows-only; it tells this app it was started at login.
    app.setLoginItemSettings({ openAtLogin: !!settings.get('openAtLogin'), args: ['--hidden'] });
    if (isMac) loginStatus = app.getLoginItemSettings().status || null;
  } catch (err) {
    log('login item:', err);
  }
  sendState();
}

// Started at login (as opposed to by the user)? Windows passes --hidden; newer macOS no longer
// reports it, so a launch soon after boot with "open at login" on counts as one.
function launchedAtLogin() {
  if (process.argv.includes('--hidden')) return true;
  if (!isMac) return false;
  if (app.getLoginItemSettings().wasOpenedAtLogin) return true;
  return !!settings.get('openAtLogin') && require('os').uptime() < 180;
}

// ---------- window ----------

function createWindow() {
  const created = Date.now();
  win = new BrowserWindow({
    width: 940,
    height: 640,
    minWidth: 700,
    minHeight: 480,
    show: false,
    title: 'KeyBridge',
    icon: isMac ? undefined : path.join(ASSETS, 'icon.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#14141b' : '#f5f5f8',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // The language goes along so the first paint is already translated.
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), { query: { lang: tr.code } });
  win.webContents.on('console-message', (e) => {
    if (e.level === 'warning' || e.level === 'error') log(`renderer ${e.level}: ${e.message} (${e.sourceId}:${e.lineNumber})`);
  });
  win.webContents.on('render-process-gone', (_e, details) => log('renderer gone:', details.reason));
  win.webContents.on('did-finish-load', () => log(`window: page loaded (${Date.now() - created} ms)`));
  win.webContents.on('did-fail-load', (_e, code, desc, _url, mainFrame) => {
    if (mainFrame) log(`window: page failed to load: ${code} ${desc}`);
  });
  win.webContents.on('preload-error', (_e, _file, err) => log('window: preload failed:', err));
  win.webContents.on('unresponsive', () => log('window: page not responding'));
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      hideWindow();
    }
  });
  win.on('hide', () => helper.send({ cmd: 'record', on: false }));
  // Never navigate away from the app page; links open in the browser.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function showWindow(then) {
  if (!win || win.isDestroyed()) createWindow();
  if (isMac) app.focus({ steal: true });
  const reveal = () => {
    if (win.isDestroyed()) return;
    win.show();
    win.focus();
    if (!win.isVisible()) log('window: show() left it hidden');
    if (then) send(then);
  };
  if (!win.webContents.isLoading()) return reveal();
  // shown once the page is in - or after 5 s whatever happened, so a slow or failed load never
  // leaves an invisible window
  const wc = win.webContents;
  let timer = null;
  const once = () => {
    clearTimeout(timer);
    wc.off('did-finish-load', once);
    wc.off('did-fail-load', once);
    reveal();
  };
  timer = setTimeout(() => {
    let detail = '';
    try {
      detail = ` (waiting for the file: ${wc.isWaitingForResponse()}; running: ${app.getAppMetrics().map((m) => m.type).join(', ')})`;
    } catch {}
    log(`window: page still loading after 5 s${detail} - showing it anyway`);
    once();
  }, 5000);
  wc.once('did-finish-load', once);
  wc.once('did-fail-load', once);
}

function hideWindow() {
  if (win && !win.isDestroyed()) win.hide();
}

function toggleWindow() {
  if (win && !win.isDestroyed() && win.isVisible() && win.isFocused()) hideWindow();
  else showWindow();
}

// ---------- tray ----------

function statusLine() {
  if (settings.get('paused')) return t('trayPausedLine');
  const on = store.active(platform).filter((s) => s.trigger).length;
  return t('trayOnLine', { n: on });
}

function accountLine() {
  const s = account.status();
  if (s.state === 'ready') return s.offline ? t('accOffline') : t('accSynced');
  if (s.state === 'unconfigured') return null;
  return t('accSignedOut');
}

function createTray() {
  let icon;
  if (isMac) {
    icon = nativeImage.createFromPath(path.join(ASSETS, 'trayTemplate.png'));
    icon.setTemplateImage(true);
  } else {
    icon = nativeImage.createFromPath(path.join(ASSETS, 'tray.png'));
  }
  tray = new Tray(icon);
  tray.setToolTip('KeyBridge');
  if (!isMac) tray.on('click', () => toggleWindow());
  updateTrayMenu();
}

let trayTimer = null;
function updateTrayMenu() {
  if (!tray || trayTimer) return;
  trayTimer = setTimeout(() => {
    trayTimer = null;
    buildTrayMenu();
  }, 150);
}

function buildTrayMenu() {
  const status = statusLine();
  const acc = accountLine();
  tray.setToolTip(`KeyBridge - ${status}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: status, enabled: false },
      ...(acc ? [{ label: acc, enabled: false }] : []),
      { type: 'separator' },
      { label: t('trayOpen'), click: () => showWindow() },
      { label: t('trayNew'), click: () => showWindow('ui:new-shortcut') },
      { type: 'separator' },
      {
        label: t('trayPause'),
        type: 'checkbox',
        checked: !!settings.get('paused'),
        click: (item) => applySettings({ paused: item.checked }),
      },
      ...(account.state === 'ready' ? [{ label: t('traySync'), click: () => account.syncNow() }] : []),
      { label: t('traySettings'), click: () => showWindow('ui:open-settings') },
      { type: 'separator' },
      { label: t('trayQuit'), click: () => app.quit() },
    ]),
  );
}

// macOS shows the app's menu while KeyBridge is in front; it also makes copy and paste work in
// text fields. Windows needs none.
function buildAppMenu() {
  if (!isMac) {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { label: t('traySettings'), accelerator: 'Command+,', click: () => showWindow('ui:open-settings') },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { label: t('trayQuit'), accelerator: 'Command+Q', click: () => app.quit() },
        ],
      },
      { role: 'editMenu' },
      { role: 'windowMenu' },
    ]),
  );
}

// ---------- test helper ----------

// KEYBRIDGE_SCREENSHOT=<file.png> saves the window a moment after start (KEYBRIDGE_EXIT_AFTER_CAPTURE quits after).
function captureForTesting(file) {
  setTimeout(async () => {
    try {
      showWindow();
      const image = await win.webContents.capturePage();
      fs.writeFileSync(file, image.toPNG());
      log('captured window to', file);
    } catch (err) {
      log('capture failed', err);
    }
    if (process.env.KEYBRIDGE_EXIT_AFTER_CAPTURE) app.quit();
  }, Number(process.env.KEYBRIDGE_CAPTURE_DELAY) || 3000);
}
