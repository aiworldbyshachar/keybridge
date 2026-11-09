'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// CRLF on a Windows checkout (git's autocrlf) - the selectors below are matched with "\n"
const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'style.css'), 'utf8').replace(/\r\n/g, '\n');
const rule = (selector) => {
  const m = new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`).exec(css);
  return m ? m[1] : '';
};

// The switches hide a real checkbox with position: absolute. Without a positioned switch around
// it, the checkbox sits against the whole page; a click focuses it, and for a shortcut far down
// the list the browser scrolled the page itself to it, leaving the window blank (2026-11-05).
test('the hidden checkbox of a switch stays inside the switch', () => {
  assert.match(rule('.toggle input'), /position: absolute/);
  assert.match(rule('.toggle'), /position: relative/);
});

test('the page itself never scrolls, only its lists do', () => {
  assert.match(rule('html,\nbody'), /overflow: hidden/);
});
