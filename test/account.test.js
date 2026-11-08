'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { Store } = require('../src/main/store');
const { Secrets } = require('../src/main/secrets');
const { Account } = require('../src/main/account');
const { Cloud, REDIRECT } = require('../src/main/cloud');
const { waitForLink } = require('../src/main/signin');
const { cloudConfig } = require('../src/main/config');
const { isValidCode } = require('../src/main/code');
const { FakeSupabase, KEY } = require('./fake-supabase');
const { tmpDir, clock } = require('./helpers');

let nextPort = 48100 + (process.pid % 400) * 2;

async function setup() {
  const c = clock();
  const server = new FakeSupabase({ now: c.now });
  const url = await server.start();
  const made = [];
  // A computer: its own folder, store, secrets and account. `restart` makes a new Account on the
  // same folder, like starting the app again.
  const computer = (name) => {
    const dir = tmpDir();
    const port = nextPort++;
    const store = new Store(dir, { deviceId: name, now: c.now });
    store.load();
    const secrets = new Secrets(dir);
    const make = () => {
      const account = new Account({ dir: path.join(dir, 'sync'), url, key: KEY, store, deviceId: name, platform: 'win', secrets, deviceName: `${name}-host`, WebSocketImpl: null, waitForLinkImpl: () => waitForLink({ port }), now: c.now });
      made.push(account);
      return account;
    };
    const pc = { name, dir, port, store, secrets, account: make(), events: [] };
    pc.restart = () => {
      pc.account.stop();
      pc.account = make();
      return pc.account;
    };
    return pc;
  };
  // Signs in: the email arrives, and its link is opened on that computer.
  const signIn = async (pc, email = 'me@example.com') => {
    const codes = [];
    pc.account.on('code', (code) => codes.push(code));
    const before = server.mail.length;
    const done = pc.account.signIn(email);
    while (server.mail.length === before) await new Promise((r) => setTimeout(r, 5));
    const mail = server.mail.at(-1);
    const page = await fetch(`http://localhost:${pc.port}/auth?code=${mail.code}`);
    assert.match(await page.text(), /Signed in/);
    await done;
    return { mail, code: codes[0] };
  };
  const cleanup = async () => {
    for (const a of made) a.stop();
    await server.stop();
  };
  return { server, url, clock: c, computer, signIn, cleanup };
}

test('the first computer signs in by email link and makes the account code', async (t) => {
  const { server, computer, signIn, cleanup } = await setup();
  t.after(cleanup);
  const pc = computer('pc');
  pc.store.add({ text: 'made before signing in' });
  const { mail, code } = await signIn(pc);
  assert.strictEqual(mail.redirectTo, REDIRECT);
  assert.strictEqual(pc.account.state, 'ready');
  assert.ok(isValidCode(code), 'a code is made and shown once');
  assert.strictEqual(pc.account.code, code);
  assert.ok(server.profiles.get(server.users.get('me@example.com')), 'the key check is stored');
  // the shortcut made before signing in is now in the account, sealed
  const dump = server.cloud.dump();
  assert.ok(dump.includes('v1.') && !dump.includes('made before signing in'));
  // this computer is in the devices list, its name sealed
  assert.deepStrictEqual((await pc.account.devices()).map((d) => [d.id, d.name, d.here]), [['pc', 'pc-host', true]]);
  assert.ok(!JSON.stringify([...server.devices.values()].map((m) => [...m.values()])).includes('pc-host'));
});

test('a second computer needs the code, refuses a wrong one, then gets everything', async (t) => {
  const { computer, signIn, cleanup } = await setup();
  t.after(cleanup);
  const pc = computer('pc');
  pc.store.add({ text: 'from the PC', trigger: { type: 'hotkey', mods: ['ShiftRight'], key: 'KeyA' } });
  const { code } = await signIn(pc);

  const mac = computer('mac');
  await signIn(mac);
  assert.strictEqual(mac.account.state, 'needs-code');
  await assert.rejects(mac.account.enterCode('AAAA-BBBB-CCCC'), (e) => e.code === 'wrong-code');
  await assert.rejects(mac.account.enterCode('too short'), (e) => e.code === 'bad-code');
  await mac.account.enterCode(code.toLowerCase().replace(/-/g, ' '));
  assert.strictEqual(mac.account.state, 'ready');
  assert.deepStrictEqual(mac.store.shortcuts().map((s) => s.text), ['from the PC']);

  mac.store.add({ text: 'from the Mac' });
  await mac.account.syncNow();
  await pc.account.syncNow();
  assert.deepStrictEqual(pc.store.shortcuts().map((s) => s.text).sort(), ['from the Mac', 'from the PC']);
  assert.strictEqual((await pc.account.devices()).length, 2);
});

