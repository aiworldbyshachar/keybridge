'use strict';
// End-to-end encryption for the cloud copy: every shortcut, group and trash entry is sealed on the
// computer with a key made from the account code, so the server only ever holds ciphertext.
//
//   key  = scrypt(normalizedCode, 'keybridge/v1', 32)
//   data = 'v1.' + base64(iv[12] | GCM tag[16] | AES-256-GCM(JSON))
//
// The item id is bound in as additional data, so the server can't swap two items' contents.
const crypto = require('crypto');
const { normalizeCode } = require('./code');

const SALT = 'keybridge/v1';
const PREFIX = 'v1.';
// A known value sealed with the key and kept on the server: it tells a wrong code from the right
// one when a new computer signs in.
const CHECK_ID = 'key-check';
const CHECK_TEXT = 'KeyBridge';

class VaultError extends Error {
  constructor(code) {
    super(`vault: ${code}`);
    this.code = code;
  }
}

function deriveKey(code) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(normalizeCode(code), SALT, 32, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

function seal(key, id, value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(String(id)));
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

// Throws VaultError('unreadable') for anything that wasn't sealed with this key for this id.
function open(key, id, data) {
  if (typeof data !== 'string' || !data.startsWith(PREFIX)) throw new VaultError('unreadable');
  const buf = Buffer.from(data.slice(PREFIX.length), 'base64');
  if (buf.length < 28) throw new VaultError('unreadable');
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
    decipher.setAAD(Buffer.from(String(id)));
    decipher.setAuthTag(buf.subarray(12, 28));
    const text = Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
    return JSON.parse(text);
  } catch {
    throw new VaultError('unreadable');
  }
}

const makeCheck = (key) => seal(key, CHECK_ID, CHECK_TEXT);

function checkMatches(key, check) {
  try {
    return open(key, CHECK_ID, check) === CHECK_TEXT;
  } catch {
    return false;
  }
}

module.exports = { deriveKey, seal, open, makeCheck, checkMatches, VaultError };
