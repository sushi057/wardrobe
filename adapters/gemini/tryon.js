// Wardrobe app: Gemini image edit with attached images.
// Installed to ~/.opencli/clis/gemini/tryon.js by `npm run adapters:install`.
// Attaches local images by dispatching a synthetic paste into the Gemini composer
// (no file input or Windows path needed), then waits for and exports the generated image.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { saveBase64ToFile } from '@jackwener/opencli/utils';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

// OpenCLI does not export its Gemini helpers; import them from whichever OpenCLI package is running
// this adapter (found through its public registry entry). File URLs keep Windows paths working.
const UTILS_URL = process.env.OPENCLI_PKG_ROOT
    ? pathToFileURL(path.join(process.env.OPENCLI_PKG_ROOT, 'clis', 'gemini', 'utils.js')).href
    : new URL('../../clis/gemini/utils.js', import.meta.resolve('@jackwener/opencli/registry')).href;
const utils = await import(UTILS_URL);
const { GEMINI_DOMAIN, exportGeminiImages, isGeminiGenerating, sendGeminiMessage, ensureGeminiPage } = utils;

const CHUNK = 192 * 1024;
const t0 = Date.now();
const log = (m) => process.stderr.write(`[tryon +${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}\n`);
const COMPOSER = '.ql-editor[contenteditable="true"], .ql-editor[role="textbox"], rich-textarea [contenteditable="true"]';

function mimeFor(p) {
    const ext = path.extname(p).toLowerCase();
    if (ext === '.png') return 'image/png';
    if (ext === '.webp') return 'image/webp';
    return 'image/jpeg';
}

function unwrap(v) {
    return v && typeof v === 'object' && 'result' in v && Object.keys(v).length <= 2 ? v.result : v;
}

// Composer attachments render as <uploader-file-preview> chips in .attachment-preview-wrapper
// (Gemini web, Nov 2026); the thumbnail <img> arrives once the upload finishes.
async function countAttachments(page) {
    const r = unwrap(await page.evaluate(`(() => {
        const chips = Array.from(document.querySelectorAll('.attachment-preview-wrapper uploader-file-preview'));
        const busy = chips.filter(c => c.querySelector('mat-progress-spinner, [role="progressbar"], .loading, mat-spinner')).length;
        const withImg = chips.filter(c => c.querySelector('img')).length;
        return { chips: chips.length, busy, withImg };
    })()`));
    return { chips: Number(r?.chips) || 0, busy: Number(r?.busy) || 0, withImg: Number(r?.withImg) || 0 };
}

async function pasteImages(page, files) {
    const before = (await countAttachments(page)).chips;
    const staged = files.map(f => ({ name: path.basename(f), mime: mimeFor(f), bytes: fs.readFileSync(f) }));
    await page.evaluate(`(() => { window.__wardrobeFiles = ${JSON.stringify(staged.map(f => ({ name: f.name, mime: f.mime, chunks: [] })))}; return true; })()`);
    for (let fi = 0; fi < staged.length; fi += 1) {
        const bytes = staged[fi].bytes;
        const count = Math.max(1, Math.ceil(bytes.length / CHUNK));
        for (let ci = 0; ci < count; ci += 1) {
            const chunk = bytes.subarray(ci * CHUNK, (ci + 1) * CHUNK).toString('base64');
            await page.evaluate(`(() => { window.__wardrobeFiles[${fi}].chunks[${ci}] = ${JSON.stringify(chunk)}; return true; })()`);
        }
    }
    const res = unwrap(await page.evaluate(`(() => {
        const editor = document.querySelector(${JSON.stringify(COMPOSER)});
        if (!editor) return { ok: false, reason: 'composer not found' };
        const dt = new DataTransfer();
        for (const f of window.__wardrobeFiles) {
            const parts = f.chunks.map(c => Uint8Array.from(atob(c), ch => ch.charCodeAt(0)));
            dt.items.add(new File(parts, f.name, { type: f.mime }));
        }
        delete window.__wardrobeFiles;
        editor.focus();
        const ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
        editor.dispatchEvent(ev);
        return { ok: true };
    })()`));
    if (!res?.ok) throw new CommandExecutionError(`Image attach failed: ${res?.reason || 'unknown'}`);
    // Wait for previews to appear and finish uploading.
    for (let i = 0; i < 40; i += 1) {
        await page.wait(1);
        const st = await countAttachments(page);
        if (st.chips - before >= files.length) {
            // Wait for uploads to settle (spinner gone or thumbnails present), max ~20s more.
            for (let k = 0; k < 20; k += 1) {
                const now = await countAttachments(page);
                if (now.busy === 0 && (now.withImg >= now.chips || k >= 6)) break;
                await page.wait(1);
            }
            await page.wait(1.5);
            log(`attached ${st.chips - before}`);
            return st.chips;
        }
    }
    const dbg = unwrap(await page.evaluate(`(() => {
        const ed = document.querySelector(${JSON.stringify(COMPOSER)});
        let box = ed; for (let i = 0; i < 8 && box && box.parentElement; i++) box = box.parentElement;
        return { url: location.href, editor: !!ed, imgs: Array.from(document.querySelectorAll('img')).map(i => (i.src||'').slice(0,40) + ' ' + (i.closest('[class]')?.className||'').toString().slice(0,60)).slice(-12), html: box ? box.outerHTML.replace(/<svg[\\s\\S]*?<\\/svg>/g,'').slice(0, 2500) : '' };
    })()`));
    throw new CommandExecutionError(`Gemini did not show ${files.length} attached image(s): upload_failed ${JSON.stringify(dbg)}`);
}