test('after a restart it is ready at once, and keeps working when the token runs out', async (t) => {
  const { server, clock: c, computer, signIn, cleanup } = await setup();
  t.after(cleanup);
  const pc = computer('pc');
  await signIn(pc);
  const account = pc.restart();
  await account.start();
  assert.strictEqual(account.state, 'ready');
  c.at += 2 * 3600 * 1000; // the access token is long expired
  pc.store.add({ text: 'later' });
  const before = server.calls.filter((x) => x.includes('/auth/v1/token')).length;
  assert.strictEqual((await account.syncNow()).pushed, 1);
  assert.strictEqual(server.calls.filter((x) => x.includes('/auth/v1/token')).length, before + 1, 'renewed once');
});

test('signed out from another computer: this one notices, keeps its shortcuts, forgets the session and code', async (t) => {
  const { clock, computer, signIn, cleanup } = await setup();
  t.after(cleanup);
  const pc = computer('pc');
  const { code } = await signIn(pc);
  const mac = computer('mac');
  await signIn(mac);
  await mac.account.enterCode(code);
  pc.store.add({ text: 'kept here' });
  await pc.account.syncNow();
  await mac.account.syncNow();

  const ended = [];
  mac.account.on('ended', (why) => ended.push(why));
  await pc.account.signOutDevice('mac');
  // the Mac's token would still be good for up to an hour; its next session check notices
  clock.at += 61000;
  await mac.account.syncNow();
  assert.deepStrictEqual([mac.account.state, ended], ['signed-out', ['remote']]);
  assert.deepStrictEqual(mac.store.shortcuts().map((s) => s.text), ['kept here']);
  assert.deepStrictEqual([mac.secrets.get('session'), mac.secrets.get('code')], [null, null]);
  assert.deepStrictEqual((await pc.account.devices()).map((d) => d.id), ['pc']);
});

test('signing out here keeps the shortcuts; signing back in brings no copies', async (t) => {
  const { computer, signIn, cleanup } = await setup();
  t.after(cleanup);
  const pc = computer('pc');
  pc.store.add({ text: 'mine' });
  const { code } = await signIn(pc);
  const ended = [];
  pc.account.on('ended', (why) => ended.push(why));
  await pc.account.signOut();
  assert.deepStrictEqual([pc.account.state, ended, pc.store.shortcuts().length], ['signed-out', [], 1]);
  assert.ok(!fs.existsSync(path.join(pc.dir, 'sync', 'sync.json')));
  assert.strictEqual(pc.secrets.get('code'), null, 'the code is forgotten on sign-out');

  await signIn(pc);
  assert.strictEqual(pc.account.state, 'needs-code');
  await pc.account.enterCode(code);
  assert.deepStrictEqual([pc.store.shortcuts().map((s) => s.text), pc.store.trash()], [['mine'], []]);
});

test('deleting the account ends it on every computer, the shortcuts stay', async (t) => {
  const { server, clock, computer, signIn, cleanup } = await setup();
  t.after(cleanup);
  const pc = computer('pc');
  pc.store.add({ text: 'stays here' });
  const { code } = await signIn(pc);
  const mac = computer('mac');
  await signIn(mac);
  await mac.account.enterCode(code);
  const ended = [];
  pc.account.on('ended', (why) => ended.push(why));
  mac.account.on('ended', (why) => ended.push(`mac ${why}`));
  await pc.account.deleteAccount();
  assert.strictEqual(server.cloud.accounts.size, 0);
  assert.strictEqual(server.users.size, 0);
  clock.at += 61000;
  await mac.account.syncNow();
  assert.deepStrictEqual(ended.sort(), ['deleted', 'mac remote']);
  assert.deepStrictEqual([pc.store.shortcuts().length, mac.store.shortcuts().length], [1, 1]);
});

test('the sign-in link: a used or expired one says so; the port can only wait for one', async () => {
  const port = nextPort++;
  const link = await waitForLink({ port });
  await assert.rejects(waitForLink({ port }), /busy/);
  const page = await fetch(`http://127.0.0.1:${port}/auth?error=access_denied&error_description=Email+link+is+invalid+or+has+expired`);
  assert.match(await page.text(), /did not work/);
  await assert.rejects(link.code, /expired/);
  // and the port is free again
  (await waitForLink({ port })).close();
});

test('the cloud client: PKCE, the key on every request, a wrong verifier refused', async (t) => {
  const server = new FakeSupabase();
  const url = await server.start();
  t.after(() => server.stop());
  const cloud = new Cloud({ url, key: KEY });
  const verifier = await cloud.sendLink('x@example.com');
  assert.ok(verifier.length >= 43);
  await assert.rejects(cloud.finishSignIn(server.mail[0].code, 'wrong-verifier'), (e) => e.status === 400);
  const v2 = await cloud.sendLink('x@example.com');
  await cloud.finishSignIn(server.mail[1].code, v2);
  assert.strictEqual(cloud.email, 'x@example.com');
  assert.ok(cloud.sessionId);
  const wrongKey = new Cloud({ url, key: 'sb_publishable_wrong' });
  await assert.rejects(wrongKey.sendLink('x@example.com'), (e) => e.code === 'denied');
  await assert.rejects(new Cloud({ url: 'http://127.0.0.1:1', key: KEY }).sendLink('x@example.com'), (e) => e.code === 'offline');
});

