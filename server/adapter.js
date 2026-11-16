// Keeps OpenCLI's copies of Wardrobe's adapters in step with this app: adapters/lib.js goes to
// ~/.opencli/wardrobe-lib.js and adapters/<site>/*.js to ~/.opencli/clis/<site>/. Runs on every server
// start (and via `npm run adapters:install`); only files that changed are written.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from './config.js';

const OPENCLI_DIR = path.join(os.homedir(), '.opencli'); // OpenCLI always reads user adapters from here

function sync(src, dest) {
  const want = fs.readFileSync(src);
  if (fs.existsSync(dest) && fs.readFileSync(dest).equals(want)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(`${dest}.tmp`, want);
  fs.renameSync(`${dest}.tmp`, dest);
  return true;
}

export function installAdapters() {
  const dir = path.join(ROOT, 'adapters');
  const written = [];
  try {
    if (sync(path.join(dir, 'lib.js'), path.join(OPENCLI_DIR, 'wardrobe-lib.js'))) written.push('wardrobe-lib.js');
    for (const site of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!site.isDirectory()) continue;
      for (const file of fs.readdirSync(path.join(dir, site.name))) {
        if (!file.endsWith('.js')) continue;
        if (sync(path.join(dir, site.name, file), path.join(OPENCLI_DIR, 'clis', site.name, file))) written.push(`${site.name}/${file}`);
      }
    }
    if (written.length) console.log(`installed OpenCLI adapters: ${written.join(', ')}`);
  } catch (e) {
    console.error(`could not install the OpenCLI adapters: ${e.message}`);
  }
}

// Kept for older imports.
export const installAdapter = installAdapters;

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) installAdapters();
