'use strict';
// Writes build/cloud.json - the Supabase URL and publishable key the installed app signs in with -
// from KEYBRIDGE_SUPABASE_URL / KEYBRIDGE_SUPABASE_KEY in the environment (the release workflow's
// repository secrets) or the local .env. electron-builder puts it next to the app (extraResources).
// The file is gitignored; the key is never printed. Without both values the build stops, so an
// installer never ships without the account.
//   node scripts/cloud-config.js
const fs = require('fs');
const path = require('path');
const { cloudConfig } = require('../src/main/config');

const out = path.join(__dirname, '..', 'build', 'cloud.json');

let config;
try {
  config = cloudConfig({ configFile: '' });
} catch (err) {
  console.error(`cloud-config: ${err.message}`);
  process.exit(1);
}
const { url, key } = config;
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) || !/^sb_publishable_/.test(key)) {
  console.error('cloud-config: set KEYBRIDGE_SUPABASE_URL (https://<project>.supabase.co) and KEYBRIDGE_SUPABASE_KEY (sb_publishable_...)');
  process.exit(1);
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify({ url, key }, null, 2)}\n`);
console.log('cloud-config: wrote build/cloud.json');
