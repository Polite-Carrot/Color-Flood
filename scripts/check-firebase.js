#!/usr/bin/env node
/* check-firebase.js — refuse to sync a native build that would crash.
 *
 * The Firebase Analytics plugin calls FirebaseApp.configure() from its
 * load(), and load() runs at bridge startup — so on iOS, an app bundled
 * without GoogleService-Info.plist does not fail to build and does not fail
 * to send events. It CRASHES, on launch, on the tester's phone, with a
 * message about a missing configuration file that is nowhere in this
 * repository. That is an expensive way to find out, and this is the cheap
 * one.
 *
 * The two files are per-app, downloaded from the Firebase console, and
 * gitignored: they name a project rather than being secret, but they are
 * nobody else's to copy and they differ per app.
 *
 * Set ALLOW_NO_FIREBASE=1 to sync anyway — useful for a web-only check, and
 * for anyone who has removed the plugin. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const wanted = [
  ['android/app/google-services.json', 'Android'],
  ['ios/App/App/GoogleService-Info.plist', 'iOS'],
];

const missing = wanted.filter(([rel]) => !fs.existsSync(path.join(root, rel)));
if (!missing.length) process.exit(0);

if (process.env.ALLOW_NO_FIREBASE === '1') {
  for (const [rel, os] of missing) console.warn('! ' + os + ' has no ' + rel + ' — analytics will not report');
  process.exit(0);
}

console.error('');
console.error('Firebase is wired up but not configured. Missing:');
for (const [rel, os] of missing) console.error('  ' + rel + '   (' + os + ')');
console.error('');
console.error('Download them from the Firebase console — Project settings > Your apps,');
console.error('for the com.politecarrot.colorflood app on each platform — and put them at');
console.error('those paths. They are gitignored on purpose.');
console.error('');
console.error('An iOS build without its plist CRASHES ON LAUNCH, so this is a stop rather');
console.error('than a warning. ALLOW_NO_FIREBASE=1 npm run sync to go ahead anyway.');
console.error('');
process.exit(1);
