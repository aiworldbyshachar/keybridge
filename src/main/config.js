'use strict';
// Where the cloud is: the Supabase project URL and its publishable key. From the environment, or
// from the gitignored .env next to package.json while developing. Without them KeyBridge works on
// this computer only. The project's secret key is never needed anywhere.
const fs = require('fs');
const path = require('path');

function readEnvFile(file) {
  const out = {};
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return out;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

function cloudConfig({ env = process.env, envFile = path.join(__dirname, '..', '..', '.env') } = {}) {
  const file = readEnvFile(envFile);
  const url = env.KEYBRIDGE_SUPABASE_URL || file.KEYBRIDGE_SUPABASE_URL || '';
  const key = env.KEYBRIDGE_SUPABASE_KEY || file.KEYBRIDGE_SUPABASE_KEY || '';
  // a secret key here would be a mistake: it bypasses every access rule
  if (/^sb_secret_/.test(key)) throw new Error('KEYBRIDGE_SUPABASE_KEY is the secret key - use the publishable one');
  return { url: url.replace(/\/+$/, ''), key };
}

module.exports = { cloudConfig, readEnvFile };
