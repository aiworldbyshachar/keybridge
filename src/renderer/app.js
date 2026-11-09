'use strict';

(async function main() {
  const I18N = window.KeyBridgeI18n;
  const K = window.KeyBridgeKeys;
  let tr = I18N.createTranslator(new URLSearchParams(location.search).get('lang') || 'en');
  const t = (key, vars) => tr.t(key, vars);

  // Locale-aware formatters, rebuilt whenever the language changes.
  let fmt = {};
  function buildFormatters() {
    fmt = {
      rtf: new Intl.RelativeTimeFormat(tr.code, { numeric: 'auto' }),
      dateTime: new Intl.DateTimeFormat(tr.code, { dateStyle: 'medium', timeStyle: 'short' }),
      list: new Intl.ListFormat(tr.code, { type: 'conjunction' }),
    };
  }

  // Static text in the page carries data-i18n* attributes.
  function translatePage() {
    document.documentElement.lang = tr.code;
    document.documentElement.dir = tr.dir;
    for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
    for (const el of document.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
    for (const el of document.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
    for (const el of document.querySelectorAll('[data-i18n-title]')) {
      el.title = t(el.dataset.i18nTitle);
      el.setAttribute('aria-label', el.title);
    }
  }

  buildFormatters();
  translatePage();

  // Outside Electron (design preview in a browser) a mock API stands in.
  if (!window.api) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '../../dev/mock-api.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  const api = window.api;
  const plat = api.platform === 'darwin' ? 'mac' : 'win';
  const otherPlat = plat === 'mac' ? 'win' : 'mac';
  const isMac = plat === 'mac';

  const GROUP_COLORS = ['#5550d8', '#0e9f6e', '#d97706', '#db2777', '#0891b2', '#65a30d', '#dc2626', '#7c3aed'];

  const ICONS = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    settings: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    back: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    trash: '<path d="M4 7h16M9 7V4.5h6V7M18 7l-.8 12.5a1.5 1.5 0 0 1-1.5 1.5H8.3a1.5 1.5 0 0 1-1.5-1.5L6 7M10 11v6M14 11v6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    pause: '<path d="M9 6v12M15 6v12"/>',
    play: '<path d="M8 5.5v13l10-6.5z"/>',
    text: '<path d="M5 6h14M5 11h14M5 16h9"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    file: '<path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4.2l2 2H19a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z"/>',
    program: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9h17M7 6.8h.1M9.5 6.8h.1"/>',
    warn: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17.2v.1"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.1"/>',
    sync: '<path d="M20 12a8 8 0 0 1-14.2 5M4 12a8 8 0 0 1 14.2-5"/><path d="M18.5 3v4h-4M5.5 21v-4h4"/>',
    laptop: '<rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19.5h20"/>',
    desktop: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8.5 20h7M12 16v4"/>',
    key: '<rect x="3" y="6" width="18" height="12" rx="2.5"/><path d="M7 10h.1M10.5 10h.1M14 10h.1M17 10h.1M8 14h8"/>',
    lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
    more: '<circle cx="6" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18" cy="12" r="1.3"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m4 7 8 6 8-6"/>',
  };
  const KIND_ICON = { text: 'text', link: 'link', file: 'file', program: 'program' };

  const svg = (name) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;

  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  // The account code box: the XXXX-XXXX-XXXX template shows faintly behind what's typed, letters
  // become capitals and the hyphens come by themselves, so the cursor jumps to the next group of 4.
  const CODE_TEMPLATE = 'XXXX-XXXX-XXXX';
  function formatCodeInput(text, open) {
    const n = String(text).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
    const v = (n.match(/.{1,4}/g) || []).join('-');
    // a full group gets its hyphen at once - but not while deleting, or backspace would be stuck
    return open && n.length && n.length < 12 && n.length % 4 === 0 ? v + '-' : v;
  }

  function codeField() {
    const input = h('input', { id: 'code-input', dir: 'ltr', class: 'code-input', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'characters', 'aria-label': t('accCodeTitle') });
    const typed = h('span', { class: 'typed' });
    const rest = h('span', null, CODE_TEMPLATE);
    const box = h('span', { class: 'code-box', dir: 'ltr' }, input, h('span', { class: 'code-ghost', 'aria-hidden': 'true' }, typed, rest));
    input.addEventListener('input', (e) => {
      const deleting = /^delete/.test(e.inputType || '');
      const caret = input.selectionStart == null ? input.value.length : input.selectionStart;
      const before = input.value.slice(0, caret).replace(/[^A-Za-z0-9]/g, '').length;
      const v = formatCodeInput(input.value, !deleting);
      // the cursor stays after the same letters, and hops over a hyphen that follows them
      let pos = 0;
      for (let seen = 0; pos < v.length && seen < before; pos++) if (v[pos] !== '-') seen++;
      if (!deleting && v[pos] === '-') pos++;
      input.value = v;
      input.setSelectionRange(pos, pos);
      typed.textContent = v;
      rest.textContent = CODE_TEMPLATE.slice(v.length);
    });
    return { box, input };
  }

  const $ = (sel) => document.querySelector(sel);
  const icon = (name) => h('span', { class: 'ic', html: svg(name) });
  for (const el of document.querySelectorAll('[data-icon]')) el.innerHTML = svg(el.dataset.icon);

  const S = {
    app: null,
    group: 'all',
    q: '',
    draft: null, // the shortcut in the editor
    recording: false,
    check: null,
    welcomeShown: false,
  };

  // ---------- formatting ----------

  function ago(ts) {
    if (!ts) return t('never');
    const s = Math.round((ts - Date.now()) / 1000);
    if (s > -45) return t('justNow');
    if (s > -3600) return fmt.rtf.format(Math.round(s / 60), 'minute');
    if (s > -86400) return fmt.rtf.format(Math.round(s / 3600), 'hour');
    return fmt.dateTime.format(ts);
  }

  function toast(text) {
    const el = $('#toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  const errorText = (code) => {
    const key = `err_${String(code || '').replace(/[^a-z0-9]+/gi, '_')}`;
    const text = t(key);
    return text === key ? t('errGeneric', { reason: code }) : text;
  };

  // ---------- triggers on screen ----------

  // [Right Shift] + [A], always left to right like the keyboard
  function comboView(combo, platform = plat) {
    if (!combo) return null;
    const parts = combo.mods.map((m) => {
      const { side, base } = K.modifierParts(m, platform);
      return h('kbd', { class: 'cap' }, side ? h('small', null, t(side === 'left' ? 'sideLeft' : 'sideRight')) : null, h('span', null, base));
    });
    parts.push(h('kbd', { class: 'cap key' }, h('span', null, K.keyLabel(combo.key, platform))));
    const out = h('span', { class: 'combo', dir: 'ltr' });
    parts.forEach((p, i) => {
      if (i) out.append(h('span', { class: 'plus' }, '+'));
      out.append(p);
    });
    return out;
  }

  function triggerView(trigger) {
    if (!trigger) return h('span', { class: 'no-trigger' }, t('noTrigger'));
    if (trigger.type === 'abbrev') return h('span', { class: 'combo', dir: 'ltr' }, h('kbd', { class: 'cap abbr' }, h('span', null, trigger.text)));
    return comboView(trigger[plat] || trigger);
  }

  // Plain words for search and screen readers: "Right Shift + A"
  function triggerWords(trigger) {
    if (!trigger) return '';
    if (trigger.type === 'abbrev') return trigger.text;
    const c = trigger[plat] || trigger;
    return [...c.mods.map((m) => {
      const { side, base } = K.modifierParts(m, plat);
      return side ? t(side === 'left' ? 'keyLeft' : 'keyRight', { key: base }) : base;
    }), K.keyLabel(c.key, plat)].join(' + ');
  }

  function preview(s) {
    if (s.kind === 'text') return s.text.split('\n')[0] || '';
    if (s.kind === 'link') return s.url;
    return s.path[plat] || s.path[otherPlat] || '';
  }

  const syncedText = (a) => (a.lastSync ? t('accSyncedAt', { when: ago(a.lastSync) }) : t('accNotSynced'));

  const groupOf = (s) => (s.groupId && S.app.groups.find((g) => g.id === s.groupId)) || null;
  // the sidebar line for shortcuts outside every group (none chosen, or theirs is gone)
  const UNASSIGNED = 'unassigned';
  const inView = (s) => S.group === 'all' || (S.group === UNASSIGNED ? !groupOf(s) : s.groupId === S.group);
  const isActive = (s) => s.enabled && (s.platforms === 'all' || s.platforms === plat) && !(groupOf(s) && !groupOf(s).enabled);

  // ---------- top bar, banners ----------

  function renderTop() {
    const a = S.app.account;
    const el = $('#status');
    el.className = 'status';
    let label;
    if (a.state === 'unconfigured') label = t('accLocal');
    else if (a.state === 'ready') {
      el.classList.add(a.offline ? 'paused' : 'online');
      label = a.offline ? t('accOffline') : t('accSynced');
    } else if (a.state === 'waiting-for-link' || a.state === 'needs-code') {
      el.classList.add('searching');
      label = t('accFinish');
    } else label = t('accSignedOut');
    el.querySelector('.status-label').textContent = label;
    el.title = a.state === 'ready' ? syncedText(a) : t('accountTitle');

    const paused = S.app.settings.paused;
    const pause = $('#pause');
    pause.innerHTML = svg(paused ? 'play' : 'pause');
    pause.append(h('span', null, t(paused ? 'resume' : 'pause')));
    pause.classList.toggle('on', paused);
    pause.title = t(paused ? 'resumeHint' : 'pauseHint');
  }

  function banner(kind, title, body, actions = []) {
    return h('div', { class: `banner ${kind}` },
      icon(kind === 'info' ? 'info' : 'warn'),
      h('div', { class: 'banner-text' }, h('b', null, title), body ? h('small', null, body) : null),
      ...actions);
  }

  function renderBanners() {
    const el = $('#banners');
    el.replaceChildren();
    const hs = S.app.helper;
    if (isMac && hs.permission === false) {
      el.append(banner('warn', t('bnPermTitle'), t('bnPermBody'), [h('button', { class: 'btn small primary', type: 'button', onclick: () => api.openAccessibility() }, t('bnPermOpen'))]));
    } else if (hs.error) {
      el.append(banner('warn', t('bnHelperTitle'), hs.error));
    }
    if (S.app.settings.paused) {
      el.append(banner('info', t('bnPausedTitle'), t('bnPausedBody'), [h('button', { class: 'btn small', type: 'button', onclick: () => setPaused(false) }, t('resume'))]));
    }
  }

  // ---------- sidebar ----------

  function renderGroups() {
    const nav = $('#groups');
    nav.replaceChildren();
    const all = S.app.shortcuts;
    const item = (id, name, count, mark, g) =>
      h('div', { class: 'group-item', 'aria-pressed': String(S.group === id) },
        h('button', { class: 'group-pick', type: 'button', onclick: () => pickGroup(id) },
          mark,
          h('span', { class: 'group-name' }, name),
          h('span', { class: 'group-count' }, count)),
        g ? h('button', { class: 'icon-btn tiny', type: 'button', title: t('groupEdit'), 'aria-label': t('groupEdit'), html: svg('more'), onclick: () => openGroupDialog(g) }) : null);
    nav.append(item('all', t('allShortcuts'), all.length, icon('key')));
    // without groups it would list the same as "All shortcuts"
    if (S.app.groups.length) nav.append(item(UNASSIGNED, t('noGroup'), all.filter((s) => !groupOf(s)).length, h('span', { class: 'swatch none' })));
    for (const g of S.app.groups) {
      nav.append(item(g.id, g.name || t('groupUnnamed'), all.filter((s) => s.groupId === g.id).length,
        h('span', { class: `swatch${g.enabled ? '' : ' off'}`, 'data-color': g.color || GROUP_COLORS[0] }), g));
    }
    for (const sw of nav.querySelectorAll('.swatch[data-color]')) sw.style.setProperty('--c', sw.dataset.color);
  }

  function pickGroup(id) {
    S.group = id;
    renderGroups();
    renderList();
  }

  function renderAccountCard() {
    const a = S.app.account;
    const el = $('#account-card');
    el.replaceChildren();
    if (a.state === 'unconfigured') {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    if (a.state === 'ready') {
      el.append(h('button', { class: 'acc-row', type: 'button', onclick: openAccount },
        h('span', { class: 'avatar' }, (a.email || '?')[0].toUpperCase()),
        h('span', { class: 'acc-text' }, h('b', { dir: 'ltr' }, a.email), h('small', null, a.offline ? t('accOffline') : syncedText(a)))));
      return;
    }
    const busy = a.state === 'waiting-for-link' || a.state === 'needs-code';
    el.append(
      h('p', null, h('b', null, t(busy ? 'accFinish' : 'cardTitle')), h('small', null, t(a.state === 'waiting-for-link' ? 'cardWaiting' : a.state === 'needs-code' ? 'cardNeedsCode' : 'cardBody'))),
      h('button', { class: 'btn small primary', type: 'button', onclick: openAccount }, t(busy ? 'cardContinue' : 'signIn')),
    );
  }

  // ---------- the list ----------

  function matches(s, q) {
    if (!q) return true;
    const hay = [s.name, s.text, s.url, s.path.win, s.path.mac, triggerWords(s.trigger), s.trigger && s.trigger.type === 'abbrev' ? s.trigger.text : '']
      .join('\n').toLocaleLowerCase(tr.code);
    return hay.includes(q);
  }

  function visibleShortcuts() {
    const q = S.q.trim().toLocaleLowerCase(tr.code);
    return S.app.shortcuts.filter((s) => inView(s) && matches(s, q));
  }

  function row(s) {
    const active = isActive(s);
    const flags = [];
    if (S.app.conflicts[s.id]) flags.push(h('span', { class: 'badge warn', title: t('clashWith', { names: namesOf(S.app.conflicts[s.id]) }) }, t('badgeClash')));
    if (S.app.invalid[s.id]) flags.push(h('span', { class: 'badge warn', title: t('badgeNotHereHint') }, t('badgeNotHere')));
    const open = S.app.attention[s.id];
    if (open) flags.push(h('span', { class: 'badge warn', title: `${noteText(open.note, open.platform)} ${t('badgeChooseHint')}` }, t('badgeChoose')));
    if (s.platforms !== 'all') flags.push(h('span', { class: 'badge' }, t(s.platforms === 'mac' ? 'scopeMacShort' : 'scopeWinShort')));
    const g = groupOf(s);
    if (g && !g.enabled) flags.push(h('span', { class: 'badge' }, t('badgeGroupOff')));
    const title = s.name || preview(s) || t('untitled');
    const sub = s.name ? preview(s) : t(`kind_${s.kind}`);
    const toggle = h('label', { class: 'toggle mini', title: t(s.enabled ? 'turnOff' : 'turnOn'), onclick: (e) => e.stopPropagation() },
      h('input', { type: 'checkbox', checked: s.enabled, 'aria-label': t('edOn'), onchange: (e) => api.enableShortcut(s.id, e.target.checked) }),
      h('span', { class: 'track' }));
    return h('div', { class: `row${active ? '' : ' inactive'}${open ? ' attention' : ''}`, role: 'button', tabindex: '0', 'aria-label': `${triggerWords(s.trigger)} - ${title}`, onclick: () => openEditor(s), onkeydown: (e) => {
      if (e.key === 'Enter') openEditor(s);
    } },
      h('div', { class: 'row-trigger' }, triggerView(s.trigger)),
      h('div', { class: 'row-main' },
        h('b', null, h('bdi', null, title)),
        h('small', null, icon(KIND_ICON[s.kind]), h('span', null, h('bdi', null, sub)))),
      h('div', { class: 'row-flags' }, flags),
      toggle);
  }

  const namesOf = (ids) => fmt.list.format(ids.map((id) => {
    const s = S.app.shortcuts.find((x) => x.id === id);
    return s ? s.name || preview(s) || t('untitled') : '?';
  }));

  function renderList() {
    const list = $('#list');
    const items = visibleShortcuts();
    list.replaceChildren();
    if (!S.app.shortcuts.length) {
      list.append(h('div', { class: 'empty' },
        icon('key'),
        h('b', null, t('emptyTitle')),
        h('p', null, t('emptyBody')),
        h('div', { class: 'row-actions center' },
          h('button', { class: 'btn primary', type: 'button', onclick: () => openEditor(null) }, t('newShortcut')),
          S.app.clavier.exists ? h('button', { class: 'btn', type: 'button', onclick: importClavier }, t('importClavierN', { n: S.app.clavier.count })) : null)));
    } else if (!items.length) {
      list.append(h('div', { class: 'empty' }, h('p', null, t(S.q ? 'noMatches' : S.group === UNASSIGNED ? 'noGroupEmpty' : 'groupEmpty'))));
    } else {
      for (const s of items) list.append(row(s));
    }
    renderFooter(items.length);
  }

  function renderFooter(shown) {
    const all = S.app.shortcuts;
    const on = all.filter(isActive).length;
    $('#count').textContent = shown === all.length ? t('countAll', { n: all.length, on }) : t('countShown', { n: shown, total: all.length });
    $('#footer-hint').textContent = '';
  }

  // ---------- the editor ----------

  const els = {
    editor: $('#editor'),
    scrim: $('#editor-scrim'),
    recorder: $('#recorder'),
    recorderValue: $('#recorder-value'),
    record: $('#record'),
    notes: $('#trigger-notes'),
    abbrev: $('#abbrev'),
    text: $('#text'),
  };

  function blankDraft() {
    return { id: null, kind: 'text', name: '', text: '', url: '', path: { win: '', mac: '' }, args: '', trigger: null, platforms: 'all', groupId: S.app.groups.some((g) => g.id === S.group) ? S.group : '', enabled: true };
  }

  function openEditor(s) {
    stopRecording();
    S.draft = s ? structuredClone(s) : blankDraft();
    S.check = null;
    $('#editor-title').textContent = t(s ? 'editShortcut' : 'newShortcut');
    $('#name').value = S.draft.name;
    els.text.value = S.draft.text;
    $('#url').value = S.draft.url;
    $('#path-win').value = S.draft.path.win;
    $('#path-mac').value = S.draft.path.mac;
    $('#args').value = S.draft.args;
    $('#platforms').value = S.draft.platforms;
    $('#enabled').checked = S.draft.enabled;
    const groups = $('#group');
    groups.replaceChildren(h('option', { value: '' }, t('noGroup')), ...S.app.groups.map((g) => h('option', { value: g.id }, g.name || t('groupUnnamed'))));
    groups.value = S.draft.groupId || '';
    els.abbrev.value = S.draft.trigger && S.draft.trigger.type === 'abbrev' ? S.draft.trigger.text : '';
    $('#delete-shortcut').hidden = !s;
    $('#duplicate-shortcut').hidden = !s;
    resetConfirm($('#delete-shortcut'));
    showMsg('#editor-msg', '');
    setTriggerType(S.draft.trigger && S.draft.trigger.type === 'abbrev' ? 'abbrev' : 'hotkey');
    setKind(S.draft.kind);
    els.editor.hidden = false;
    els.scrim.hidden = false;
    checkTrigger();
    // a new shortcut starts with the keys
    if (!s) setTimeout(() => startRecording(), 50);
    else $('#close-editor').focus();
  }

  function closeEditor() {
    stopRecording();
    els.editor.hidden = true;
    els.scrim.hidden = true;
    S.draft = null;
  }

  function setTriggerType(type) {
    for (const b of document.querySelectorAll('#trigger-type button')) b.setAttribute('aria-pressed', String(b.dataset.value === type));
    $('#hotkey-box').hidden = type !== 'hotkey';
    $('#abbrev-box').hidden = type !== 'abbrev';
    S.triggerType = type;
    if (type === 'abbrev') {
      stopRecording();
      S.draft.trigger = els.abbrev.value ? { type: 'abbrev', text: els.abbrev.value } : null;
    } else if (S.draft.trigger && S.draft.trigger.type !== 'hotkey') {
      S.draft.trigger = null;
    }
    renderRecorder();
    checkTrigger();
  }

  function setKind(kind) {
    S.draft.kind = kind;
    for (const b of document.querySelectorAll('#kind button')) b.setAttribute('aria-pressed', String(b.dataset.value === kind));
    $('#text-box').hidden = kind !== 'text';
    $('#link-box').hidden = kind !== 'link';
    $('#path-box').hidden = kind !== 'file' && kind !== 'program';
    $('#args-field').hidden = kind !== 'program';
    // the chooser opens this computer's files only
    $(`#choose-${otherPlat}`).hidden = true;
    $(`#choose-${plat}`).hidden = false;
    updateTextMode();
  }

  function updateTextMode() {
    const text = els.text.value;
    $('#text-mode').textContent = !text ? '' : text.length > 200 || text.includes('\n') ? t('modePasted') : t('modeTyped');
  }

  function renderRecorder() {
    const v = els.recorderValue;
    v.replaceChildren();
    const trig = S.draft && S.draft.trigger && S.draft.trigger.type === 'hotkey' ? S.draft.trigger : null;
    els.recorder.classList.toggle('recording', S.recording);
    if (S.recording) v.append(h('span', { class: 'hint' }, t('edPressKeys')));
    else if (trig) v.append(comboView(trig));
    else v.append(h('span', { class: 'hint' }, t('edNoHotkey')));
    els.record.textContent = S.recording ? t('cancel') : t(trig ? 'edRecordAgain' : 'edRecord');
    $('#clear-trigger').hidden = !trig || S.recording;
  }

  // Recording: the keyboard helper takes the next key press (with its left/right modifiers) and
  // reports it - so what's recorded is exactly what it will match. Without the helper (browser
  // preview) the window's own key events stand in.
  async function startRecording() {
    if (!S.draft || S.triggerType !== 'hotkey') return;
    S.recording = true;
    renderRecorder();
    const res = await api.record(true);
    S.domRecording = !(res && res.ok);
    els.recorder.focus();
  }

  function stopRecording() {
    if (!S.recording) return;
    S.recording = false;
    S.domRecording = false;
    S.held = new Set();
    api.record(false);
    renderRecorder();
  }

  function recorded({ mods, key }) {
    if (!S.recording) return;
    S.recording = false;
    S.domRecording = false;
    if (key === 'Escape' && !mods.length) return renderRecorder();
    if (!key) {
      renderRecorder();
      return toast(t('edKeyUnsupported'));
    }
    S.draft.trigger = { type: 'hotkey', mods, key };
    renderRecorder();
    checkTrigger();
  }

  // the browser stand-in for the helper's recording
  const MOD_CODES = K.SIDED_MODIFIERS;
  S.held = new Set();
  window.addEventListener('keydown', (e) => {
    if (!S.recording || !S.domRecording) return;
    e.preventDefault();
    e.stopPropagation();
    if (MOD_CODES.includes(e.code)) return S.held.add(e.code);
    // a modifier flag without its own key press (some tools send those) counts as the left key
    const flags = { Shift: e.shiftKey, Control: e.ctrlKey, Alt: e.altKey, Meta: e.metaKey };
    for (const [base, on] of Object.entries(flags)) {
      if (on && ![...S.held].some((m) => m.startsWith(base))) S.held.add(`${base}Left`);
    }
    recorded({ mods: K.MODIFIER_ORDER.filter((m) => S.held.has(m)), key: K.isKey(e.code) ? e.code : '' });
    S.held = new Set();
  }, true);
  window.addEventListener('keyup', (e) => S.held.delete(e.code), true);

  let checkTimer = null;
  function checkTrigger() {
    clearTimeout(checkTimer);
    checkTimer = setTimeout(async () => {
      if (!S.draft) return;
      const trig = S.draft.trigger;
      S.check = trig ? await api.checkTrigger(trig, S.draft.id, $('#platforms').value) : null;
      renderNotes();
    }, 120);
  }

  function note(kind, ...content) {
    return h('div', { class: `note ${kind}` }, icon(kind === 'error' || kind === 'warn' ? 'warn' : 'info'), h('div', null, ...content));
  }

  const SYSTEM = { win: 'Windows', mac: 'Mac' };

  function noteText(n, p) {
    if (n === 'mac-no-right-control') return t('noteMacRightControl');
    if (n === 'win-no-right-win') return t('noteWinRightWin');
    return t('noteKeyMissing', { system: SYSTEM[p] });
  }

  const sameCombo = (a, b) => a.key === b.key && a.mods.join() === b.mods.join();

  function renderNotes() {
    const box = els.notes;
    box.replaceChildren();
    const c = S.check;
    if (!c || !S.draft || !S.draft.trigger) return;
    if (c.error) {
      box.append(note('error', t(`trig_${c.error.replace(/-/g, '_')}`)));
      return;
    }
    const trig = S.draft.trigger;
    if (trig.type === 'hotkey') {
      for (const p of [plat, otherPlat]) {
        const n = c.notes && c.notes[p];
        const override = trig[p];
        if (override && sameCombo(override, trig)) {
          // "Ignore" was chosen: the same keys there
          box.append(note('info', t('noteKept', { system: SYSTEM[p] }), ' ', comboView(override, p), ' ',
            h('button', { class: 'link', type: 'button', onclick: () => setOverride(p, null) }, t('noteUndo'))));
        } else if (override) {
          box.append(note('info', t('noteOverride', { system: SYSTEM[p] }), ' ', comboView(override, p), ' ',
            h('button', { class: 'link', type: 'button', onclick: () => setOverride(p, null) }, t('noteOverrideRemove'))));
        } else if (n) {
          // stays marked, here and in the list, until "Use it" or "Ignore"
          const sug = n !== 'key-missing' && c.suggestions && c.suggestions[p];
          box.append(note('warn attention', h('b', null, noteText(n, p)),
            h('div', { class: 'note-action' },
              sug ? [t('noteUseInstead', { system: SYSTEM[p] }), ' ', comboView(sug, p), ' ',
                h('button', { class: 'btn small primary', type: 'button', onclick: () => setOverride(p, sug) }, t('noteUseIt'))] : null,
              h('button', { class: 'btn small', type: 'button', onclick: () => setOverride(p, { mods: trig.mods, key: trig.key }) }, t('noteIgnore')))));
        }
      }
      for (const w of (c.warnings && c.warnings[plat]) || []) box.append(note('warn', t(`warn_${w.replace(/-/g, '_')}`)));
    } else {
      box.append(note('info', t('noteAbbrev')));
    }
    if (c.clashes && c.clashes.length) box.append(note('warn', t('clashWith', { names: namesOf(c.clashes) })));
  }

  function setOverride(p, combo) {
    if (!S.draft.trigger || S.draft.trigger.type !== 'hotkey') return;
    if (combo) S.draft.trigger[p] = combo;
    else delete S.draft.trigger[p];
    renderRecorder();
    checkTrigger();
  }

  function insertVariable(name) {
    const ta = els.text;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const token = `{${name}}`;
    ta.value = ta.value.slice(0, start) + token + ta.value.slice(end);
    ta.focus();
    ta.selectionStart = ta.selectionEnd = start + token.length;
    updateTextMode();
  }

  function collect() {
    const d = S.draft;
    return {
      id: d.id || undefined,
      kind: d.kind,
      name: $('#name').value.trim(),
      text: els.text.value,
      url: $('#url').value.trim(),
      path: { win: $('#path-win').value.trim(), mac: $('#path-mac').value.trim() },
      args: $('#args').value,
      trigger: S.triggerType === 'abbrev' ? (els.abbrev.value ? { type: 'abbrev', text: els.abbrev.value } : null) : d.trigger,
      platforms: $('#platforms').value,
      groupId: $('#group').value,
      enabled: $('#enabled').checked,
    };
  }

  async function saveShortcut() {
    stopRecording();
    const f = collect();
    const missing = (f.kind === 'text' && !f.text) || (f.kind === 'link' && !f.url) || ((f.kind === 'file' || f.kind === 'program') && !f.path.win && !f.path.mac);
    if (missing) return showMsg('#editor-msg', t(`edNeed_${f.kind}`), 'error');
    if (S.check && S.check.error) return showMsg('#editor-msg', t(`trig_${S.check.error.replace(/-/g, '_')}`), 'error');
    const res = await api.saveShortcut(f);
    if (!res.ok) return showMsg('#editor-msg', errorText(res.error), 'error');
    closeEditor();
    toast(t(f.trigger ? 'toastSaved' : 'toastSavedNoTrigger'));
  }

  function showMsg(sel, text, kind) {
    const el = $(sel);
    el.hidden = !text;
    el.textContent = text || '';
    el.className = `msg${kind ? ` ${kind}` : ''}`;
  }

  // A button that asks once more before it acts. `sure` is a string key or a function giving the text.
  function confirmButton(btn, labelKey, sure, action) {
    btn.addEventListener('click', async () => {
      if (!btn.classList.contains('confirm')) {
        btn.classList.add('confirm');
        btn.textContent = typeof sure === 'function' ? sure() : t(sure);
        clearTimeout(btn.resetTimer);
        btn.resetTimer = setTimeout(() => resetConfirm(btn, labelKey), 4000);
        return;
      }
      resetConfirm(btn, labelKey);
      await action();
    });
    btn.dataset.label = labelKey;
  }

  function resetConfirm(btn, labelKey = btn.dataset.label) {
    btn.classList.remove('confirm');
    if (labelKey) btn.textContent = t(labelKey);
  }

  // ---------- trash ----------

  function reasonText(e) {
    return t(e.reason === 'deleted' ? 'reasonDeleted' : e.reason === 'conflict' ? 'reasonConflict' : 'reasonReplaced');
  }

  async function renderTrash() {
    const list = $('#trash-list');
    const items = await api.trash();
    list.replaceChildren();
    if (!items.length) {
      list.append(h('div', { class: 'empty small' }, h('p', null, t('trashEmpty'))));
      return;
    }
    for (const e of items) {
      const what = e.group
        ? h('div', { class: 'row-main' }, h('b', null, t('trashGroup', { name: e.group.name || t('groupUnnamed') })), h('small', null, t('trashGroupCount', { n: (e.shortcuts || []).length })))
        : h('div', { class: 'row-main' }, h('b', null, h('bdi', null, e.shortcut.name || preview(e.shortcut) || t('untitled'))), h('small', null, `${reasonText(e)} · ${ago(e.at)}`));
      const forget = h('button', { class: 'btn small danger', type: 'button' }, t('forget'));
      confirmButton(forget, 'forget', 'forgetSure', async () => {
        await api.forget(e.id);
        renderTrash();
      });
      list.append(h('div', { class: 'row static' },
        h('div', { class: 'row-trigger' }, e.shortcut ? triggerView(e.shortcut.trigger) : icon('file')),
        what,
        h('button', { class: 'btn small', type: 'button', onclick: async () => {
          const res = await api.restore(e.id);
          if (res.ok) toast(t('toastRestored'));
          renderTrash();
        } }, t('restore')),
        forget));
    }
  }

  // ---------- sheets ----------

  function openSheet(id) {
    for (const s of document.querySelectorAll('.sheet')) if (s.id !== id) s.hidden = true;
    $(`#${id}`).hidden = false;
    const back = $(`#${id} .sheet-head .icon-btn`);
    if (back) back.focus();
  }

  const closeSheet = (id) => {
    $(`#${id}`).hidden = true;
  };

  // ---------- account ----------

  function openAccount() {
    openSheet('account');
    renderAccount();
  }

  async function renderAccount() {
    const body = $('#account-body');
    const a = S.app.account;
    body.replaceChildren();
    if (a.state === 'unconfigured') {
      body.append(h('section', { class: 'group' }, h('p', { class: 'help' }, t('accUnconfigured'))));
      return;
    }
    if (a.state === 'signed-out') {
      const email = h('input', { id: 'email', type: 'email', dir: 'ltr', autocomplete: 'email', placeholder: 'name@example.com' });
      const send = h('button', { class: 'btn primary', type: 'submit' }, t('accSendLink'));
      const msg = h('p', { class: 'msg', hidden: true });
      const form = h('form', { onsubmit: async (e) => {
        e.preventDefault();
        send.disabled = true;
        msg.hidden = true;
        const res = await api.signIn(email.value.trim());
        send.disabled = false;
        if (!res.ok && res.error !== 'cancelled') {
          msg.hidden = false;
          msg.className = 'msg error';
          msg.textContent = errorText(res.error);
        }
      } }, h('label', { class: 'field' }, h('span', null, t('accEmail')), h('div', { class: 'field-row' }, email, send)), msg);
      body.append(
        h('section', { class: 'group' }, h('h3', null, t('accWhyTitle')), h('p', { class: 'help' }, t('accWhy')), form),
        h('section', { class: 'group' }, h('h3', null, icon('lock'), ' ', t('accPrivacyTitle')), h('p', { class: 'help' }, t('accPrivacy'))),
      );
      setTimeout(() => email.focus(), 30);
      return;
    }
    if (a.state === 'waiting-for-link') {
      // the 6-digit code from the email (read on any device), or its link opened on this computer
      const code = h('input', { id: 'email-code', class: 'otp-input', dir: 'ltr', inputmode: 'numeric', autocomplete: 'one-time-code', spellcheck: 'false', placeholder: '······', 'aria-label': t('accEmailCode') });
      const go = h('button', { class: 'btn primary', type: 'submit' }, t('signIn'));
      const msg = h('p', { class: 'msg', hidden: true });
      const submit = async () => {
        if (go.disabled) return;
        go.disabled = true;
        msg.hidden = true;
        const res = await api.enterEmailCode(code.value);
        // accepted: the next screen is on its way, so the button stays off (a second press would be refused)
        if (res.ok) { code.readOnly = true; return; }
        go.disabled = false;
        msg.hidden = false;
        msg.className = 'msg error';
        msg.textContent = errorText(res.error);
        code.select();
      };
      code.addEventListener('input', () => {
        const digits = code.value.replace(/\D/g, '').slice(0, 6);
        if (code.value !== digits) code.value = digits;
        if (digits.length === 6) submit();
      });
      body.append(h('section', { class: 'group center' },
        h('div', { class: 'big-icon' }, icon('mail')),
        h('h3', null, t('accCheckEmail')),
        h('p', { class: 'help' }, t('accCheckEmailBody', { email: a.email })),
        h('form', { class: 'otp-form', onsubmit: (e) => {
          e.preventDefault();
          submit();
        } }, h('div', { class: 'field-row' }, code, go), msg),
        h('p', { class: 'help' }, t('accNoEmail')),
        h('button', { class: 'btn', type: 'button', onclick: () => api.cancelSignIn() }, t('cancel'))));
      setTimeout(() => code.focus(), 30);
      return;
    }
    if (a.state === 'needs-code') {
      const field = codeField();
      const code = field.input;
      const go = h('button', { class: 'btn primary', type: 'submit' }, t('continue'));
      const msg = h('p', { class: 'msg', hidden: true });
      body.append(h('section', { class: 'group' },
        h('h3', null, t('accCodeTitle')),
        h('p', { class: 'help' }, t('accCodeBody')),
        h('form', { onsubmit: async (e) => {
          e.preventDefault();
          go.disabled = true;
          const res = await api.enterCode(code.value);
          go.disabled = false;
          if (!res.ok) {
            msg.hidden = false;
            msg.className = 'msg error';
            msg.textContent = errorText(res.error);
          }
        } }, h('div', { class: 'field-row' }, field.box, go), msg),
        h('p', { class: 'help' }, t('accCodeLost'))));
      setTimeout(() => code.focus(), 30);
      return;
    }
    // ready
    const devicesBox = h('ul', { class: 'peer-list' }, h('li', { class: 'peer-empty' }, t('loading')));
    const codeBox = h('code', { dir: 'ltr', class: 'hidden-code' }, '••••-••••-••••');
    const showCodeBtn = h('button', { class: 'btn', type: 'button', onclick: async () => {
      codeBox.textContent = await api.showCode();
      codeBox.classList.remove('hidden-code');
      showCodeBtn.hidden = true;
    } }, t('accShowCode'));
    const signOutBtn = h('button', { class: 'btn', type: 'button' }, t('accSignOut'));
    confirmButton(signOutBtn, 'accSignOut', 'accSignOutSure', async () => {
      await api.signOut();
      toast(t('toastSignedOut'));
    });
    const deleteBtn = h('button', { class: 'btn danger', type: 'button' }, t('accDelete'));
    confirmButton(deleteBtn, 'accDelete', 'accDeleteSure', async () => {
      const res = await api.deleteAccount();
      toast(res.ok ? t('toastDeleted') : errorText(res.error));
    });
    body.append(
      h('section', { class: 'group' },
        h('h3', null, t('accSignedInAs')),
        h('p', { class: 'acc-email', dir: 'ltr' }, a.email),
        h('p', { class: 'help' }, a.offline ? t('accOfflineBody') : syncedText(a)),
        h('button', { class: 'btn', type: 'button', onclick: async () => {
          const res = await api.syncNow();
          toast(res.ok ? t('toastSynced') : t('accOffline'));
        } }, icon('sync'), t('accSyncNow'))),
      h('section', { class: 'group' },
        h('h3', null, t('accYourCode')),
        h('p', { class: 'help' }, t('accYourCodeHelp')),
        h('div', { class: 'code-row' }, codeBox, showCodeBtn)),
      h('section', { class: 'group' }, h('h3', null, t('accComputers')), devicesBox),
      h('section', { class: 'group' },
        h('h3', null, t('accLeave')),
        h('p', { class: 'help' }, t('accLeaveHelp')),
        h('div', { class: 'row-actions' }, signOutBtn, deleteBtn)),
    );
    const res = await api.devices();
    devicesBox.replaceChildren();
    if (!res.ok) return devicesBox.append(h('li', { class: 'peer-empty' }, errorText(res.error)));
    for (const d of res.devices) {
      const out = h('button', { class: 'btn small', type: 'button' }, t('accSignOutDevice'));
      confirmButton(out, 'accSignOutDevice', 'accSignOutDeviceSure', async () => {
        const r = await api.signOutDevice(d.id);
        if (r.ok) renderAccount();
        else toast(errorText(r.error));
      });
      devicesBox.append(h('li', { class: 'peer' },
        h('span', { class: 'icon', html: svg(d.platform === 'mac' ? 'laptop' : 'desktop') }),
        h('div', { class: 'who' }, h('b', null, h('bdi', null, d.name || '?')), h('small', null, d.here ? t('accThisComputer') : t('accSeen', { when: ago(d.lastSeen) }))),
        d.here ? h('span', { class: 'badge ok' }, t('accHere')) : out));
    }
  }

  // The code, shown once on the account's first computer.
  function showNewCode(code) {
    openDialog(
      h('div', { class: 'big-icon' }, icon('lock')),
      h('h2', null, t('codeTitle')),
      h('code', { class: 'big-code', dir: 'ltr' }, code),
      h('p', { class: 'help' }, t('codeBody')),
      h('p', { class: 'help' }, t('codeAgain')),
      h('div', { class: 'row-actions end' }, h('button', { class: 'btn primary', type: 'button', onclick: closeDialog }, t('codeWroteIt'))),
    );
  }

  // ---------- dialogs ----------

  function openDialog(...content) {
    const d = $('#dialog');
    d.replaceChildren(...content);
    d.hidden = false;
    $('#dialog-scrim').hidden = false;
    const first = d.querySelector('input, button.primary, button');
    if (first) setTimeout(() => first.focus(), 20);
  }

  function closeDialog() {
    $('#dialog').hidden = true;
    $('#dialog-scrim').hidden = true;
  }

  function openGroupDialog(g) {
    const name = h('input', { value: g ? g.name : '', maxlength: '200', dir: 'auto', placeholder: t('groupNamePlaceholder') });
    let color = (g && g.color) || GROUP_COLORS[(S.app.groups.length) % GROUP_COLORS.length];
    const swatches = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': t('groupColor') },
      GROUP_COLORS.map((c) => {
        const b = h('button', { class: 'swatch big', type: 'button', role: 'radio', 'aria-checked': String(c === color), 'aria-label': c, onclick: () => {
          color = c;
          for (const x of swatches.children) x.setAttribute('aria-checked', String(x.dataset.color === c));
        } });
        b.dataset.color = c;
        b.style.setProperty('--c', c);
        return b;
      }));
    const enabled = h('input', { type: 'checkbox', checked: g ? g.enabled : true });
    const save = async () => {
      const res = await api.saveGroup({ id: g ? g.id : undefined, name: name.value.trim(), color, enabled: enabled.checked });
      if (res.ok) {
        closeDialog();
        if (!g) pickGroup(res.id);
      }
    };
    const del = g ? h('button', { class: 'btn danger', type: 'button' }, t('groupDelete')) : null;
    if (del) {
      const n = S.app.shortcuts.filter((s) => s.groupId === g.id).length;
      confirmButton(del, 'groupDelete', () => t(n ? 'groupDeleteSureN' : 'groupDeleteSure', { n }), async () => {
        await api.removeGroup(g.id);
        if (S.group === g.id) S.group = 'all';
        closeDialog();
        toast(t('toastGroupDeleted', { n }));
      });
    }
    openDialog(
      h('h2', null, t(g ? 'groupEdit' : 'newGroupTitle')),
      h('label', { class: 'field' }, h('span', null, t('groupName')), name),
      h('div', { class: 'field' }, h('span', null, t('groupColor')), swatches),
      g ? h('label', { class: 'toggle' }, enabled, h('span', { class: 'track' }), h('span', { class: 'toggle-text' }, h('b', null, t('groupOn')), h('small', null, t('groupOnHint')))) : null,
      h('div', { class: 'row-actions end' }, del, h('span', { class: 'grow' }), h('button', { class: 'btn', type: 'button', onclick: closeDialog }, t('cancel')), h('button', { class: 'btn primary', type: 'button', onclick: save }, t('save'))),
    );
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') save();
    });
  }

  // ---------- settings ----------

  function renderSettings() {
    const s = S.app.settings;
    const lang = $('#language');
    if (!lang.options.length) for (const l of I18N.LANGUAGES) lang.append(h('option', { value: l.code }, l.name));
    lang.value = s.language;
    for (const el of document.querySelectorAll('[data-setting]')) el.checked = !!s[el.dataset.setting];
    $('#device-name').value = s.deviceName || '';
    $('#version').textContent = S.app.version;
    $('#import-clavier').hidden = !S.app.clavier.exists;
    $('#clavier-found').textContent = t('setClavierFound', { n: S.app.clavier.count });
  }

  async function importClavier() {
    const res = await api.importClavier();
    if (!res.ok) return toast(errorText(res.error));
    toast(res.added ? t('toastImported', { n: res.added }) : t('toastImportedNone'));
    if (res.off) setTimeout(() => toast(t('toastImportedOff', { n: res.off })), 2700);
  }

  async function setPaused(paused) {
    await api.setSettings({ paused });
    toast(t(paused ? 'toastPaused' : 'toastResumed'));
  }

  // ---------- first run ----------

  function renderWelcome() {
    const box = $('#welcome-steps');
    box.replaceChildren();
    const steps = [];
    if (isMac) {
      const ok = S.app.helper.permission === true;
      steps.push(h('section', { class: `group step${ok ? ' done' : ''}` },
        h('h3', null, ok ? icon('check') : icon('key'), ' ', t('wPermTitle')),
        h('p', { class: 'help' }, t(ok ? 'wPermDone' : 'wPermBody')),
        ok ? null : h('button', { class: 'btn primary', type: 'button', onclick: () => api.openAccessibility() }, t('bnPermOpen'))));
    }
    if (S.app.clavier.exists) {
      const imported = S.app.groups.some((g) => g.name === 'Clavier+');
      steps.push(h('section', { class: `group step${imported ? ' done' : ''}` },
        h('h3', null, imported ? icon('check') : icon('key'), ' ', t('wClavierTitle')),
        h('p', { class: 'help' }, imported ? t('wClavierDone') : t('wClavierBody', { n: S.app.clavier.count })),
        imported ? null : h('button', { class: 'btn primary', type: 'button', onclick: importClavier }, t('importClavierN', { n: S.app.clavier.count }))));
    }
    if (S.app.account.state !== 'unconfigured') {
      const ready = S.app.account.state === 'ready';
      steps.push(h('section', { class: `group step${ready ? ' done' : ''}` },
        h('h3', null, ready ? icon('check') : icon('sync'), ' ', t('wAccountTitle')),
        h('p', { class: 'help' }, t(ready ? 'wAccountDone' : 'wAccountBody')),
        ready ? null : h('button', { class: 'btn', type: 'button', onclick: openAccount }, t('signIn'))));
    }
    steps.push(h('section', { class: 'group step' }, h('h3', null, icon('key'), ' ', t('wTryTitle')), h('p', { class: 'help' }, t('wTryBody'))));
    box.append(...steps);
  }

  async function finishWelcome() {
    closeSheet('welcome');
    await api.setSettings({ onboarded: true });
  }

  // ---------- refresh ----------

  async function refresh() {
    S.app = await api.getState();
    if (S.app.settings.language !== tr.code) {
      tr = I18N.createTranslator(S.app.settings.language);
      buildFormatters();
      translatePage();
    }
    const shown = S.group === 'all' || S.app.groups.some((g) => g.id === S.group) || (S.group === UNASSIGNED && S.app.groups.length);
    if (!shown) S.group = 'all';
    renderTop();
    renderBanners();
    renderGroups();
    renderAccountCard();
    renderList();
    if (!$('#settings').hidden) renderSettings();
    if (!$('#account').hidden && !$('#account').contains(document.activeElement)) renderAccount();
    else if (!$('#account').hidden && S.lastAccountState !== S.app.account.state) renderAccount();
    S.lastAccountState = S.app.account.state;
    if (!$('#welcome').hidden) renderWelcome();
    if (!S.app.settings.onboarded && !S.welcomeShown) {
      S.welcomeShown = true;
      renderWelcome();
      openSheet('welcome');
    }
    if (S.draft && !els.editor.hidden && S.draft.trigger) checkTrigger();
  }

  // ---------- wiring ----------

  $('#search').addEventListener('input', (e) => {
    S.q = e.target.value;
    renderList();
  });
  $('#new-shortcut').addEventListener('click', () => openEditor(null));
  $('#add-group').addEventListener('click', () => openGroupDialog(null));
  $('#status').addEventListener('click', openAccount);
  $('#pause').addEventListener('click', () => setPaused(!S.app.settings.paused));
  $('#open-trash').addEventListener('click', () => {
    openSheet('trash');
    renderTrash();
  });
  $('#close-trash').addEventListener('click', () => closeSheet('trash'));
  $('#open-settings').addEventListener('click', () => {
    renderSettings();
    openSheet('settings');
  });
  $('#close-settings').addEventListener('click', () => closeSheet('settings'));
  $('#close-account').addEventListener('click', () => closeSheet('account'));
  $('#welcome-done').addEventListener('click', finishWelcome);

  // editor
  $('#close-editor').addEventListener('click', closeEditor);
  $('#cancel-editor').addEventListener('click', closeEditor);
  els.scrim.addEventListener('click', closeEditor);
  $('#save-shortcut').addEventListener('click', saveShortcut);
  for (const b of document.querySelectorAll('#trigger-type button')) b.addEventListener('click', () => {
    setTriggerType(b.dataset.value);
    if (b.dataset.value === 'abbrev') els.abbrev.focus();
  });
  for (const b of document.querySelectorAll('#kind button')) b.addEventListener('click', () => setKind(b.dataset.value));
  els.record.addEventListener('click', () => (S.recording ? stopRecording() : startRecording()));
  els.recorder.addEventListener('click', () => {
    if (!S.recording) startRecording();
  });
  els.recorder.addEventListener('keydown', (e) => {
    if (!S.recording && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      startRecording();
    }
  });
  // Only the key box records: clicking into another field (or another window) stops it, so the
  // first letter typed there isn't taken as the hotkey.
  els.recorder.addEventListener('blur', (e) => {
    if (S.recording && e.relatedTarget !== els.record) stopRecording();
  });
  window.addEventListener('blur', () => stopRecording());
  $('#clear-trigger').addEventListener('click', () => {
    S.draft.trigger = null;
    renderRecorder();
    renderNotes();
  });
  els.abbrev.addEventListener('input', () => {
    S.draft.trigger = els.abbrev.value ? { type: 'abbrev', text: els.abbrev.value } : null;
    checkTrigger();
  });
  els.text.addEventListener('input', updateTextMode);
  $('#platforms').addEventListener('change', checkTrigger);
  for (const b of document.querySelectorAll('#vars [data-var]')) b.addEventListener('click', () => insertVariable(b.dataset.var));
  for (const p of ['win', 'mac']) {
    $(`#choose-${p}`).addEventListener('click', async () => {
      const chosen = await api.choosePath(S.draft.kind === 'file' ? 'any' : 'program');
      if (chosen) $(`#path-${p}`).value = chosen;
    });
  }
  confirmButton($('#delete-shortcut'), 'delete', 'deleteSure', async () => {
    await api.removeShortcut(S.draft.id);
    closeEditor();
    toast(t('toastDeletedShortcut'));
  });
  $('#duplicate-shortcut').addEventListener('click', async () => {
    const res = await api.duplicateShortcut(S.draft.id);
    closeEditor();
    if (res.ok) {
      await refresh();
      const copy = S.app.shortcuts.find((s) => s.id === res.id);
      if (copy) openEditor(copy);
    }
  });

  // settings
  $('#language').addEventListener('change', (e) => api.setSettings({ language: e.target.value }));
  for (const el of document.querySelectorAll('[data-setting]')) el.addEventListener('change', () => api.setSettings({ [el.dataset.setting]: el.checked }));
  $('#device-name').addEventListener('change', (e) => api.setSettings({ deviceName: e.target.value }));
  $('#run-clavier').addEventListener('click', importClavier);
  $('#import-json').addEventListener('click', async () => {
    const res = await api.importJson();
    if (res.canceled) return;
    toast(res.ok ? t('toastImportedFile', { n: res.added + res.replaced }) : errorText(res.error));
  });
  $('#export-json').addEventListener('click', async () => {
    const res = await api.exportJson();
    if (res.canceled) return;
    toast(res.ok ? t('toastExported', { n: res.count }) : errorText(res.error));
  });
  $('#open-data').addEventListener('click', () => api.openDataDir());
  $('#dialog-scrim').addEventListener('click', closeDialog);

  document.addEventListener('keydown', (e) => {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (e.key === 'Escape' && !S.recording) {
      if (!$('#dialog').hidden) return closeDialog();
      if (!els.editor.hidden) return closeEditor();
      for (const id of ['trash', 'settings', 'account']) if (!$(`#${id}`).hidden) return closeSheet(id);
    }
    if (mod && e.key.toLowerCase() === 'n' && els.editor.hidden) {
      e.preventDefault();
      openEditor(null);
    }
    if (mod && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      $('#search').focus();
    }
    if (mod && e.key === 'Enter' && !els.editor.hidden) {
      e.preventDefault();
      saveShortcut();
    }
  });

  // The page itself never scrolls (only its lists do); if anything scrolls it anyway, put it back,
  // or the window would look empty.
  document.addEventListener('scroll', () => {
    if (document.scrollingElement.scrollTop || document.scrollingElement.scrollLeft) document.scrollingElement.scrollTo(0, 0);
  });
  for (const el of [document.body, $('.app')]) el.addEventListener('scroll', () => el.scrollTo(0, 0));

  api.on('state:changed', refresh);
  api.on('recorded', recorded);
  api.on('account:code', (code) => {
    refresh();
    showNewCode(code);
  });
  api.on('toast', (key, vars) => toast(t(key, vars)));
  api.on('ui:open-settings', () => {
    renderSettings();
    openSheet('settings');
  });
  api.on('ui:new-shortcut', () => openEditor(null));
  setInterval(() => {
    if (S.app) {
      renderAccountCard();
      renderTop();
    }
  }, 30000);

  await refresh();

  // preview helpers: ?sheet=editor|trash|settings|account|code|group
  const want = new URLSearchParams(location.search).get('sheet');
  if (want === 'editor') openEditor(S.app.shortcuts[0]);
  else if (want === 'new') openEditor(null);
  else if (want === 'trash') $('#open-trash').click();
  else if (want === 'settings') $('#open-settings').click();
  else if (want === 'account') openAccount();
  else if (want === 'code') showNewCode('K7QM-4XRT-P9WE');
  else if (want === 'group') openGroupDialog(S.app.groups[0]);
})();
