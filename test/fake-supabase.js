'use strict';
// A stand-in for the Supabase project, over real HTTP on localhost: the auth endpoints KeyBridge uses
// (email link with PKCE, tokens, renewal, sign-out) and the REST calls for the tables and functions
// in supabase/migrations, with the rows kept by FakeCloud. "Emails" land in `mail` instead.
const http = require('http');
const crypto = require('crypto');
const { FakeCloud } = require('./fake-cloud');

const KEY = 'sb_publishable_test';
const b64url = (s) => Buffer.from(s).toString('base64url');

class FakeSupabase {
  constructor({ now = Date.now } = {}) {
    this.now = now;
    this.cloud = new FakeCloud();
    this.users = new Map(); // email -> id
    this.profiles = new Map(); // user id -> key_check
    this.devices = new Map(); // user id -> Map(device id -> row)
    this.sessions = new Map(); // session id -> { userId, revoked }
    this.tokens = new Map(); // access token -> { userId, sessionId, exp }
    this.refreshTokens = new Map(); // refresh token -> session id
    this.pending = new Map(); // auth code -> { email, challenge }
    this.mail = []; // { email, code, redirectTo }
    this.calls = [];
    this.tokenLife = 3600;
  }

  start() {
    this.server = http.createServer((req, res) => this._handle(req, res));
    return new Promise((r) => this.server.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${this.server.address().port}`)));
  }

  stop() {
    return new Promise((r) => this.server.close(r));
  }

  _issue(userId, sessionId) {
    const exp = Math.floor(this.now() / 1000) + this.tokenLife;
    const access = `${b64url('{"alg":"none"}')}.${b64url(JSON.stringify({ sub: userId, session_id: sessionId, exp }))}.${crypto.randomBytes(8).toString('hex')}`;
    const refresh = crypto.randomBytes(12).toString('hex');
    this.tokens.set(access, { userId, sessionId, exp });
    this.refreshTokens.set(refresh, sessionId);
    const email = [...this.users].find(([, id]) => id === userId)[0];
    return { access_token: access, refresh_token: refresh, expires_in: this.tokenLife, expires_at: exp, token_type: 'bearer', user: { id: userId, email } };
  }

  // Like the real data server: a token is good until it runs out, even if its session was ended.
  _token(req) {
    const t = this.tokens.get(String(req.headers.authorization || '').replace(/^Bearer /, ''));
    return t && t.exp * 1000 > this.now() ? t : null;
  }

  _userExists(id) {
    return [...this.users.values()].includes(id);
  }

  async _handle(req, res) {
    const url = new URL(req.url, 'http://x');
    let body = '';
    for await (const chunk of req) body += chunk;
    const json = body ? JSON.parse(body) : null;
    const send = (status, data) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(data === undefined ? '' : JSON.stringify(data));
    };
    this.calls.push(`${req.method} ${url.pathname}`);
    if (req.headers.apikey !== KEY) return send(401, { message: 'Invalid API key' });
    const p = url.pathname;

    if (p === '/auth/v1/otp') {
      const email = json.email.toLowerCase();
      if (!this.users.has(email)) this.users.set(email, crypto.randomUUID());
      const code = crypto.randomUUID();
      this.pending.set(code, { email, challenge: json.code_challenge, method: json.code_challenge_method });
      this.mail.push({ email, code, redirectTo: url.searchParams.get('redirect_to') });
      return send(200, {});
    }
    if (p === '/auth/v1/token' && url.searchParams.get('grant_type') === 'pkce') {
      const pend = this.pending.get(json.auth_code);
      const hash = crypto.createHash('sha256').update(json.code_verifier || '').digest('base64url');
      if (!pend || pend.method !== 's256' || hash !== pend.challenge) return send(400, { error_code: 'bad_code_verifier' });
      this.pending.delete(json.auth_code);
      const sessionId = crypto.randomUUID();
      this.sessions.set(sessionId, { userId: this.users.get(pend.email), revoked: false });
      return send(200, this._issue(this.users.get(pend.email), sessionId));
    }
    if (p === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      const sessionId = this.refreshTokens.get(json.refresh_token);
      const s = sessionId && this.sessions.get(sessionId);
      if (!s || s.revoked || ![...this.users.values()].includes(s.userId)) return send(400, { error_code: 'refresh_token_not_found' });
      this.refreshTokens.delete(json.refresh_token);
      return send(200, this._issue(s.userId, sessionId));
    }

    const t = this._token(req);
    if (!t) return send(401, { code: 'PGRST301', message: 'JWT expired' });
    const uid = t.userId;
    // the sign-in service checks the session and the user right away
    if (p === '/auth/v1/user') {
      if (!this._userExists(uid)) return send(403, { error_code: 'user_not_found' });
      if (this.sessions.get(t.sessionId).revoked) return send(403, { error_code: 'session_not_found' });
      return send(200, { id: uid });
    }
    // a deleted account's rows are gone; writing fails on the missing user
    if (!this._userExists(uid) && req.method !== 'GET') return send(409, { code: '23503' });
    if (p === '/auth/v1/logout') {
      this.sessions.get(t.sessionId).revoked = true;
      return send(204);
    }
    if (p === '/rest/v1/profiles' && req.method === 'GET') {
      return send(200, this.profiles.has(uid) ? [{ key_check: this.profiles.get(uid) }] : []);
    }
    if (p === '/rest/v1/rpc/set_key_check') {
      if (this.profiles.get(uid)) return send(200, false);
      this.profiles.set(uid, json.check_value);
      return send(200, true);
    }
    if (p === '/rest/v1/items' && req.method === 'GET') {
      const cursor = Number(url.searchParams.get('rev').replace('gt.', ''));
      return send(200, await this.cloud.backend(uid).pull(cursor, Number(url.searchParams.get('limit'))));
    }
    if (p === '/rest/v1/rpc/push_items') return send(200, await this.cloud.backend(uid).push(json.changes));
    if (p === '/rest/v1/devices' && req.method === 'POST') {
      if (json.user_id !== uid) return send(403, { code: '42501' });
      if (!this.devices.has(uid)) this.devices.set(uid, new Map());
      this.devices.get(uid).set(json.id, json);
      return send(201);
    }
    if (p === '/rest/v1/devices' && req.method === 'GET') return send(200, [...(this.devices.get(uid) || new Map()).values()]);
    if (p === '/rest/v1/rpc/sign_out_device') {
      const d = this.devices.get(uid) && this.devices.get(uid).get(json.device_id);
      if (d && this.sessions.has(d.session_id)) this.sessions.get(d.session_id).revoked = true;
      if (d) this.devices.get(uid).delete(json.device_id);
      return send(200, null);
    }
    if (p === '/rest/v1/rpc/delete_account') {
      for (const [email, id] of this.users) if (id === uid) this.users.delete(email);
      this.cloud.accounts.delete(uid);
      this.profiles.delete(uid);
      this.devices.delete(uid);
      return send(200, null);
    }
    return send(404, { message: `no ${req.method} ${p} here` });
  }
}

module.exports = { FakeSupabase, KEY };
