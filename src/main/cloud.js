'use strict';
// The Supabase project: sign-in by email link, and the account's rows (supabase/migrations).
// Plain HTTPS requests - no Supabase library, the family keeps to what Node and Electron bring.
//
// Sign-in uses PKCE: this computer makes a secret (the verifier) and sends only its hash with the
// email request; the link in the email comes back to http://localhost:47822/auth?code=..., and the
// code is worth something only together with the verifier, which never left this computer.
const crypto = require('crypto');
const { EventEmitter } = require('events');

const REDIRECT = 'http://localhost:47822/auth';

class CloudError extends Error {
  constructor(code, status = 0, detail = '') {
    super(`cloud: ${code}${detail ? ` (${detail})` : ''}`);
    this.code = code;
    this.status = status;
  }
}

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function pkce() {
  const verifier = b64url(crypto.randomBytes(48));
  return { verifier, challenge: b64url(crypto.createHash('sha256').update(verifier).digest()) };
}

// The claims inside an access token (not checked here - the server checks it on every request).
function claims(token) {
  try {
    return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8'));
  } catch {
    return {};
  }
}

class Cloud extends EventEmitter {
  constructor({ url, key, session = null, fetch = globalThis.fetch, now = Date.now }) {
    super();
    if (!url || !key) throw new CloudError('not-configured');
    Object.assign(this, { url: url.replace(/\/+$/, ''), key, session, fetchImpl: fetch, now });
    this.refreshing = null;
  }

  get userId() {
    return (this.session && this.session.user && this.session.user.id) || '';
  }

  get email() {
    return (this.session && this.session.user && this.session.user.email) || '';
  }

  async _fetch(path, { method = 'GET', body, auth = true, headers = {} } = {}) {
    const h = { apikey: this.key, ...headers };
    if (body !== undefined) h['content-type'] = 'application/json';
    if (auth) h.authorization = `Bearer ${await this.token()}`;
    let res;
    try {
      res = await this.fetchImpl(this.url + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (err) {
      throw new CloudError('offline', 0, err.message);
    }
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {}
    if (!res.ok) {
      const detail = (data && (data.error_code || data.code || data.msg || data.message || data.error_description)) || '';
      throw new CloudError(res.status === 401 || res.status === 403 ? 'denied' : res.status === 429 ? 'too-many' : 'failed', res.status, String(detail));
    }
    return data;
  }

  // A request as the signed-in user; an expired token is renewed once and the request tried again.
  async _call(path, opts = {}) {
    try {
      return await this._fetch(path, opts);
    } catch (err) {
      if (err.status !== 401 || !this.session) throw err;
      await this.refresh();
      return this._fetch(path, opts);
    }
  }

  // --- sign-in

  // Sends the sign-in email. Keep the returned verifier for finishSignIn.
  async sendLink(email, redirectTo = REDIRECT) {
    const { verifier, challenge } = pkce();
    const query = `?redirect_to=${encodeURIComponent(redirectTo)}`;
    await this._fetch(`/auth/v1/otp${query}`, {
      method: 'POST',
      auth: false,
      body: { email: String(email).trim(), create_user: true, code_challenge: challenge, code_challenge_method: 's256' },
    });
    return verifier;
  }

  // The code from the link + the verifier -> a session.
  async finishSignIn(code, verifier) {
    const session = await this._fetch('/auth/v1/token?grant_type=pkce', { method: 'POST', auth: false, body: { auth_code: code, code_verifier: verifier } });
    this._setSession(session);
    return this.session;
  }

  _setSession(s) {
    if (!s || !s.access_token || !s.refresh_token) throw new CloudError('bad-session');
    const expiresAt = s.expires_at ? s.expires_at * 1000 : this.now() + (s.expires_in || 3600) * 1000;
    this.session = { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: expiresAt, user: { id: s.user && s.user.id, email: s.user && s.user.email } };
    this.emit('session', this.session);
  }

  // A fresh access token, renewing it a minute before it runs out.
  async token() {
    if (!this.session) throw new CloudError('signed-out');
    if (this.session.expires_at - this.now() < 60000) await this.refresh();
    return this.session.access_token;
  }

  refresh() {
    if (!this.refreshing) {
      this.refreshing = (async () => {
        if (!this.session) throw new CloudError('signed-out');
        try {
          const s = await this._fetch('/auth/v1/token?grant_type=refresh_token', { method: 'POST', auth: false, body: { refresh_token: this.session.refresh_token } });
          this._setSession(s);
        } catch (err) {
          // the session was ended (signed out from another computer, or the account deleted)
          if (err.status === 400 || err.status === 401 || err.status === 403) {
            this.session = null;
            this.emit('signed-out');
            throw new CloudError('signed-out', err.status);
          }
          throw err;
        }
      })().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  async signOut() {
    if (!this.session) return;
    try {
      await this._fetch('/auth/v1/logout?scope=local', { method: 'POST' });
    } catch {}
    this.session = null;
    this.emit('signed-out');
  }

  // Whether this session still exists. The data server accepts a token until it runs out (up to an
  // hour), but the sign-in service knows at once when the session was ended from another computer
  // or the account deleted: then this throws CloudError('ended').
  async checkSession() {
    try {
      await this._call('/auth/v1/user');
    } catch (err) {
      if (err.code === 'signed-out' || err.status === 401 || err.status === 403 || err.status === 404) {
        this.session = null;
        this.emit('signed-out');
        throw new CloudError('ended', err.status);
      }
      throw err;
    }
  }

  // The session id inside the token, so another computer can sign this one out.
  get sessionId() {
    return (this.session && claims(this.session.access_token).session_id) || null;
  }

  // --- the account's rows

  async profile() {
    const rows = await this._call(`/rest/v1/profiles?select=key_check&user_id=eq.${this.userId}`);
    return rows && rows[0] ? rows[0] : null;
  }

  async setKeyCheck(check) {
    return (await this._call('/rest/v1/rpc/set_key_check', { method: 'POST', body: { check_value: check } })) === true;
  }

  // What sync.js needs: { pull(cursor, limit), push(changes) }.
  backend() {
    return {
      pull: (cursor, limit) => this._call(`/rest/v1/items?select=id,rev,data,deleted,device&rev=gt.${Number(cursor) || 0}&order=rev.asc&limit=${limit}`),
      push: (changes) => this._call('/rest/v1/rpc/push_items', { method: 'POST', body: { changes } }),
    };
  }

  devices() {
    return this._call('/rest/v1/devices?select=id,name,platform,last_seen&order=last_seen.desc');
  }

  saveDevice({ id, name, platform }) {
    return this._call('/rest/v1/devices?on_conflict=user_id,id', {
      method: 'POST',
      headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
      body: { user_id: this.userId, id, name, platform, session_id: this.sessionId, last_seen: new Date(this.now()).toISOString() },
    });
  }

  signOutDevice(id) {
    return this._call('/rest/v1/rpc/sign_out_device', { method: 'POST', body: { device_id: id } });
  }

  async deleteAccount() {
    await this._call('/rest/v1/rpc/delete_account', { method: 'POST', body: {} });
    this.session = null;
    this.emit('signed-out');
  }
}

module.exports = { Cloud, CloudError, REDIRECT, pkce, claims };
