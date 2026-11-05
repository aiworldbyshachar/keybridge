'use strict';
// Runs the Supabase migration on a throwaway local Postgres (made in a temp folder, on its own port,
// removed after) with a stand-in for what Supabase provides, then supabase/tests/checks.sql.
// Skipped where Postgres isn't installed; KEYBRIDGE_PG_BIN can point at its bin folder.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const EXE = process.platform === 'win32' ? '.exe' : '';

function pgBin() {
  const versions = (dir) => {
    try {
      return fs.readdirSync(dir).filter((v) => /^\d+/.test(v)).sort((a, b) => parseFloat(b) - parseFloat(a)).map((v) => path.join(dir, v, 'bin'));
    } catch {
      return [];
    }
  };
  const candidates = [
    process.env.KEYBRIDGE_PG_BIN,
    ...versions(path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PostgreSQL')),
    ...versions('/usr/lib/postgresql'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ].filter(Boolean);
  return candidates.find((dir) => fs.existsSync(path.join(dir, `initdb${EXE}`)) && fs.existsSync(path.join(dir, `psql${EXE}`)));
}

const bin = pgBin();
const root = path.join(__dirname, '..', 'supabase');

test('the Supabase migration on a real Postgres', { skip: !bin && 'no Postgres here', timeout: 120000 }, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keybridge-pg-'));
  const data = path.join(dir, 'data');
  const port = String(54000 + (process.pid % 900));
  const run = (tool, args) => execFileSync(path.join(bin, tool + EXE), args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const psql = (file) => execFileSync(path.join(bin, `psql${EXE}`), ['-h', 'localhost', '-p', port, '-U', 'postgres', '-d', 'postgres', '-q', '-v', 'ON_ERROR_STOP=1', '-f', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  run('initdb', ['-D', data, '-U', 'postgres', '--auth=trust', '-E', 'UTF8']);
  const opts = `-p ${port} -c listen_addresses=localhost -c fsync=off` + (process.platform === 'win32' ? '' : ` -c unix_socket_directories=${dir}`);
  // no pipes: the server would keep them open and this call would never return
  execFileSync(path.join(bin, `pg_ctl${EXE}`), ['-D', data, '-o', opts, '-l', path.join(dir, 'pg.log'), '-w', 'start'], { stdio: 'ignore' });
  t.after(() => {
    try {
      run('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']);
    } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  });

  psql(path.join(root, 'tests', 'supabase-stub.sql'));
  for (const file of fs.readdirSync(path.join(root, 'migrations')).sort()) psql(path.join(root, 'migrations', file));
  let out;
  try {
    execFileSync(path.join(bin, `psql${EXE}`), ['-h', 'localhost', '-p', port, '-U', 'postgres', '-d', 'postgres', '-q', '-f', path.join(root, 'tests', 'checks.sql')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    out = err.stderr;
  }
  assert.ok(!out, `a check failed:\n${out}`);
});
