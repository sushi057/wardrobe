// Where things live and how OpenCLI is called. Defaults match the owner's dev setup; the packaged
// launcher (launcher.js) sets the WARDROBE_* variables for installed copies.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const DATA = path.resolve(process.env.WARDROBE_DATA || path.join(ROOT, 'data'));
export const PORT = Number(process.env.PORT || 5181);

// Chrome profile for every OpenCLI call. Fail-safe default is 'research': on the owner's machine
// OpenCLI's default profile is a different account. Installed copies run with WARDROBE_PROFILE=auto,
// which omits --profile so OpenCLI uses the one Chrome profile that has the extension.
const rawProfile = (process.env.WARDROBE_PROFILE ?? 'research').trim();
export const PROFILE = rawProfile === '' || rawProfile === 'auto' ? null : rawProfile;
export const profileArgs = () => (PROFILE ? ['--profile', PROFILE] : []);

// Safety net for auto mode: if this machine has named OpenCLI profiles, which one is meant is unclear,
// so refuse rather than guess (set WARDROBE_PROFILE to the right alias instead).
export function profileProblem() {
  if (PROFILE) return null;
  const file = path.join(process.env.OPENCLI_CONFIG_DIR || path.join(os.homedir(), '.opencli'), 'browser-profiles.json');
  try {
    const aliases = Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).aliases || {});
    if (aliases.length) return `This computer has named OpenCLI profiles (${aliases.join(', ')}). Start Wardrobe with WARDROBE_PROFILE set to the one to use.`;
  } catch { /* no profile config: one Chrome profile, nothing to choose */ }
  return null;
}

// Installed copies ship their own pinned OpenCLI in node_modules (no PATH needed). The owner's dev
// checkout has none, so it keeps using the global `opencli` and never fights it over the daemon.
const LOCAL_OPENCLI = path.join(ROOT, 'node_modules', '@jackwener', 'opencli', 'dist', 'src', 'main.js');
export function opencliCommand(args) {
  if (fs.existsSync(LOCAL_OPENCLI)) return { cmd: process.execPath, argv: [LOCAL_OPENCLI, ...args] };
  if (process.platform === 'win32') throw new Error('OpenCLI is missing from this install. Run the Wardrobe install line again.');
  return { cmd: 'opencli', argv: args };
}

// Child processes (OpenCLI and the daemon it starts) must find this same Node.
export function childEnv(extra = {}) {
  const sep = process.platform === 'win32' ? ';' : ':';
  const key = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  return { ...process.env, [key]: `${path.dirname(process.execPath)}${sep}${process.env[key] || ''}`, NO_COLOR: '1', ...extra };
}

