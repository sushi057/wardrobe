// Wardrobe app: Qwen (chat.qwen.ai) image edit with attached images.
// Installed to ~/.opencli/clis/qwen/tryon.js by `npm run adapters:install`.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

const lib = await import(pathToFileURL(path.join(os.homedir(), '.opencli', 'wardrobe-lib.js')).href);
const { makeLog, unwrap, keepAwake, attachViaPaste, saveImageFromPage } = lib;
const log = makeLog('qwen');

const TEXTAREA = 'textarea[placeholder*="Ask Qwen" i], textarea';

const ev = async (page, js) => unwrap(await page.evaluate(js));

async function waitFor(page, js, sec, step = 1) {
    for (let i = 0; i < sec / step; i += 1) {
        if (await ev(page, js).catch(() => false)) return true;
        await page.wait(step);
    }
    return false;
}

cli({
    site: 'qwen',
    name: 'tryon',
    access: 'write',
    description: 'Edit/compose images with Qwen web using attached local images (wardrobe app)',
    domain: 'chat.qwen.ai',
    strategy: Strategy.COOKIE,
    browser: true,
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
        const files = String(kwargs.image).split(',').map((s) => s.trim()).filter(Boolean);
        if (!files.length) throw new ArgumentError('--image is required');
        for (const f of files) if (!fs.existsSync(f)) throw new ArgumentError(`Image not found: ${f}`);
        const outDir = path.resolve(String(kwargs.op));
        const timeout = Number(kwargs.timeout) || 240;

        log('open');
        await page.goto(`https://chat.qwen.ai/?wr=${Date.now()}`, { waitUntil: 'load', settleMs: 2500 });
        if (!(await waitFor(page, `!!document.querySelector(${JSON.stringify(TEXTAREA)})`, 25))) {
            const url = await ev(page, 'location.href');
            throw new CommandExecutionError(`not logged in or Qwen did not load (${url})`, 'not_logged_in');
        }
        await keepAwake(page);

        log('attach');
        await attachViaPaste(page, files, TEXTAREA);
        // uploaded images show up as thumbnails in the composer
        if (!(await waitFor(page, `document.querySelectorAll('img.vision-item-image').length >= ${files.length}`, 60))) {
            throw new CommandExecutionError(`Qwen did not show ${files.length} attached image(s): upload_failed`);
        }
        await page.wait(2);

        log('send');
        await ev(page, `(() => {
            const ta = document.querySelector(${JSON.stringify(TEXTAREA)});
            ta.focus();
            const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
            set.call(ta, ${JSON.stringify(String(kwargs.prompt))});
            ta.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
        })()`);
        await page.wait(1);
        const clicked = await ev(page, `(() => {
            const ta = document.querySelector(${JSON.stringify(TEXTAREA)});
            let box = ta; for (let i = 0; i < 6 && box.parentElement; i += 1) box = box.parentElement;
            const btn = Array.from(box.querySelectorAll('button')).find((b) => /send/i.test(b.getAttribute('aria-label') || '') || b.id === 'send-message-button');
            if (!btn) return 'no-button';
            btn.click();
            return 'clicked';
        })()`);
        log(`send: ${clicked}`);
        if (clicked !== 'clicked') {
            try { await page.nativeKeyPress('Enter'); } catch { /* ignore */ }
        }

        log('generating');
        const deadline = Date.now() + timeout * 1000;
        let urls = [];
        let stable = 0;
        let last = '';
        while (Date.now() < deadline) {
            await page.wait(3);
            const got = await ev(page, `(() => {
                const imgs = Array.from(document.querySelectorAll('img.qwen-image, .qwen-markdown-image-content img'))
                    .filter((i) => !i.closest('[class*="file-message-image"]') && i.complete && i.naturalWidth >= 256);
                const busy = !!document.querySelector('[class*="stop" i][class*="btn" i], [aria-label*="Stop" i]');
                return { urls: imgs.map((i) => i.currentSrc || i.src), busy };
            })()`);
            const key = (got?.urls || []).join('\n');
            if (got?.urls?.length && !got.busy && key === last) { stable += 1; if (stable >= 2) { urls = got.urls; break; } } else stable = 0;
            last = key;
        }
        if (!urls.length) throw new EmptyResultError('qwen tryon', 'no_image: Qwen returned no image');
        log('export');
        const link = await ev(page, 'location.href');
        const file = await saveImageFromPage(page, urls[urls.length - 1], outDir, kwargs.name || `qwen_${Date.now()}`);
        return [{ status: 'saved', file, link }];
    },
});
