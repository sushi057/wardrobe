// Wardrobe app: Meta AI (meta.ai) image edit with attached images.
// Installed to ~/.opencli/clis/meta/tryon.js by `npm run adapters:install`.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

const lib = await import(pathToFileURL(path.join(os.homedir(), '.opencli', 'wardrobe-lib.js')).href);
const { makeLog, unwrap, keepAwake, attachViaInput, saveImageFromPage } = lib;
const log = makeLog('meta');
const ev = async (page, js) => unwrap(await page.evaluate(js));

const EDITOR = '[contenteditable="true"]';
const FILE_INPUT = 'input[type=file]';

async function waitFor(page, js, sec, step = 1) {
    for (let i = 0; i < sec / step; i += 1) {
        if (await ev(page, js).catch(() => false)) return true;
        await page.wait(step);
    }
    return false;
}

cli({
    site: 'meta',
    name: 'tryon',
    access: 'write',
    description: 'Edit/compose images with Meta AI using attached local images (wardrobe app)',
    domain: 'www.meta.ai',
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
        await page.goto(`https://www.meta.ai/?wr=${Date.now()}`, { waitUntil: 'load', settleMs: 3000 });
        await keepAwake(page);
        // Meta AI hydrates slowly (10-25 s); the composer is a contenteditable that appears once it has.
        if (!(await waitFor(page, `Array.from(document.querySelectorAll(${JSON.stringify(EDITOR)})).some((e) => e.getBoundingClientRect().width > 0)`, 70))) {
            throw new CommandExecutionError('not logged in or Meta AI did not load', 'not_logged_in');
        }

        log('attach');
        await attachViaInput(page, files, FILE_INPUT);
        if (!(await waitFor(page, `document.querySelectorAll('img[src^="blob:"]').length >= ${files.length}`, 40))) {
            throw new CommandExecutionError(`Meta AI did not show ${files.length} attached image(s): upload_failed`);
        }
        await page.wait(3);
        const before = await ev(page, `Array.from(document.querySelectorAll('img')).map((i) => i.currentSrc || i.src)`);

        log('send');
        await ev(page, `(() => {
            const ed = Array.from(document.querySelectorAll(${JSON.stringify(EDITOR)})).find((e) => e.getBoundingClientRect().width > 0);
            ed.focus();
            document.execCommand('insertText', false, ${JSON.stringify(String(kwargs.prompt))});
            return ed.innerText.length;
        })()`);
        await page.wait(1);
        const clicked = await ev(page, `(() => {
            const btn = Array.from(document.querySelectorAll('button')).find((b) => /^send/i.test(b.getAttribute('aria-label') || '') && !b.disabled);
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
        let last = '';
        let stable = 0;
        let refusal = '';
        let errs = 0;
        while (Date.now() < deadline) {
            await page.wait(3);
            let got;
            try {
                got = await ev(page, `(() => {
                    const seen = new Set(${JSON.stringify(before)});
                    const imgs = Array.from(document.querySelectorAll('img')).filter((i) => {
                        const s = i.currentSrc || i.src;
                        return s && !seen.has(s) && !s.startsWith('blob:') && !s.startsWith('data:') && i.complete && i.naturalWidth >= 256 && !/avatar|logo|icon/i.test(i.alt + i.className);
                    });
                    const last = Array.from(document.querySelectorAll('[data-testid="assistant-message"]')).pop();
                    return { urls: imgs.map((i) => i.currentSrc || i.src), sending: !!document.querySelector('button[aria-label*="Stop" i]'), text: last ? last.innerText.slice(0, 300) : '' };
                })()`);
                errs = 0;
            } catch (e) {
                // Meta swaps the tab's target when a chat starts; give it a moment and keep trying.
                errs += 1;
                log(`poll error (${errs}): ${String(e.message || e).slice(0, 120)}`);
                if (errs > 8) throw e;
                continue;
            }
            if (/wasn.t able to create|can.t (create|edit)|unable to (create|edit)/i.test(got?.text || '') && !got.sending) {
                refusal = got.text;
                break;
            }
            const key = (got?.urls || []).join('\n');
            if (got?.urls?.length && !got.sending && key === last) { stable += 1; if (stable >= 2) { urls = got.urls; break; } } else stable = 0;
            last = key;
        }
        if (refusal) throw new EmptyResultError('meta tryon', `no_image: Meta AI said: ${refusal.replace(/\s+/g, ' ')}`);
        if (!urls.length) throw new EmptyResultError('meta tryon', 'no_image: Meta AI returned no image');
        log('export');
        const link = await ev(page, 'location.href');
        const file = await saveImageFromPage(page, urls[urls.length - 1], outDir, kwargs.name || `meta_${Date.now()}`);
        return [{ status: 'saved', file, link }];
    },
});
