'use strict';
// Triggers: what makes a shortcut fire.
//
//   hotkey: { type: 'hotkey', mods: ['ShiftRight'], key: 'KeyA', mac?: { mods, key }, win?: { mods, key } }
//   abbrev: { type: 'abbrev', text: ';addr' }
//
// A hotkey is written once for both systems: key names are physical and modifiers are mapped by
// function (Alt = Option, Meta = Win / Cmd), always keeping the side. `mac` / `win` hold an override
// only where the key doesn't exist on that system's keyboards (Right Control on most Macs). An
// override equal to the hotkey itself is the user's "Ignore": the same keys there, on purpose.
// 'Shift', 'Control', 'Alt', 'Meta' (no side) match either side.
const keys = require('../shared/keys');
const abbrev = require('./abbrev');

const PLATFORMS = ['win', 'mac'];

class TriggerError extends Error {
  constructor(code) {
    super(`trigger: ${code}`);
    this.code = code;
  }
}

const currentPlatform = () => (process.platform === 'darwin' ? 'mac' : 'win');

function normalizeCombo(combo) {
  if (!combo || typeof combo !== 'object') throw new TriggerError('bad-hotkey');
  const key = String(combo.key || '');
  if (!keys.isKey(key)) throw new TriggerError('unknown-key');
  const mods = [];
  for (const m of Array.isArray(combo.mods) ? combo.mods : []) {
    if (!keys.isModifier(m)) throw new TriggerError('unknown-modifier');
    if (!mods.includes(m)) mods.push(m);
  }
  // 'Shift' next to 'ShiftRight' adds nothing
  const clean = mods.filter((m) => !(m in keys.GENERIC_MODIFIERS && mods.some((o) => o !== m && keys.modifierBase(o) === m)));
  clean.sort((a, b) => keys.MODIFIER_ORDER.indexOf(a) - keys.MODIFIER_ORDER.indexOf(b));
  if (!clean.length && !keys.ALONE_OK.includes(key)) throw new TriggerError('needs-modifier');
  return { mods: clean, key };
}

// A clean copy of a trigger, or null for none. Throws TriggerError / AbbrevError when it can't work.
function normalize(trigger) {
  if (trigger == null) return null;
  if (trigger.type === 'hotkey') {
    const out = { type: 'hotkey', ...normalizeCombo(trigger) };
    for (const p of PLATFORMS) if (trigger[p]) out[p] = normalizeCombo(trigger[p]);
    return out;
  }
  if (trigger.type === 'abbrev') {
    const text = String(trigger.text || '').normalize('NFC');
    abbrev.compile(text);
    return { type: 'abbrev', text };
  }
  throw new TriggerError('unknown-type');
}

// The hotkey on one system: its override if there is one.
function comboFor(trigger, platform) {
  if (!trigger || trigger.type !== 'hotkey') return null;
  return trigger[platform] || { mods: trigger.mods, key: trigger.key };
}

// Every exact left/right set a modifier list stands for: ['Shift', 'ControlRight'] -> 2 sets.
function expand(mods) {
  let sets = [[]];
  for (const m of mods) {
    const sides = keys.GENERIC_MODIFIERS[m] || [m];
    sets = sets.flatMap((set) => sides.map((side) => [...set, side]));
  }
  return sets;
}

const comboId = (sidedMods, key) => [...sidedMods].sort().concat(key).join('+');

// What the helper gets for these (active) shortcuts, in list order: the first shortcut keeps a
// combo or abbreviation two of them share, and both are reported in `conflicts` (id -> Set of ids).
function forHelper(shortcuts, platform) {
  const hotkeys = [];
  const abbrevs = [];
  const conflicts = new Map();
  const invalid = [];
  const owner = new Map();
  const claim = (id, s) => {
    const first = owner.get(id);
    if (first && first !== s.id) {
      for (const [a, b] of [[first, s.id], [s.id, first]]) {
        if (!conflicts.has(a)) conflicts.set(a, new Set());
        conflicts.get(a).add(b);
      }
      return false;
    }
    owner.set(id, s.id);
    return true;
  };
  for (const s of shortcuts) {
    const t = s.trigger;
    if (!t) continue;
    if (t.type === 'hotkey') {
      const combo = comboFor(t, platform);
      if (!keys.hasKey(combo.key, platform)) {
        invalid.push({ id: s.id, reason: 'key-missing' });
        continue;
      }
      for (const mods of expand(combo.mods)) {
        if (claim(comboId(mods, combo.key), s)) hotkeys.push({ id: s.id, mods, key: combo.key });
      }
    } else if (t.type === 'abbrev') {
      let compiled;
      try {
        compiled = abbrev.compile(t.text);
      } catch (err) {
        invalid.push({ id: s.id, reason: err.code || 'abbrev' });
        continue;
      }
      if (claim(`abbrev:${compiled.keys.join(' ')}`, s)) abbrevs.push({ id: s.id, ...compiled });
    }
  }
  return { hotkeys, abbrevs, conflicts, invalid };
}

