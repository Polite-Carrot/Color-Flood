#!/usr/bin/env node
/* serve.js — look at the built site.
 *
 *   npm run build:web && npm run serve
 *
 * ES modules will not load over file://, so there has to be a server, and
 * this is the smallest one that will do: static files out of dist/, correct
 * content types, no dependencies. Not meant for anything but a local look. */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const port = Number(process.env.PORT) || 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
};

http.createServer((req, res) => {
  const asked = decodeURIComponent((req.url || '/').split('?')[0]);
  const rel = asked.endsWith('/') ? asked + 'index.html' : asked;
  /* Resolve, then check the result is still inside dist — a request for
     /../../etc/passwd is otherwise served happily. */
  const file = path.resolve(dist, '.' + rel);
  if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('not here: ' + rel);
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
}).listen(port, () => console.log('serving dist/ on http://localhost:' + port));
