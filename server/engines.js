// Image engines. Every engine runs through OpenCLI via server/opencli.js, which always applies the
// configured Chrome profile (config.js; 'research' on the owner's machine).
import os from 'node:os';
import path from 'node:path';
import { PROFILE, profileProblem } from './config.js';
import { rememberFocus } from './focus.js';
import { opencliJson, parseEnvelope, spawnOpencli } from './opencli.js';

const TIMEOUT_MS = 240_000;

export class EngineError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function classify(text) {
  const t = text.toLowerCase();
  if (t.includes('session_busy') || t.includes('is busy')) return 'busy';
  if (t.includes('no_image') || t.includes('no generated image') || t.includes('empty_result') || t.includes('returned no data')) return 'no_image';
  if (t.includes('not logged in') || t.includes('login') && t.includes('required')) return 'not_logged_in';
  if (t.includes('extension') && (t.includes('not connected') || t.includes('disconnected'))) return 'profile_disconnected';
  if (t.includes('daemon')) return 'profile_disconnected';
  if (t.includes('timed out') || t.includes('timeout')) return 'timeout';
  if (t.includes('attach') || t.includes('upload')) return 'upload_failed';
  return 'unknown';
}

/** Run `opencli <args>` in the configured profile; waits out a busy engine tab (stale lock) up to ~2 min. */
export async function opencli(args, timeoutMs = TIMEOUT_MS) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await opencliOnce(args, timeoutMs);
    } catch (e) {
      if (e.code !== 'busy' || attempt >= 5) throw e;
      await new Promise((r) => setTimeout(r, 25_000));
    }
  }
}

