// Wardrobe launcher for installed copies (the desktop / Applications shortcut runs this).
// Starts the server in the background if it isn't running yet, then opens Wardrobe in Google Chrome.
//   node launcher.js          start (or just open) Wardrobe
//   node launcher.js --stop   stop a running copy (used by the installer before updating)
import { execFile, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const APP = import.meta.dirname;                       // <install>/app
const INSTALL = path.dirname(APP);                     // <install>
const PORT = Number(process.env.PORT || 5190);
const URL_ = `http://localhost:${PORT}`;
const DATA = process.env.WARDROBE_DATA || path.join(INSTALL, 'data');
const LOGS = path.join(DATA, 'logs');

async function ping() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/ping`, { signal: AbortSignal.timeout(1500) });
    return r.ok && (await r.json()).app === 'wardrobe';
  } catch { return false; }
}

function tell(message) {
  console.error(message);
  if (process.platform === 'darwin') {
    execFile('osascript', ['-e', `display alert "Wardrobe" message ${JSON.stringify(message)}`]);
  } else if (process.platform === 'win32') {
    const text = message.replace(/'/g, "''");
    execFile('powershell.exe', ['-NoProfile', '-Command', `Add-Type -AssemblyName PresentationFramework; [void][System.Windows.MessageBox]::Show('${text}', 'Wardrobe')`], { windowsHide: true });
  }
}

// Show a file in Finder / Explorer so it's easy to attach to a message.
function reveal(file) {
  const opts = { detached: true, stdio: 'ignore', cwd: os.homedir() };
  try {
    if (process.platform === 'darwin') quietSpawn('open', ['-R', file], opts);
    else if (process.platform === 'win32') quietSpawn('explorer.exe', [`/select,"${file}"`], { ...opts, windowsVerbatimArguments: true });
  } catch { /* best effort */ }
}
const quietSpawn = (cmd, args, opts) => { const c = spawn(cmd, args, opts); c.on('error', () => {}); c.unref(); };

function findChrome() {
  if (process.platform === 'darwin') {
    return ['/Applications/Google Chrome.app', path.join(os.homedir(), 'Applications', 'Google Chrome.app')].find((p) => fs.existsSync(p)) || null;
  }
  if (process.platform === 'win32') {
    const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
    return roots.map((r) => path.join(r, 'Google', 'Chrome', 'Application', 'chrome.exe')).find((p) => fs.existsSync(p)) || null;
  }
  return null;
}

// A missing program must not crash the launcher (spawn reports it as an 'error' event).
const quiet = (child) => { child.on('error', () => {}); child.unref(); };

function openInChrome() {
  const chrome = findChrome();
  // cwd = home: a process started from inside the app folder would lock it on Windows (blocks updates).
  const detached = { detached: true, stdio: 'ignore', windowsHide: true, cwd: os.homedir() };
  if (process.platform === 'darwin') {
    quiet(spawn('open', chrome ? ['-a', chrome, URL_] : [URL_], detached));
  } else if (process.platform === 'win32') {
    if (chrome) quiet(spawn(chrome, [URL_], { ...detached, windowsHide: false }));
    else quiet(spawn('rundll32.exe', ['url.dll,FileProtocolHandler', URL_], detached));
  } else {
    quiet(spawn('xdg-open', [URL_], detached));
  }
  if (!chrome && process.platform !== 'linux') tell('Wardrobe works in Google Chrome, which isn’t installed. Install it from google.com/chrome, then open Wardrobe again.');
}

function startServer() {
  fs.mkdirSync(LOGS, { recursive: true });
  const log = path.join(LOGS, 'server.log');
  try { if (fs.statSync(log).size > 5 * 1024 * 1024) fs.renameSync(log, `${log}.old`); } catch { /* no log yet */ }
  const fd = fs.openSync(log, 'a');
  fs.writeSync(fd, `\n--- ${new Date().toISOString()} starting Wardrobe on port ${PORT}\n`);
  const child = spawn(process.execPath, [path.join(APP, 'server', 'index.js')], {
    cwd: os.homedir(), // never the app folder: Windows can't replace a folder a process is "in"
    detached: true,
    windowsHide: true,
    stdio: ['ignore', fd, fd],
    env: {
      ...process.env,
      PORT: String(PORT),
      WARDROBE_DATA: DATA,
      // Installed copies use the one Chrome profile that has OpenCLI (see server/config.js).
      WARDROBE_PROFILE: process.env.WARDROBE_PROFILE ?? 'auto',
      NODE_ENV: 'production',
    },
  });
  child.unref();
  return log;
}

// Stops the server and OpenCLI's background daemon (it keeps node.exe and the app's OpenCLI files open,
// which blocks updates on Windows). The daemon restarts by itself on the next render.
async function stop() {
  if (await ping()) {
    try { await fetch(`http://127.0.0.1:${PORT}/api/quit`, { method: 'POST' }); } catch { /* exiting */ }
    for (let i = 0; i < 20 && (await ping()); i += 1) await new Promise((r) => setTimeout(r, 250));
  }
  // Bundled copy (installer) or .runtime/ (source setup); a dev checkout has neither and is left alone.
  const opencli = ['node_modules', path.join('.runtime', 'node_modules')]
    .map((d) => path.join(APP, d, '@jackwener', 'opencli', 'dist', 'src', 'main.js')).find((p) => fs.existsSync(p));
  if (opencli) {
    spawnSync(process.execPath, [opencli, 'daemon', 'stop'], { cwd: os.homedir(), stdio: 'ignore', windowsHide: true, timeout: 15_000 });
  }
}

if (process.argv.includes('--stop')) {
  await stop();
} else {
  if (!(await ping())) {
    const log = startServer();
    let up = false;
    for (let i = 0; i < 60 && !up; i += 1) { await new Promise((r) => setTimeout(r, 250)); up = await ping(); }
    if (!up) {
      reveal(log);
      tell(`Wardrobe didn't start. If you need help, send the file "server.log" (opened for you) to whoever shared Wardrobe with you.\n\n${log}`);
      process.exit(1);
    }
  }
  openInChrome();
}
