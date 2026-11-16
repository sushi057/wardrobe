// Gemini only accepts the send while its Chrome window is in front, so OpenCLI jobs run with
// OPENCLI_WINDOW=foreground. rememberFocus() notes where you are before a job; the function it returns
// puts you back there once the prompt is sent (the image keeps generating behind).
//  - Windows (and WSL): Win32 GetForegroundWindow / SetForegroundWindow through PowerShell.
//  - macOS: the front app via `path to frontmost application` (no permission prompt) plus Chrome's windows API via
//    OpenCLI to re-focus the Chrome window you were in.
// WARDROBE_KEEP_FOCUS=0 turns it off; WARDROBE_FOCUS=chrome forces the macOS method (for testing).
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { opencliJson } from './opencli.js';

const IS_WSL = process.platform === 'linux' && (() => {
  try { return /microsoft/i.test(fs.readFileSync('/proc/version', 'utf8')); } catch { return false; }
})();
const OFF = process.env.WARDROBE_KEEP_FOCUS === '0';
const METHOD = OFF ? 'off'
  : process.env.WARDROBE_FOCUS === 'chrome' || process.platform === 'darwin' ? 'mac'
    : process.platform === 'win32' || IS_WSL ? 'win32' : 'off';

function run(cmd, args, timeout = 8000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout) => resolve(err ? '' : String(stdout).trim()));
  });
}

// ---------- Windows ----------
const WIN32 = `Add-Type @"
using System; using System.Runtime.InteropServices;
public class WF {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);
}
"@`;
const ps = (script) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `${WIN32}\n${script}`]);

async function rememberWin32() {
  const h = await ps('[WF]::GetForegroundWindow().ToInt64()');
  if (!/^\d+$/.test(h) || h === '0') return null;
  // A tap of Alt lets a background process take the foreground back.
  return () => ps(`$h = [IntPtr]${h}
if ([WF]::IsWindow($h) -and [WF]::GetForegroundWindow() -ne $h) {
  if ([WF]::IsIconic($h)) { [void][WF]::ShowWindow($h, 9) }
  [WF]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [WF]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
  [void][WF]::SetForegroundWindow($h)
}`);
}

// ---------- macOS ----------
const CHROME_IDS = new Set(['com.google.Chrome', 'com.google.Chrome.beta', 'com.google.Chrome.dev', 'com.google.Chrome.canary']);

// Front app as { path, id } without any permission prompt: `path to frontmost application` is a
// local scripting addition (no Apple Events to other apps); the bundle id comes from its Info.plist.
async function frontApp() {
  if (process.platform !== 'darwin') return null;
  const appPath = (await run('osascript', ['-e', 'POSIX path of (path to frontmost application)'])).replace(/\/$/, '');
  if (!appPath.endsWith('.app')) return null;
  const id = await run('defaults', ['read', `${appPath}/Contents/Info`, 'CFBundleIdentifier']);
  return { path: appPath, id: id || null };
}

async function focusedChromeWindow() {
  const r = await opencliJson(['browser', 'chrome', 'call', 'windows.getAll', '[{"windowTypes":["normal"]}]'], 10_000);
  return r.ok && Array.isArray(r.data) ? r.data.find((w) => w.focused)?.id ?? null : null;
}

async function rememberMac() {
  const [app, win] = await Promise.all([frontApp(), focusedChromeWindow()]);
  const inChrome = app ? CHROME_IDS.has(app.id) : win != null;
  console.log(`[focus] before job: front app ${app?.id || 'unknown'}, focused Chrome window ${win ?? 'none'}`);
  if (inChrome && win != null) {
    return async () => {
      const now = await focusedChromeWindow();
      console.log(`[focus] after send: focused Chrome window ${now ?? 'none'} -> ${now != null && now !== win ? `refocus ${win}` : 'leave'}`);
      if (now != null && now !== win) await opencliJson(['browser', 'chrome', 'call', 'windows.update', JSON.stringify([win, { focused: true }])], 10_000);
    };
  }
  if (app && !inChrome) {
    return () => { console.log(`[focus] after send: reopen ${app.path}`); return run('open', ['-a', app.path]); };
  }
  return null;
}

/** Note the window you're in now. Returns a function (safe to call more than once) that brings it back. */
export async function rememberFocus() {
  let restore = null;
  try { restore = METHOD === 'win32' ? await rememberWin32() : METHOD === 'mac' ? await rememberMac() : null; }
  catch { restore = null; }
  let done = false;
  return () => {
    if (done || !restore) return;
    done = true;
    Promise.resolve().then(restore).catch(() => {});
  };
}