test('config: from .env, the environment or the installed app\'s cloud.json; the secret key is refused', () => {
  const dir = tmpDir();
  const file = path.join(dir, '.env');
  const none = path.join(dir, 'none');
  fs.writeFileSync(file, '# comment\nKEYBRIDGE_SUPABASE_URL=https://abc.supabase.co/\nKEYBRIDGE_SUPABASE_KEY="sb_publishable_x"\n');
  assert.deepStrictEqual(cloudConfig({ env: {}, envFile: file, configFile: '' }), { url: 'https://abc.supabase.co', key: 'sb_publishable_x' });
  assert.deepStrictEqual(cloudConfig({ env: {}, envFile: none, configFile: '' }), { url: '', key: '' });
  assert.throws(() => cloudConfig({ env: { KEYBRIDGE_SUPABASE_KEY: 'sb_secret_x' }, envFile: file, configFile: '' }), /secret key/);
  // installed: written at build time next to the app
  const built = path.join(dir, 'cloud.json');
  fs.writeFileSync(built, JSON.stringify({ url: 'https://def.supabase.co', key: 'sb_publishable_y' }));
  assert.deepStrictEqual(cloudConfig({ env: {}, envFile: none, configFile: built }), { url: 'https://def.supabase.co', key: 'sb_publishable_y' });
  assert.throws(() => cloudConfig({ env: {}, envFile: none, configFile: (fs.writeFileSync(built, '{"url":"https://def.supabase.co","key":"sb_secret_z"}'), built) }), /secret key/);
});

test('without the project settings it works on this computer only', async () => {
  const store = new Store(tmpDir());
  store.load();
  const account = new Account({ dir: tmpDir(), url: '', key: '', store, deviceId: 'pc', platform: 'win', secrets: new Secrets(tmpDir()) });
  await account.start();
  assert.strictEqual(account.state, 'unconfigured');
  await assert.rejects(account.signIn('me@example.com'), (e) => e.code === 'not-configured');
});

test('secrets: sealed by the keychain function when there is one', () => {
  const dir = tmpDir();
  const flip = (buf) => Buffer.from(buf).reverse();
  const sealed = new Secrets(dir, { encrypt: (s) => flip(Buffer.from(s)), decrypt: (b) => flip(b).toString() });
  sealed.set('code', 'K7QM-4XRT-P9WE');
  assert.ok(!fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8').includes('K7QM'));
  assert.strictEqual(sealed.get('code'), 'K7QM-4XRT-P9WE');
  sealed.delete('code');
  assert.strictEqual(sealed.get('code'), null);
});

test('realtime: joins the account channel with the token, and a change nudges a sync', async (t) => {
  const { Realtime } = require('../src/main/realtime');
  const sent = [];
  class FakeWS {
    constructor(u) {
      this.url = u;
      this.readyState = 1;
      FakeWS.last = this;
      setImmediate(() => this.onopen());
    }
    send(m) {
      sent.push(JSON.parse(m));
    }
    close() {
      this.readyState = 3;
      if (this.onclose) this.onclose();
    }
  }
  const cloud = { userId: 'u1', token: async () => 'tok-1' };
  const rt = new Realtime({ url: 'https://abc.supabase.co', key: 'sb_publishable_x', cloud, WebSocketImpl: FakeWS });
  t.after(() => rt.stop());
  const seen = [];
  rt.on('connected', () => seen.push('connected'));
  rt.on('nudge', () => seen.push('nudge'));
  rt.start();
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.match(FakeWS.last.url, /^wss:\/\/abc\.supabase\.co\/realtime\/v1\/websocket\?apikey=sb_publishable_x&vsn=1\.0\.0$/);
  const join = sent[0];
  assert.deepStrictEqual([join.topic, join.event, join.payload.access_token, join.payload.config.postgres_changes[0].filter], ['realtime:keybridge-u1', 'phx_join', 'tok-1', 'user_id=eq.u1']);
  const msg = (m) => FakeWS.last.onmessage({ data: JSON.stringify(m) });
  msg({ topic: join.topic, event: 'phx_reply', ref: join.ref, payload: { status: 'ok' } });
  msg({ topic: join.topic, event: 'postgres_changes', payload: { data: { type: 'UPDATE' } } });
  msg({ topic: 'realtime:other', event: 'postgres_changes', payload: {} });
  assert.deepStrictEqual(seen, ['connected', 'nudge']);
  rt.updateToken('tok-2');
  assert.deepStrictEqual([sent.at(-1).event, sent.at(-1).payload.access_token], ['access_token', 'tok-2']);
});
