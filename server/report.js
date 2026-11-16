// "Save a report": one plain-text file a friend can send to whoever shared Wardrobe with them.
// Contains versions, setup checks, recent jobs and logs. Never photos, cookies or file contents;
// the home folder and account name are replaced with ~ and <user>.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DATA, PORT, PROFILE, ROOT } from './config.js';
import { opencliJson } from './opencli.js';
import { setupStatus } from './engines.js';
import { recentJobs, recentLines, redact } from './log.js';

function tail(file, maxLines) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    const all = text.split(/\r?\n/);
    return all.slice(-maxLines).join('\n');
  } catch { return null; }
}

function appVersion() {
  try { return fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim(); } catch { return 'dev (running from source)'; }
}

const section = (title, body) => `\n===== ${title} =====\n${body}\n`;

/** Builds the report text. `db` is the app's store, for counts and settings only. */
export async function buildReport(db, extra = {}) {
  const [setup, doctor] = await Promise.all([
    setupStatus().catch((e) => ({ error: e.message })),
    opencliJson(['doctor'], 30_000),
  ]);
  const d = doctor.ok ? doctor.data || {} : null;

  const out = [];
  out.push('Wardrobe problem report');
  out.push(`Created: ${new Date().toString()}`);
  if (extra.note) out.push(`Note from the user: ${extra.note}`);

  out.push(section('System', [
    `App version: ${appVersion()}`,
    `OS: ${os.type()} ${os.release()} (${process.platform} ${process.arch})`,
    `Node: ${process.version}`,
    `Chrome profile mode: ${PROFILE ? `named (${PROFILE})` : 'auto'}`,
    `Port: ${PORT}`,
    `Data folder: ${DATA}`,
    `Server up for: ${Math.round(process.uptime() / 60)} min`,
  ].join('\n')));

  out.push(section('Setup check', JSON.stringify(setup, null, 2)));

  out.push(section('OpenCLI', d ? [
    `CLI ${d.cliVersion || '?'} | daemon ${d.daemonRunning ? `running (${d.daemonVersion})` : 'not running'}`,
    `Extension: ${d.extensionConnected ? 'connected' : 'not connected'} | version ${d.extensionVersion || '?'}${d.extensionOutdated ? ' (outdated)' : ''}`,
    `Chrome profiles with the extension: ${Array.isArray(d.profiles) ? d.profiles.filter((p) => p.extensionConnected).length : '?'}`,
    ...(Array.isArray(d.issues) && d.issues.length ? ['Issues:', ...d.issues.map((i) => `  - ${i}`)] : []),
  ].join('\n') : `doctor failed: ${JSON.stringify(doctor.error)}`));

  const lim = db.limits?.[db.settings?.engine];
  out.push(section('Settings', [
    `Engine: ${db.settings?.engine}`,
    `Limit: ${lim ? `${lim.plan}, ${lim.limit}/day at ${lim.pct}%` : '?'}`,
    `Images made in the last 24 h: ${(db.usage || []).filter((u) => u.at > Date.now() - 864e5).length}`,
    `Photo added: ${db.photo ? 'yes' : 'no'} | items: ${db.items?.length ?? 0} | try-ons: ${db.renders?.length ?? 0}`,
  ].join('\n')));

  const jobs = recentJobs();
  out.push(section(`Recent jobs (${jobs.length})`, jobs.length ? jobs.map((j) => [
    `${j.at}  ${j.type} on ${j.engine}: ${j.ok ? 'ok' : `FAILED (${j.code})`} after ${j.seconds}s${j.ok ? '' : `\n  ${j.message}`}`,
    ...(j.detail ? [j.detail.split('\n').map((l) => `    | ${l}`).join('\n')] : []),
  ].join('\n')).join('\n') : 'none since the server started'));

  out.push(section('Recent log (this session)', recentLines().join('\n') || 'empty'));

  const install = tail(path.join(DATA, 'logs', 'install.log'), 80);
  if (install) out.push(section('Install log (last 80 lines)', install));
  const previous = tail(path.join(DATA, 'logs', 'server.log'), 250);
  if (previous) out.push(section('Server log file (last 250 lines, includes earlier sessions)', previous));

  return redact(out.join('\n'));
}
