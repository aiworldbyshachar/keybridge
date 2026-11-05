'use strict';
// The account code: 12 characters shown once on the first computer and typed once on each new one.
// It never leaves the computers - the key that seals the shortcuts comes from it (see vault.js).
// Ambiguous characters (0/O, 1/I/L) are left out.
const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 12;

function normalizeCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function formatCode(code) {
  const n = normalizeCode(code);
  return (n.match(/.{1,4}/g) || []).join('-');
}

function isValidCode(code) {
  const n = normalizeCode(code);
  return n.length === CODE_LENGTH && [...n].every((c) => ALPHABET.includes(c));
}

function generateCode() {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return formatCode(s);
}

module.exports = { ALPHABET, CODE_LENGTH, normalizeCode, formatCode, isValidCode, generateCode };
