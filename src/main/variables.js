'use strict';
// Variables in text shortcuts: {date}, {time}, {clipboard}, {cursor} (where the caret ends up).
// "{{" types a plain "{". Anything else in braces is typed as it is.

const VARIABLES = ['date', 'time', 'clipboard', 'cursor'];

// Splits text into plain parts and variable names, e.g. "Hi {date}" -> ['Hi ', { v: 'date' }].
function parse(text) {
  const parts = [];
  let plain = '';
  for (let i = 0; i < text.length; i++) {
    if (text.startsWith('{{', i)) {
      plain += '{';
      i++;
      continue;
    }
    if (text[i] === '{') {
      const end = text.indexOf('}', i);
      const name = end > i ? text.slice(i + 1, end) : '';
      if (VARIABLES.includes(name)) {
        if (plain) parts.push(plain);
        parts.push({ v: name });
        plain = '';
        i = end;
        continue;
      }
    }
    plain += text[i];
  }
  if (plain) parts.push(plain);
  return parts;
}

const uses = (text, name) => parse(text).some((p) => p.v === name);

// A literal text with any "{date}"-like part escaped, so it isn't read as a variable.
const escape = (text) => text.replace(/\{(?=(?:date|time|clipboard|cursor)\})/g, '{{');

// -> { text, left }: `left` is how many characters the caret moves back for {cursor}.
function expand(text, { now = new Date(), locale = 'en', clipboard = '' } = {}) {
  let out = '';
  let cursorAt = -1;
  for (const p of parse(text)) {
    if (typeof p === 'string') out += p;
    else if (p.v === 'date') out += new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'numeric', year: 'numeric' }).format(now);
    else if (p.v === 'time') out += new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(now);
    else if (p.v === 'clipboard') out += clipboard;
    else if (p.v === 'cursor' && cursorAt < 0) cursorAt = out.length;
  }
  const left = cursorAt < 0 ? 0 : Array.from(out.slice(cursorAt).replace(/\r\n/g, '\n')).length;
  return { text: out, left };
}

module.exports = { VARIABLES, parse, uses, escape, expand };
