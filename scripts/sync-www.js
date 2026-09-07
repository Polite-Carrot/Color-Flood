#!/usr/bin/env node
/* sync-www.js — gather the site into www/ for the native builds.
 *
 *   node scripts/sync-www.js
 *
 * The web build serves this repository's ROOT: index.html sits beside src/,
 * scripts/ and node_modules/, and GitHub Pages is happy to ignore the rest.
 * Capacitor is not — it copies its webDir wholesale into the app bundle, so
 * pointing it at the root would ship the TypeScript, the tests and every
 * dependency inside the .ipa. www/ is the same site with only the files a
 * player needs.
 *
 * Generated, and gitignored: the one copy that matters is the root. */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const www = path.join(root, 'www');

/* Rebuild js/ first. Running `cap sync` on a stale www/ is the failure this
   exists to prevent: the app would ship whatever the last build left behind,
   silently, and only on the phone. */
execFileSync('npx', ['tsc', '-p', 'tsconfig.build.json'], { cwd: root, stdio: 'inherit' });

fs.rmSync(www, { recursive: true, force: true });
fs.mkdirSync(www, { recursive: true });

/* Taken from index.html rather than listed here, so a stylesheet or a module
   added to the page cannot be left out of the app. Only the local ones — a
   URL is not ours to copy. */
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const referenced = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((ref) => !/^(https?:)?\/\//.test(ref) && !ref.startsWith('#'));

const wanted = new Set(['index.html', ...referenced]);
/* js/app.js pulls in the other modules, and they are not named in the page —
   so the whole folder goes. */
wanted.add('js');

for (const entry of wanted) {
  const from = path.join(root, entry);
  if (!fs.existsSync(from)) throw new Error('index.html refers to ' + entry + ', which is not there');
  const to = path.join(www, entry);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
}

let files = 0;
let bytes = 0;
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else { files++; bytes += fs.statSync(full).size; }
  }
})(www);
console.log('www/ holds ' + files + ' files, ' + (bytes / 1024).toFixed(0) + ' KB');
