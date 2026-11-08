'use strict';
// Where the cloud is: the Supabase project URL and its publishable key. From the environment, from
// the gitignored .env next to package.json while developing, or from cloud.json next to the
// installed app (written at build time by scripts/cloud-config.js). Without them KeyBridge works on
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

function readJson(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    return j && typeof j === 'object' ? j : {};
  } catch {
    return {};
  }
}

function cloudConfig({
  env = process.env,
  envFile = path.join(__dirname, '..', '..', '.env'),
  configFile = process.resourcesPath ? path.join(process.resourcesPath, 'cloud.json') : '',
} = {}) {
  const file = readEnvFile(envFile);
  const built = configFile ? readJson(configFile) : {};
  const url = String(env.KEYBRIDGE_SUPABASE_URL || file.KEYBRIDGE_SUPABASE_URL || built.url || '');
  const key = String(env.KEYBRIDGE_SUPABASE_KEY || file.KEYBRIDGE_SUPABASE_KEY || built.key || '');
  // a secret key here would be a mistake: it bypasses every access rule
  if (/^sb_secret_/.test(key)) throw new Error('KEYBRIDGE_SUPABASE_KEY is the secret key - use the publishable one');
  return { url: url.replace(/\/+$/, ''), key };
}

module.exports = { cloudConfig, readEnvFile, readJson };