// The send can silently not happen (send button disabled while uploads finish, esp. in a hidden
// window). Verify the prompt posted; click send ourselves while it stays in the composer.
async function confirmSent(page) {
    for (let i = 0; i < 45; i += 1) {
        const st = unwrap(await page.evaluate(`(() => {
            const posted = document.querySelectorAll('user-query').length > 0 || /\\/app\\/[0-9a-f]{8,}/.test(location.pathname);
            const btn = document.querySelector('button.send-button, button[aria-label*="Send" i], button[data-test-id*="send"]');
            const disabled = !btn || btn.disabled || btn.getAttribute('aria-disabled') === 'true';
            const r = btn ? btn.getBoundingClientRect() : null;
            return { posted, hasBtn: !!btn, disabled, vis: document.visibilityState, x: r ? r.left + r.width / 2 : 0, y: r ? r.top + r.height / 2 : 0 };
        })()`));
        if (st?.posted) { log(`sent (after ${i}s)`); return; }
        // Gemini ignores synthetic clicks: send a trusted CDP click (needs the page to read as visible).
        if (st?.hasBtn && !st.disabled && i % 3 === 0) {
            try { await page.nativeClick(st.x, st.y); }
            catch {
                try { await page.evaluate(`document.querySelector(${JSON.stringify(COMPOSER)})?.focus()`); await page.nativeKeyPress('Enter'); } catch { }
            }
        }
        if (i % 10 === 0) log(`waiting to send: button ${st?.hasBtn ? (st.disabled ? 'disabled' : 'clicked') : 'missing'}, tab ${st?.vis}`);
        await page.wait(1);
    }
    throw new CommandExecutionError('Gemini did not accept the message (send stayed disabled). Bring the Chrome window to the front and retry.', 'send_failed');
}

async function responseImageUrls(page) {
    const r = unwrap(await page.evaluate(`(() => {
        const out = [];
        for (const img of document.querySelectorAll('model-response img, generated-image img, single-image img')) {
            const src = img.currentSrc || img.src || '';
            if (!src || !img.complete || !img.naturalWidth) continue;
            if ((img.naturalWidth < 128 && img.naturalHeight < 128)) continue;
            const alt = (img.alt || '').toLowerCase();
            if (alt.includes('avatar') || alt.includes('logo') || alt.includes('icon')) continue;
            if (!out.includes(src)) out.push(src);
        }
        return out;
    })()`));
    return Array.isArray(r) ? r : [];
}

async function lastResponseText(page) {
    const r = unwrap(await page.evaluate(`(() => {
        const all = document.querySelectorAll('model-response');
        const last = all[all.length - 1];
        return last ? (last.innerText || '').trim().slice(0, 400) : '';
    })()`));
    return typeof r === 'string' ? r : '';
}

