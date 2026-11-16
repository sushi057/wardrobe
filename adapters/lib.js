// Shared helpers for the Wardrobe try-on adapters (qwen, copilot, meta).
// Installed to ~/.opencli/wardrobe-lib.js by `npm run adapters:install`.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { saveBase64ToFile } from '@jackwener/opencli/utils';
import { CommandExecutionError } from '@jackwener/opencli/errors';

const CHUNK = 192 * 1024;
const t0 = Date.now();
export const makeLog = (tag) => (m) => process.stderr.write(`[tryon ${tag} +${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}\n`);
export const unwrap = (v) => (v && typeof v === 'object' && 'result' in v && Object.keys(v).length <= 2 ? v.result : v);
export const mimeFor = (p) => {
    const ext = path.extname(p).toLowerCase();
    return ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
};

/** Chrome reports a covered/minimised window as hidden, and most chat apps then stop working. */
export async function keepAwake(page) {
    await page.evaluate(`(() => {
        if (window.__wardrobeAwake) return true;
        window.__wardrobeAwake = true;
        window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);
        window.cancelAnimationFrame = (id) => clearTimeout(id);
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
        document.hasFocus = () => true;
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event('focus'));
        return true;
    })()`);
}

/** Copy local files into the page as window.__wardrobeFiles (chunked base64; no Windows paths needed). */
export async function stageFiles(page, files) {
    const staged = files.map((f) => ({ name: path.basename(f), mime: mimeFor(f), bytes: fs.readFileSync(f) }));
    await page.evaluate(`(() => { window.__wardrobeFiles = ${JSON.stringify(staged.map((f) => ({ name: f.name, mime: f.mime, chunks: [] })))}; return true; })()`);
    for (let fi = 0; fi < staged.length; fi += 1) {
        const bytes = staged[fi].bytes;
        const count = Math.max(1, Math.ceil(bytes.length / CHUNK));
        for (let ci = 0; ci < count; ci += 1) {
            const chunk = bytes.subarray(ci * CHUNK, (ci + 1) * CHUNK).toString('base64');
            await page.evaluate(`(() => { window.__wardrobeFiles[${fi}].chunks[${ci}] = ${JSON.stringify(chunk)}; return true; })()`);
        }
    }
}

/** JS (as a string) that rebuilds a DataTransfer from the staged files. */
export const DT_JS = `(() => {
    const dt = new DataTransfer();
    for (const f of window.__wardrobeFiles || []) {
        const parts = f.chunks.map((c) => Uint8Array.from(atob(c), (ch) => ch.charCodeAt(0)));
        dt.items.add(new File(parts, f.name, { type: f.mime }));
    }
    return dt;
})()`;

/** Put the staged files into an <input type=file> and fire change/input. */
export async function attachViaInput(page, files, inputSel) {
    await stageFiles(page, files);
    const r = unwrap(await page.evaluate(`(() => {
        const input = document.querySelector(${JSON.stringify(inputSel)});
        if (!input) return { ok: false, reason: 'file input not found' };
        const dt = ${DT_JS};
        input.files = dt.files;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        delete window.__wardrobeFiles;
        return { ok: true, n: input.files.length };
    })()`));
    if (!r?.ok) throw new CommandExecutionError(`upload_failed: ${r?.reason || 'could not attach images'}`);
    return r.n;
}

/** Paste the staged files into an element (composer). */
export async function attachViaPaste(page, files, targetSel) {
    await stageFiles(page, files);
    const r = unwrap(await page.evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(targetSel)});
        if (!el) return { ok: false, reason: 'composer not found' };
        const dt = ${DT_JS};
        delete window.__wardrobeFiles;
        el.focus();
        el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
        return { ok: true, n: dt.files.length };
    })()`));
    if (!r?.ok) throw new CommandExecutionError(`upload_failed: ${r?.reason || 'could not paste images'}`);
    return r.n;
}

/** Drop the staged files on an element (drag-and-drop uploaders). */
export async function attachViaDrop(page, files, targetSel) {
    await stageFiles(page, files);
    const r = unwrap(await page.evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(targetSel)});
        if (!el) return { ok: false, reason: 'drop target not found' };
        const dt = ${DT_JS};
        delete window.__wardrobeFiles;
        for (const type of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
        return { ok: true, n: dt.files.length };
    })()`));
    if (!r?.ok) throw new CommandExecutionError(`upload_failed: ${r?.reason || 'could not drop images'}`);
    return r.n;
}

/** Download an image URL from inside the page (keeps the site's cookies) and save it. */
export async function saveImageFromPage(page, url, outDir, base) {
    const r = unwrap(await page.evaluate(`(async () => {
        try {
            const res = await fetch(${JSON.stringify(url)}, { credentials: 'include' });
            if (!res.ok) return { ok: false, status: res.status };
            const mime = res.headers.get('content-type') || '';
            const bytes = new Uint8Array(await res.arrayBuffer());
            let bin = '';
            for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
            return { ok: true, mime, b64: btoa(bin) };
        } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
    })()`));
    if (!r?.ok) {
        // Cross-origin CDNs often refuse in-page fetch (CORS); the URL itself is usually signed/public.
        try {
            const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0', referer: await page.evaluate('location.origin + "/"').then(unwrap) } });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const buf = Buffer.from(await res.arrayBuffer());
            const mime = res.headers.get('content-type') || '';
            const ext2 = mime.includes('png') ? '.png' : mime.includes('webp') ? '.webp' : '.jpg';
            const file2 = path.join(path.resolve(outDir), `${base}${ext2}`);
            fs.mkdirSync(path.dirname(file2), { recursive: true });
            fs.writeFileSync(file2, buf);
            return file2;
        } catch (e) {
            throw new CommandExecutionError(`Could not download the generated image (${r?.status || r?.error || e.message})`);
        }
    }
    const ext = r.mime.includes('png') ? '.png' : r.mime.includes('webp') ? '.webp' : '.jpg';
    const file = path.join(path.resolve(outDir), `${base}${ext}`);
    await saveBase64ToFile(r.b64, file);
    return file;
}
