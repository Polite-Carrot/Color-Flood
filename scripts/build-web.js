#!/usr/bin/env node
/* build-web.js — assemble the deployable site into dist/.
 *
 *   node scripts/build-web.js
 *
 * Two steps and no bundler: tsc turns src/ into plain ES modules under dist/,
 * and everything in web/ is copied over the top. index.html loads
 * web/app.js as a module and the browser follows the imports from there.
 *
 * Nothing here is fetched at run time — the fonts are inlined in fonts.css,
 * the icon is a local SVG, and the levels are generated in the page. So the
 * site works offline once loaded, and works from a file:// URL too, save for
 * the module loading that browsers reserve for http.
 *
 * BASE is the sub-path a project Pages site lives under, e.g. /Color-Flood.
 * Nothing in the page uses an absolute URL, so it is only needed for the
 * canonical link and the manifest-ish metadata — but a hardcoded one would
 * break on a fork or a rename, so it is passed in rather than written down. */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const dist = path.join(root, 'dist');

fs.rmSync(dist, { recursive: true, force: true });

console.log('compiling src/ …');
execFileSync('npx', ['tsc', '-p', 'tsconfig.build.json'], { cwd: root, stdio: 'inherit' });

console.log('copying web/ …');
fs.cpSync(path.join(root, 'web'), dist, { recursive: true });

/* Pages runs Jekyll over whatever it is given unless told not to, and Jekyll
   silently drops anything it does not recognise. Nothing here starts with an
   underscore today, but the file costs nothing and the failure it prevents is
   a 404 with no error anywhere. */
fs.writeFileSync(path.join(dist, '.nojekyll'), '');

const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else files.push(full);
  }
})(dist);

const total = files.reduce((n, f) => n + fs.statSync(f).size, 0);
console.log('wrote ' + files.length + ' files, ' + (total / 1024).toFixed(0) + ' KB, into dist/');
