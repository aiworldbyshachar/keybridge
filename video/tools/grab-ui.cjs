'use strict';
// The real KeyBridge window for the film: opens ../src/renderer with the made-up preview data
// (dev/mock-api.js) in each state a scene shows, and saves the rendered markup to assets/ui/<name>.html,
// ready for tools/inject-ui.mjs. Ids become data-id (several scenes hold a copy of the window), hidden
// parts are left out (and the list behind an open sheet), form values become attributes, and the icon
// path points into assets/img.
//   node tools/grab-ui.cjs            (all of them)
//   node tools/grab-ui.cjs win-list   (just one)
const fs = require('fs');
const path = require('path');

const repo = path.join(__dirname, '..', '..');
const page = path.join(repo, 'src', 'renderer', 'index.html');
const out = path.join(__dirname, '..', 'assets', 'ui');

const tidy = "await api.removeShortcut('s11');";
const hebrew = `${tidy}
  const st = await api.getState();
  const groups = { g1: 'אישי', g2: 'עבודה', g3: 'קישורים' };
  for (const g of st.groups) if (groups[g.id]) await api.saveGroup({ ...g, name: groups[g.id] });
  const named = {
    s1: ['מייל'], s2: ['כתובת', 'הרצל 12, תל אביב'], s3: ['טלפון'], s4: ['חתימה', 'בברכה,\\nדנה לוי'],
    s5: ['תשובה לפגישה', 'תודה! {cursor} מתאים לי.'], s7: ['יומן הצוות'], s8: ['חשבוניות'], s9: ['מחשבון'], s10: ['התאריך היום'],
  };
  for (const s of st.shortcuts) if (named[s.id]) await api.saveShortcut({ ...s, name: named[s.id][0], text: named[s.id][1] || s.text });`;

const STATES = [
  { name: 'win-list', query: {} },
  { name: 'mac-list', query: { platform: 'darwin' } },
  { name: 'mac-signin', query: { platform: 'darwin', account: 'signed-out', sheet: 'account' } },
  { name: 'mac-code', query: { platform: 'darwin', account: 'code', sheet: 'account' } },
  { name: 'win-trash', query: { sheet: 'trash' } },
  { name: 'lang-en', query: { lang: 'en' } },
  { name: 'lang-he', query: { lang: 'he' }, run: hebrew },
  { name: 'lang-es', query: { lang: 'es' } },
  { name: 'lang-fr', query: { lang: 'fr' } },
  { name: 'lang-ru', query: { lang: 'ru' } },
  { name: 'lang-ar', query: { lang: 'ar' } },
];

// runs in the page: the rendered window as plain markup
const SERIALIZE = `(() => {
  const root = document.body.cloneNode(true);
  const live = document.body.querySelectorAll('input, textarea, select');
  const copy = root.querySelectorAll('input, textarea, select');
  live.forEach((el, i) => {
    const c = copy[i];
    if (el.type === 'checkbox' || el.type === 'radio') { if (el.checked) c.setAttribute('checked', ''); else c.removeAttribute('checked'); }
    else if (el.tagName === 'TEXTAREA') c.textContent = el.value;
    else if (el.tagName === 'SELECT') [...c.options].forEach((o, j) => { if (j === el.selectedIndex) o.setAttribute('selected', ''); else o.removeAttribute('selected'); });
    else if (el.value) c.setAttribute('value', el.value);
  });
  root.querySelectorAll('script, [hidden]').forEach((el) => el.remove());
  // an open sheet covers the whole window: the list behind it isn't seen, so it isn't kept
  if (root.querySelector('.sheet')) root.querySelectorAll('.app, .banners').forEach((el) => el.remove());
  root.querySelectorAll('[id]').forEach((el) => { el.setAttribute('data-id', el.id); el.removeAttribute('id'); });
  root.querySelectorAll('[for], [aria-labelledby], [aria-controls], [aria-describedby]').forEach((el) => ['for', 'aria-labelledby', 'aria-controls', 'aria-describedby'].forEach((a) => el.removeAttribute(a)));
  root.querySelectorAll('img[src]').forEach((el) => el.setAttribute('src', 'assets/img/' + el.getAttribute('src').split('/').pop()));
  const html = document.documentElement;
  return JSON.stringify({ dir: html.dir || 'ltr', lang: html.lang || 'en', markup: root.innerHTML.replace(/\\n\\s*\\n+/g, '\\n') });
})()`;

const only = process.argv.slice(2).filter((a) => !a.startsWith('-') && !a.endsWith('.cjs'));

if (!process.versions.electron) {
  // started with node: one short Electron run per state (one run stalls after a few page loads)
  const { spawnSync } = require('child_process');
  const electron = require(path.join(repo, 'node_modules', 'electron'));
  for (const name of only.length ? only : STATES.map((s) => s.name)) {
    const r = spawnSync(electron, [__filename, name], { stdio: 'inherit', timeout: 60000 });
    if (r.status !== 0) console.error(`${name}: ${r.error ? r.error.message : `exit ${r.status}`}`);
  }
  return;
}

const { app, BrowserWindow, nativeTheme } = require('electron');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  nativeTheme.themeSource = 'light';
  fs.mkdirSync(out, { recursive: true });
  const win = new BrowserWindow({ width: 940, height: 640, useContentSize: true, show: false, webPreferences: { backgroundThrottling: false } });
  for (const state of STATES.filter((s) => only.includes(s.name))) {
    try {
      await win.loadFile(page, { query: state.query });
      await wait(700);
      await win.webContents.executeJavaScript(`(async () => { ${state.run || tidy} })()`);
      await wait(900);
      const { dir, lang, markup } = JSON.parse(await win.webContents.executeJavaScript(SERIALIZE));
      const file = path.join(out, `${state.name}.html`);
      fs.writeFileSync(file, `<!-- ${JSON.stringify({ state: state.name, dir, lang })} -->\n${markup.trim()}\n`);
      console.log(`${state.name}.html ${Math.round(fs.statSync(file).size / 1024)} KB`);
    } catch (err) {
      console.error(`${state.name}: ${err.message}`);
    }
  }
  app.quit();
});
