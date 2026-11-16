// Logging for support: every console line gets a timestamp and is kept in memory, so a "report"
// (see report.js) can include what happened recently. Installed copies also write it all to
// <data>/logs/server.log (the launcher points stdout/stderr there).
import os from 'node:os';

const MAX_LINES = 600;
const lines = [];
const jobs = [];

const home = os.homedir();
let user = '';
try { user = os.userInfo().username; } catch { /* some sandboxes */ }

/** Hide the person's home folder and account name in anything that goes into a report. */
export function redact(text) {
  let s = String(text);
  if (home) s = s.split(home).join('~').split(home.replace(/\\/g, '/')).join('~');
  // The account name only where it appears as a folder (…/Users/<name>/, /home/<name>/, -home-<name>-), so a
  // common name like "user" doesn't mangle ordinary words.
  if (user) {
    const u = user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    s = s.replace(new RegExp(`([\\\\/-](?:Users|home)[\\\\/-])${u}(?=[\\\\/-]|$)`, 'gi'), '$1<user>');
  }
  return s;
}

function remember(level, args) {
  const text = args.map((a) => (a instanceof Error ? a.stack || a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  const line = `${new Date().toISOString()} ${level.padEnd(5)} ${text}`;
  lines.push(line);
  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
  return line;
}

let installed = false;
/** Timestamp every console line and keep the recent ones. Call once at startup. */
export function setupLogging() {
  if (installed) return;
  installed = true;
  for (const [method, level] of [['log', 'info'], ['info', 'info'], ['warn', 'warn'], ['error', 'error']]) {
    const original = console[method].bind(console);
    console[method] = (...args) => original(remember(level, args));
  }
  // Log, then exit as Node would: a half-broken server is worse; the launcher starts a fresh one.
  process.on('uncaughtException', (e) => { console.error('crashed (uncaught exception):', e); process.exit(1); });
  process.on('unhandledRejection', (e) => { console.error('crashed (unhandled rejection):', e); process.exit(1); });
}

/** Record how a background job (render, cleanup) ended, for the report. */
export function recordJob(entry) {
  jobs.push({ at: new Date().toISOString(), ...entry });
  if (jobs.length > 40) jobs.splice(0, jobs.length - 40);
}

export const recentLines = () => lines.slice();
export const recentJobs = () => jobs.slice();
