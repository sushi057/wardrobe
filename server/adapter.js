// Keeps OpenCLI's copy of the Gemini try-on adapter in step with this app (replaces the manual
// `npm run adapters:install` step on installed copies; harmless in dev).
import fs from 'node:fs';
import path from 'node:path';
import { ADAPTER_DIR, ROOT } from './config.js';

export function installAdapter() {
  const src = path.join(ROOT, 'adapters', 'gemini', 'tryon.js');
  const dest = path.join(ADAPTER_DIR, 'tryon.js');
  try {
    const want = fs.readFileSync(src);
    if (fs.existsSync(dest) && fs.readFileSync(dest).equals(want)) return;
    fs.mkdirSync(ADAPTER_DIR, { recursive: true });
    fs.writeFileSync(`${dest}.tmp`, want);
    fs.renameSync(`${dest}.tmp`, dest);
    console.log(`installed try-on adapter -> ${dest}`);
  } catch (e) {
    console.error(`could not install the try-on adapter: ${e.message}`);
  }
}
