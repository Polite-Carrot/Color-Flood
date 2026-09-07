#!/usr/bin/env node
/* serve.js — look at the site the way Pages will.
 *
 *   npm run build && npm run serve
 *
 * Serves the repository root, because that is what gets published: Pages
 * serves this branch's root directly, so the root IS the site. ES modules
 * will not load over file://, so there has to be a server, and this is the
 * smallest one that will do. Not meant for anything but a local look. */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT) || 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

http.createServer((req, res) => {
  const asked = decodeURIComponent((req.url || '/').split('?')[0]);
  const rel = asked.endsWith('/') ? asked + 'index.html' : asked;
  /* Resolve, then check the result is still inside the root — a request for
     /../../etc/passwd is otherwise served happily. */
  const file = path.resolve(root, '.' + rel);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('not here: ' + rel);
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
}).listen(port, () => console.log('serving the repository root on http://localhost:' + port));