async function waitForImages(page, timeoutSec) {
    const deadline = Date.now() + timeoutSec * 1000;
    let last = '';
    let stable = 0;
    let sawGenerating = false;
    let idleTextPolls = 0;
    while (Date.now() < deadline) {
        await page.wait(3);
        let generating = false;
        try { generating = await isGeminiGenerating(page); } catch { }
        if (generating) { sawGenerating = true; stable = 0; idleTextPolls = 0; continue; }
        const urls = await responseImageUrls(page);
        const key = urls.join('\n');
        if (urls.length && key === last) return urls;
        if (urls.length) { last = key; continue; }
        // Idle, no image: after a few polls with a text answer, treat as refusal.
        const text = await lastResponseText(page);
        if (sawGenerating && text.length > 20) idleTextPolls += 1;
        if (idleTextPolls >= 4) throw new EmptyResultError('gemini tryon', `no_image: ${text}`);
    }
    throw new CommandExecutionError(`Timed out after ${timeoutSec}s waiting for Gemini image`, 'timeout');
}

cli({
    site: 'gemini',
    name: 'tryon',
    access: 'write',
    description: 'Edit/compose images with Gemini web using attached local images (wardrobe app)',
    domain: GEMINI_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    // No persistent site session: OpenCLI releases Chrome ~30 s after each render, so the
    // "OpenCLI is debugging this browser" banner doesn't linger. Costs a few seconds per render.
    navigateBefore: false,
    defaultFormat: 'json',
    args: [
        { name: 'prompt', positional: true, required: true, help: 'Prompt' },
        { name: 'image', required: true, help: 'Comma-separated local image paths, in order' },
        { name: 'op', required: true, help: 'Output directory' },
        { name: 'name', default: '', help: 'Output file base name' },
        { name: 'timeout', type: 'int', default: 240, help: 'Seconds' },
    ],
    columns: ['status', 'file', 'link'],
    func: async (page, kwargs) => {
        const files = String(kwargs.image).split(',').map(s => s.trim()).filter(Boolean);
        if (!files.length) throw new ArgumentError('--image is required');
        for (const f of files) if (!fs.existsSync(f)) throw new ArgumentError(`Image not found: ${f}`);
        const outDir = path.resolve(String(kwargs.op));
        // Full reload: Gemini's SPA state goes stale in the background window and then ignores pasted files.
        log('reload');
        await ensureGeminiPage(page);
        // Unique URL forces a real navigation (same-URL goto is a no-op).
        await page.goto(`https://gemini.google.com/app?wr=${Date.now()}`, { waitUntil: 'load', settleMs: 2500 });
        for (let i = 0; i < 20; i += 1) {
            const ready = unwrap(await page.evaluate(`(() => !!document.querySelector(${JSON.stringify(COMPOSER)}) && document.querySelectorAll('.attachment-preview-wrapper uploader-file-preview').length === 0)()`).catch(() => false));
            if (ready) break;
            await page.wait(1);
        }
        await page.wait(1);
        // Chrome pauses requestAnimationFrame and reports "hidden" when this window is covered or
        // minimised; Gemini then never posts the message. Keep the page "awake" for this job.
        await page.evaluate(`(() => {
            if (window.__wardrobeAwake) return true;
            window.__wardrobeAwake = true;
            const raf = (cb) => setTimeout(() => cb(performance.now()), 16);
            window.requestAnimationFrame = raf;
            window.cancelAnimationFrame = (id) => clearTimeout(id);
            Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
            Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
            document.hasFocus = () => true;
            document.dispatchEvent(new Event('visibilitychange'));
            window.dispatchEvent(new Event('focus'));
            return true;
        })()`);
        log('attach');
        await pasteImages(page, files);
        log('send');
        await sendGeminiMessage(page, String(kwargs.prompt));
        await confirmSent(page);
        log('generating');
        const urls = await waitForImages(page, Number(kwargs.timeout) || 240);
        log('export');
        const link = unwrap(await page.evaluate('window.location.href')) || 'https://gemini.google.com/app';
        const assets = await exportGeminiImages(page, urls.slice(-1));
        if (!assets.length) throw new CommandExecutionError('Failed to export generated image');
        const a = assets[0];
        const ext = a.mimeType.includes('png') ? '.png' : a.mimeType.includes('webp') ? '.webp' : '.jpg';
        const file = path.join(outDir, `${kwargs.name || 'gemini_' + Date.now()}${ext}`);
        await saveBase64ToFile(a.dataUrl.replace(/^data:[^;]+;base64,/, ''), file);
        return [{ status: 'saved', file, link }];
    },
});
