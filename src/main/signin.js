'use strict';
// Catches the sign-in link: a tiny web server on this computer only (localhost:47822, both the IPv4
// and the IPv6 loopback, since browsers may try either) that waits for the browser to land on
// /auth?code=... after the link in the email is opened, once.
const http = require('http');

const PORT = 47822;

const page = (title, line) => `<!doctype html><meta charset="utf-8"><title>KeyBridge</title>
<style>body{font:16px system-ui,sans-serif;display:grid;place-items:center;height:90vh;margin:0;color:#1d2433;background:#f6f7fb}
@media (prefers-color-scheme:dark){body{color:#e8ebf2;background:#151821}}div{text-align:center;max-width:28rem;padding:0 16px}</style>
<div><h1>${title}</h1><p>${line}</p></div>
<script>if (location.hash.includes('error')) fetch('/auth/failed?' + location.hash.slice(1));</script>`;

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}

// -> { code, close } once it listens; `code` resolves with the code from the link, or rejects if
// the link failed (expired, used already) or nothing came in `timeout` ms.
async function waitForLink({ port = PORT, timeout = 15 * 60 * 1000 } = {}) {
  let settle;
  const code = new Promise((resolve, reject) => {
    settle = { resolve, reject };
  });
  code.catch(() => {});
  const servers = [];
  let timer = null;
  const finish = (err, value) => {
    clearTimeout(timer);
    for (const s of servers) s.close();
    if (err) settle.reject(err);
    else settle.resolve(value);
  };

  const handle = (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const reply = (status, html) => {
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', connection: 'close' });
      res.end(html);
    };
    if (url.pathname === '/auth' && url.searchParams.get('code')) {
      reply(200, page('Signed in', 'You can close this tab and go back to KeyBridge.'));
      finish(null, url.searchParams.get('code'));
    } else if (url.pathname === '/auth/failed' || (url.pathname === '/auth' && url.searchParams.get('error'))) {
      const why = url.searchParams.get('error_description') || url.searchParams.get('error_code') || url.searchParams.get('error') || 'the link did not work';
      reply(200, page('That link did not work', `${escapeHtml(why)}. Ask KeyBridge for a new email.`));
      finish(new Error(why));
    } else if (url.pathname === '/auth') {
      // errors come after "#", which only the page sees: it reports them to /auth/failed
      reply(200, page('One moment...', ''));
    } else {
      reply(404, page('Not here', ''));
    }
  };

  try {
    servers.push(await listen(http.createServer(handle), port, '127.0.0.1'));
  } catch (err) {
    throw err.code === 'EADDRINUSE' ? new Error(`port ${port} is busy - is KeyBridge already waiting for a link?`) : err;
  }
  try {
    servers.push(await listen(http.createServer(handle), port, '::1'));
  } catch {
    // no IPv6 here: the IPv4 one is enough
  }
  timer = setTimeout(() => finish(new Error('no link came in time')), timeout);
  timer.unref();
  return { code, close: () => finish(new Error('cancelled')) };
}

module.exports = { waitForLink, PORT };
