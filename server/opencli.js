// The one place that starts OpenCLI. Always adds the configured Chrome profile (see config.js).
import { spawn } from 'node:child_process';
import os from 'node:os';
import { PROFILE, childEnv, opencliCommand, profileArgs, profileProblem } from './config.js';

/** Start `opencli [--profile P] <args>`; returns the child process. Throws if OpenCLI is missing. */
export function spawnOpencli(args, env = {}) {
  const problem = profileProblem();
  if (problem) throw new Error(problem);
  const { cmd, argv } = opencliCommand([...profileArgs(), ...args]);
  // OpenCLI also reads OPENCLI_PROFILE; pin it to the same profile so nothing can fall back to another.
  // cwd = home: OpenCLI's daemon inherits it and must not lock the app folder on Windows.
  return spawn(cmd, argv, { cwd: os.homedir(), env: childEnv({ ...(PROFILE ? { OPENCLI_PROFILE: PROFILE } : {}), ...env }), windowsHide: true });
}

/** OpenCLI prints one JSON envelope (single- or multi-line), sometimes followed by an update notice. */
export function parseEnvelope(out) {
  const line = out.split('\n').find((l) => l.trim().startsWith('{'));
  try { if (line) return JSON.parse(line); } catch { /* multi-line */ }
  const a = out.indexOf('{');
  const b = out.lastIndexOf('}');
  try { if (a >= 0 && b > a) return JSON.parse(out.slice(a, b + 1)); } catch { /* not JSON */ }
  return null;
}

/** Run a short OpenCLI command and return its JSON envelope ({ ok, data | error }). Never throws.
 *  OpenCLI prints JSON by default; not every command accepts `-f`. */
export function opencliJson(args, timeoutMs = 30_000) {
  return new Promise((resolve) => {
    let child;
    try { child = spawnOpencli(args); }
    catch (e) { resolve({ ok: false, error: { code: 'missing', message: e.message } }); return; }
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, error: { code: 'spawn', message: e.message } }); });
    child.on('close', () => {
      clearTimeout(timer);
      resolve(parseEnvelope(out) || { ok: false, error: { code: 'unparsed', message: (err || out).trim().slice(0, 400) } });
    });
  });
}
