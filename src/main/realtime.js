'use strict';
// A nudge from the cloud: when another computer changes the account's items, Supabase Realtime says
// so over a WebSocket, and this computer syncs right away. Only the nudge is used - the change
// itself comes through the normal sync, sealed as always.
const { EventEmitter } = require('events');

const HEARTBEAT = 25000;
const RETRY = [2000, 5000, 15000, 30000, 60000];

class Realtime extends EventEmitter {
  constructor({ url, key, cloud, WebSocketImpl = globalThis.WebSocket }) {
    super();
    Object.assign(this, { url: url.replace(/\/+$/, ''), key, cloud, WebSocketImpl });
    this.ws = null;
    this.stopped = true;
    this.failures = 0;
    this.ref = 0;
  }

  start() {
    if (this.ws || !this.WebSocketImpl) return;
    this.stopped = false;
    const ws = new this.WebSocketImpl(`${this.url.replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=${encodeURIComponent(this.key)}&vsn=1.0.0`);
    this.ws = ws;
    this.topic = `realtime:keybridge-${this.cloud.userId}`;
    ws.onopen = async () => {
      let token;
      try {
        token = await this.cloud.token();
      } catch {
        ws.close();
        return;
      }
      this._send(this.topic, 'phx_join', {
        config: {
          broadcast: { self: false },
          presence: { key: '' },
          postgres_changes: [{ event: '*', schema: 'public', table: 'items', filter: `user_id=eq.${this.cloud.userId}` }],
          private: false,
        },
        access_token: token,
      });
      this.beat = setInterval(() => this._send('phoenix', 'heartbeat', {}), HEARTBEAT);
      if (this.beat.unref) this.beat.unref();
    };
    ws.onmessage = (msg) => {
      let m;
      try {
        m = JSON.parse(typeof msg.data === 'string' ? msg.data : String(msg.data));
      } catch {
        return;
      }
      if (m.topic !== this.topic) return;
      if (m.event === 'phx_reply' && m.payload && m.payload.status === 'ok' && m.ref === this.joinRef) {
        this.failures = 0;
        this.emit('connected'); // catch up on anything missed while not connected
      } else if (m.event === 'postgres_changes') {
        this.emit('nudge');
      } else if ((m.event === 'phx_reply' && m.payload && m.payload.status === 'error') || m.event === 'phx_error') {
        ws.close();
      }
    };
    ws.onerror = () => {}; // onclose follows
    ws.onclose = () => {
      clearInterval(this.beat);
      if (this.ws === ws) this.ws = null;
      if (this.stopped) return;
      const wait = RETRY[Math.min(this.failures++, RETRY.length - 1)];
      this.retry = setTimeout(() => this.start(), wait);
      if (this.retry.unref) this.retry.unref();
    };
  }

  _send(topic, event, payload) {
    if (!this.ws || this.ws.readyState !== 1) return;
    const ref = String(++this.ref);
    if (event === 'phx_join') this.joinRef = ref;
    this.ws.send(JSON.stringify({ topic, event, payload, ref, join_ref: this.joinRef }));
  }

  // A renewed token, so the channel keeps receiving.
  updateToken(token) {
    this._send(this.topic, 'access_token', { access_token: token });
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.retry);
    clearInterval(this.beat);
    if (this.ws) this.ws.close();
    this.ws = null;
  }
}

module.exports = { Realtime };
