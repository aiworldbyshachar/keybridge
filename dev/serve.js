'use strict';
// Static file server for previewing the window in a browser with the stand-in API (dev/mock-api.js):
//   node dev/serve.js  ->  http://localhost:5180/src/renderer/index.html
// Query options: ?lang=he  &platform=darwin  &account=ready|signed-out|waiting|code|offline|local
//   &state=paused|permission|helper-error|first-run|empty  &sheet=editor|new|trash|settings|account|code|group
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const types = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

http
  .createServer((req, res) => {
    const file = path.normalize(path.join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!file.startsWith(root) || file.includes(`${path.sep}.env`)) return res.writeHead(403).end();
    fs.readFile(file, (err, data) => {
      if (err) return res.writeHead(404).end('not found');
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  })
  .listen(5180, '127.0.0.1', () => console.log('preview at http://localhost:5180/src/renderer/index.html'));