// "Right Shift + A" / ";addr"
function label(trigger, platform) {
  if (!trigger) return '';
  if (trigger.type === 'abbrev') return trigger.text;
  const c = comboFor(trigger, platform);
  return [...c.mods.map((m) => keys.modifierLabel(m, platform)), keys.keyLabel(c.key, platform)].join(' + ');
}

// Why a hotkey may not work on `platform` (shown in the editor), or null.
function note(trigger, platform) {
  if (!trigger || trigger.type !== 'hotkey' || trigger[platform]) return null;
  if (platform === 'mac' && trigger.mods.includes('ControlRight')) return 'mac-no-right-control';
  if (platform === 'win' && trigger.mods.includes('MetaRight')) return 'win-no-right-win';
  if (!keys.hasKey(trigger.key, platform)) return 'key-missing';
  return null;
}

// The first system the shortcut is for whose note nobody has answered yet ("Use it" or "Ignore"
// in the editor): { platform, note }, or null. The list marks those shortcuts.
function unanswered(shortcut) {
  for (const p of PLATFORMS) {
    if (shortcut.platforms !== 'all' && shortcut.platforms !== p) continue;
    const n = note(shortcut.trigger, p);
    if (n) return { platform: p, note: n };
  }
  return null;
}

// Keys to try instead of one most keyboards on `platform` lack.
const SWAPS = { mac: { ControlRight: ['MetaRight', 'AltRight'] }, win: { MetaRight: ['ControlRight', 'AltRight'] } };

// A free combo for the "On Mac use instead" override, or null. `others` are the other shortcuts.
function suggestOverride(trigger, platform, others = []) {
  if (!trigger || trigger.type !== 'hotkey') return null;
  const swaps = SWAPS[platform] || {};
  const from = trigger.mods.find((m) => swaps[m]);
  if (!from) return null;
  const taken = new Set();
  for (const o of others) {
    const c = comboFor(o.trigger, platform);
    if (c) for (const mods of expand(c.mods)) taken.add(comboId(mods, c.key));
  }
  for (const to of swaps[from]) {
    if (trigger.mods.includes(to)) continue;
    const combo = normalizeCombo({ mods: trigger.mods.map((m) => (m === from ? to : m)), key: trigger.key });
    if (expand(combo.mods).every((mods) => !taken.has(comboId(mods, combo.key)))) return combo;
  }
  return null;
}

// Combos the system keeps for itself, and the everyday ones apps use (with the left key).
const RESERVED = {
  win: {
    system: ['Control+Alt+Delete', 'Meta+KeyL', 'Control+Shift+Escape', 'Alt+Tab', 'Control+Escape'],
    common: [...'CVXZYASFPNOWT'].map((k) => `Control+Key${k}`).concat('Alt+F4'),
  },
  mac: {
    system: ['Meta+Tab', 'Meta+Space', 'Meta+Alt+Escape', 'Meta+Shift+Digit3', 'Meta+Shift+Digit4', 'Meta+Shift+Digit5', 'Control+Meta+KeyQ'],
    common: [...'CVXZASFPNOWTQHM'].map((k) => `Meta+Key${k}`),
  },
};
const baseId = (mods, key) => [...new Set(mods.map(keys.modifierBase))].sort().concat(key).join('+');
const reservedIds = (list) => list.map((r) => {
  const parts = r.split('+');
  const key = parts.pop();
  return baseId(parts, key);
});

// Warnings for the editor: 'system' (the system takes it first), 'common' (hides an everyday app
// shortcut, e.g. Left Ctrl + C), 'blocks-capital' (Shift on either side + a letter).
function warnings(trigger, platform) {
  const c = comboFor(trigger, platform);
  if (!c) return [];
  const out = [];
  const id = baseId(c.mods, c.key);
  const leftSide = c.mods.every((m) => !m.endsWith('Right'));
  const reserved = RESERVED[platform] || RESERVED.win;
  if (reservedIds(reserved.system).includes(id)) out.push('system');
  else if (leftSide && reservedIds(reserved.common).includes(id)) out.push('common');
  if (c.mods.length === 1 && c.mods[0] === 'Shift' && keys.isTypingKey(c.key)) out.push('blocks-capital');
  return out;
}

module.exports = {
  PLATFORMS, TriggerError, currentPlatform, normalize, normalizeCombo, comboFor, expand, comboId,
  forHelper, label, note, unanswered, suggestOverride, warnings,
};