async function opencliOnce(args, timeoutMs) {
  // Remember the window you're in; the job raises Chrome, and focus comes back once the prompt is sent.
  const giveBack = await rememberFocus();
  const what = args.slice(0, 2).join(' ');
  const t0 = Date.now();
  console.log(`[opencli] ${what}: started`);
  // On failure, keep the adapter's step log (e.g. "[tryon +12.4s] attached 2") for the report.
  const fail = (e, err) => {
    e.detail = String(err || '').split('\n').filter((l) => l.trim() && !/Update available|npm install -g/.test(l)).slice(-25).join('\n');
    console.error(`[opencli] ${what}: failed after ${((Date.now() - t0) / 1000).toFixed(1)}s (${e.code}) ${e.message}${e.detail ? `\n${e.detail}` : ''}`);
    return e;
  };
  return new Promise((resolve, reject) => {
    let child;
    // Gemini ignores pasted files and stalls in OpenCLI's hidden background window,
    // so jobs run in a visible Chrome window (OPENCLI_WINDOW=background to override).
    try { child = spawnOpencli([...args, '-f', 'json'], { OPENCLI_WINDOW: process.env.OPENCLI_WINDOW || 'foreground' }); }
    catch (e) { reject(new EngineError('profile_disconnected', e.message)); return; }
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => {
      err += d;
      // Every adapter logs one of these right after the prompt is posted.
      if (/\] (sent \(|generating|waiting for the answer)/.test(err)) giveBack();
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      const stage = (err.match(/\[tryon [^\]]+\] [^\n]+/g) || []).pop();
      reject(fail(new EngineError('timeout', `Timed out after ${timeoutMs / 1000}s${stage ? ` (last step: ${stage.replace(/^\[tryon [^\]]+\] /, '')})` : ''}`), err));
    }, timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); reject(fail(new EngineError('unknown', e.message), err)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      giveBack();
      const parsed = parseEnvelope(out);
      if (parsed?.ok && Array.isArray(parsed.data)) {
        console.log(`[opencli] ${what}: done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
        return resolve(parsed.data);
      }
      const e = parsed?.error;
      const msg = (e ? [e.code, e.message, e.hint].filter(Boolean).join(': ') : (err || out || `exit ${code}`)).toString().trim();
      reject(fail(new EngineError(classify(msg), msg.slice(0, 500)), err));
    });
  });
}

function cleanPath(p) {
  let s = String(p || '').replace(/^[^~/]*?(?=[~/])/u, '').trim();
  if (s.startsWith('~')) s = path.join(os.homedir(), s.slice(1));
  return s;
}

const gemini = {
  id: 'gemini',
  label: 'Gemini',
  model: 'Gemini web (Nano Banana)',
  async edit({ prompt, images, outDir, name }) {
    const rows = await opencli(['gemini', 'tryon', prompt, '--image', images.join(','), '--op', outDir, '--name', name]);
    const file = cleanPath(rows[0]?.file);
    if (!file) throw new EngineError('no_image', 'Gemini returned no file');
    return file;
  },
};

// ChatGPT and Qwen attach images from the page (OpenCLI's own `chatgpt image --image` needs a file path Chrome can't read from WSL).
const chatgpt = {
  id: 'chatgpt',
  label: 'ChatGPT',
  model: 'ChatGPT web (GPT Image)',
  async edit({ prompt, images, outDir, name }) {
    const rows = await opencli(['chatgpt', 'tryon', prompt, '--image', images.join(','), '--op', outDir, '--name', name]);
    const file = cleanPath(rows[0]?.file);
    if (!file) throw new EngineError('no_image', 'ChatGPT returned no file');
    return file;
  },
};

const qwen = {
  id: 'qwen',
  label: 'Qwen',
  model: 'Qwen web (Image Edit)',
  async edit({ prompt, images, outDir, name }) {
    const rows = await opencli(['qwen', 'tryon', prompt, '--image', images.join(','), '--op', outDir, '--name', name]);
    const file = cleanPath(rows[0]?.file);
    if (!file) throw new EngineError('no_image', 'Qwen returned no file');
    return file;
  },
};

export const ENGINES = { gemini, chatgpt, qwen };
// Not available for renders:
//  - copilot: adapter written but needs a one-time image-consent click in Copilot first.
//  - meta: uploads fine but Meta AI refuses to edit photos of real people, so it powers the Stylist instead.
export const PLANNED_ENGINES = [
  { id: 'copilot', label: 'Copilot', note: 'Needs a one-time image consent in Copilot' },
  { id: 'meta', label: 'Meta AI', note: 'Used by the Stylist, not for try-ons' },
];

/** Ask Meta AI a text question in a fresh chat (Stylist). Returns { text, links, images, link }. */
export async function askMeta(prompt) {
  const rows = await opencli(['meta', 'ask', prompt, '--timeout', '200'], 300_000);
  if (!rows[0]?.text) throw new EngineError('no_image', 'Meta AI returned no answer');
  return rows[0];
}

// Status checks run in OpenCLI's background window so they never pull Chrome to the front.
async function geminiStatus() {
  const r = await opencliJson(['gemini', 'status', '-f', 'json'], 45_000);
  const row = r.ok && Array.isArray(r.data) ? r.data[0] || {} : null;
  return { row, error: r.ok ? null : r.error };
}

export async function health() {
  const { row, error } = await geminiStatus();
  if (row) return { ok: row.Status === 'Connected' && row.Login === 'Yes', profile: PROFILE, gemini: row };
  const msg = [error?.code, error?.message].filter(Boolean).join(': ');
  return { ok: false, profile: PROFILE, error: classify(msg), message: msg.slice(0, 400) };
}

/** First-run checklist: is OpenCLI's Chrome extension connected, and is Gemini signed in? */
export async function setupStatus() {
  const problem = profileProblem();
  if (problem) return { ready: false, extension: false, gemini: false, problem };
  const doc = await opencliJson(['doctor'], 30_000);
  const d = doc.ok ? doc.data || {} : {};
  const extension = !!d.extensionConnected;
  const profiles = Array.isArray(d.profiles) ? d.profiles.filter((p) => p.extensionConnected).length : 0;
  if (!doc.ok) return { ready: false, extension: false, gemini: false, problem: `OpenCLI didn't start: ${doc.error?.message || 'unknown error'}` };
  if (extension && profiles > 1 && !PROFILE) {
    return { ready: false, extension: true, gemini: false, problem: 'The OpenCLI extension is installed in more than one Chrome profile. Keep it in just the profile you use Gemini in (chrome://extensions in the others → Remove).' };
  }
  const outdated = d.extensionOutdated ? 'The OpenCLI extension needs an update: open chrome://extensions, turn on Developer mode, click Update.' : null;
  if (!extension) return { ready: false, extension: false, gemini: false, problem: outdated };
  const { row } = await geminiStatus();
  const gemini = !!row && row.Login === 'Yes';
  return { ready: gemini, extension: true, gemini, problem: outdated };
}
