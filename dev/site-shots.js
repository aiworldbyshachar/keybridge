'use strict';
// The site's pictures of the app, taken from the real window: it opens src/renderer with the made-up
// preview data (dev/mock-api.js - no real shortcuts) in each state the site shows, at the app's own
// size (940 x 640, drawn at 2x; the narrow sheets at 720, near the window's smallest), and saves them
// to docs/media as JPEG.
//   node dev/site-shots.js            (all of them)
//   node dev/site-shots.js editor     (just one)
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'docs', 'media');
const page = path.join(root, 'src', 'renderer', 'index.html');
const W = 940;
const H = 640;

// the made-up "Old email" shares its keys with "Email" (it shows the Clash badge) - the pictures leave it out
const tidy = "await api.removeShortcut('s11');";
// the same made-up list as a Hebrew speaker would have it
const hebrew = `${tidy}
  const st = await api.getState();
  const groups = { g1: 'אישי', g2: 'עבודה', g3: 'קישורים' };
  for (const g of st.groups) if (groups[g.id]) await api.saveGroup({ ...g, name: groups[g.id] });
  const named = {
    s1: ['מייל'], s2: ['כתובת', 'הרצל 12, תל אביב'], s3: ['טלפון'], s4: ['חתימה', 'בברכה,\\nדנה לוי'],
    s5: ['תשובה לפגישה', 'תודה! {cursor} מתאים לי.'], s7: ['יומן הצוות'], s8: ['חשבוניות'], s9: ['מחשבון'], s10: ['התאריך היום'],
  };
  for (const s of st.shortcuts) if (named[s.id]) await api.saveShortcut({ ...s, name: named[s.id][0], text: named[s.id][1] || s.text });`;

const SHOTS = [
  { name: 'shortcuts', query: {} },
  { name: 'editor', query: { sheet: 'editor' } },
  { name: 'account', query: { sheet: 'account' }, width: 720 },
  { name: 'code', query: { sheet: 'code' } },
  { name: 'trash', query: { sheet: 'trash' }, width: 720, height: 300 },
  { name: 'settings', query: { sheet: 'settings' }, width: 720 },
  { name: 'hebrew', query: { lang: 'he' }, run: hebrew },
  { name: 'mac', query: { platform: 'darwin' } },
];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// drawn through the DevTools protocol, so the size doesn't depend on the screen
async function take(win, shot) {
  const cdp = win.webContents.debugger;
  const width = shot.width || W;
  await cdp.sendCommand('Emulation.setDeviceMetricsOverride', { width, height: H, deviceScaleFactor: 2, mobile: false });
  await win.loadFile(page, { query: shot.query });
  // scrollbars stay out of the pictures (the Mac hides them anyway)
  await win.webContents.insertCSS('::-webkit-scrollbar { display: none; }');
  await wait(700);
  await win.webContents.executeJavaScript(`(async () => { ${shot.run || tidy} })()`);
  await wait(900);
  const clip = { x: 0, y: 0, width, height: shot.height || H, scale: 1 };
  const { data } = await cdp.sendCommand('Page.captureScreenshot', { format: 'jpeg', quality: 90, clip });
  const file = path.join(out, `${shot.name}.jpg`);
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  console.log(`${shot.name}.jpg ${Math.round(fs.statSync(file).size / 1024)} KB`);
}

const only = process.argv.slice(2).filter((a) => !a.startsWith('-') && !a.endsWith('.js'));

if (!process.versions.electron) {
  // started with node: one short Electron run per picture (one run stalls after a few page loads)
  const { spawnSync } = require('child_process');
  const electron = require('electron'); // from node, the path to Electron itself
  for (const name of only.length ? only : SHOTS.map((s) => s.name)) {
    const r = spawnSync(electron, [__filename, name], { stdio: 'inherit', timeout: 60000 });
    if (r.status !== 0) console.error(`${name}: ${r.error ? r.error.message : `exit ${r.status}`}`);
  }
  return;
}

const { app, BrowserWindow, nativeTheme } = require('electron');

app.whenReady().then(async () => {
  nativeTheme.themeSource = 'light';
  fs.mkdirSync(out, { recursive: true });
  const win = new BrowserWindow({ width: W, height: H, useContentSize: true, show: false, webPreferences: { backgroundThrottling: false } });
  await win.loadURL('about:blank');
  win.webContents.debugger.attach('1.3');
  for (const shot of SHOTS.filter((s) => !only.length || only.includes(s.name))) {
    try {
      await take(win, shot);
    } catch (err) {
      console.error(`${shot.name}: ${err.message}`);
    }
  }
  app.quit();
});
