import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* The CLI loads this before every command that reads the config — sync, copy,
   update, open, run — so `npx cap sync` alone regathers www/ first and can
   never ship a stale bundle. Same arrangement as color-sorting. */
const root = path.dirname(fileURLToPath(import.meta.url));
for (const script of ['scripts/check-firebase.js', 'scripts/sync-www.js']) {
  try {
    execFileSync(process.execPath, [path.join(root, script)], { cwd: root, stdio: 'inherit' });
  } catch {
    process.exit(1);
  }
}

/* Named exports, not a default: the CLI require()s this ES module and reads the namespace as the config. */
export const appId = 'com.politecarrot.colorflood';
export const appName = 'Color Flood';
export const webDir = 'www';
export const backgroundColor = '#a5e2fa';
