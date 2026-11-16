// Wardrobe app: ask Meta AI a text question (the Stylist chat) and return its answer, links and images.
// Installed to ~/.opencli/clis/meta/ask.js by `npm run adapters:install`.
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

const lib = await import(pathToFileURL(path.join(os.homedir(), '.opencli', 'wardrobe-lib.js')).href);
const { makeLog, unwrap, keepAwake } = lib;
const log = makeLog('meta-ask');
const ev = async (page, js) => unwrap(await page.evaluate(js));
const EDITOR = '[contenteditable="true"]';

async function waitFor(page, js, sec, step = 1) {
    for (let i = 0; i < sec / step; i += 1) {
        if (await ev(page, js).catch(() => false)) return true;
        await page.wait(step);
    }
    return false;
}

cli({
    site: 'meta',
    name: 'ask',
    access: 'write',
    description: 'Ask Meta AI a question in a new chat; returns the answer text, links and images (wardrobe stylist)',
    domain: 'www.meta.ai',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    defaultFormat: 'json',
    args: [
        { name: 'prompt', positional: true, required: true, help: 'Question' },
        { name: 'timeout', type: 'int', default: 180, help: 'Seconds' },
    ],
    columns: ['text', 'links', 'images', 'link'],
    func: async (page, kwargs) => {
        const timeout = Number(kwargs.timeout) || 180;
        log('open');
        await page.goto(`https://www.meta.ai/?wr=${Date.now()}`, { waitUntil: 'load', settleMs: 3000 });
        await keepAwake(page);
        if (!(await waitFor(page, `Array.from(document.querySelectorAll(${JSON.stringify(EDITOR)})).some((e) => e.getBoundingClientRect().width > 0)`, 70))) {
            throw new CommandExecutionError('not logged in or Meta AI did not load', 'not_logged_in');
        }
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
        if (clicked !== 'clicked') { try { await page.nativeKeyPress('Enter'); } catch { /* ignore */ } }

        log('waiting for the answer');
        const deadline = Date.now() + timeout * 1000;
        let last = '';
        let stable = 0;
        let errs = 0;
        let out = null;
        while (Date.now() < deadline) {
            await page.wait(3);
            let got;
            try {
                got = await ev(page, `(() => {
                    const msg = Array.from(document.querySelectorAll('[data-testid="assistant-message"]')).pop();
                    if (!msg) return { text: '', busy: true };
                    const here = location.hostname;
                    const links = Array.from(msg.querySelectorAll('a[href]')).map((a) => ({ href: a.href, text: (a.innerText || a.getAttribute('aria-label') || '').trim().slice(0, 120) }))
                        .filter((l) => /^https?:/.test(l.href) && !l.href.includes(here));
                    const images = Array.from(msg.querySelectorAll('img')).filter((i) => i.complete && i.naturalWidth >= 120 && !/logo|orbit|avatar/i.test(i.src + i.alt))
                        .map((i) => ({ src: i.currentSrc || i.src, alt: (i.alt || '').slice(0, 120) }));
                    return { text: msg.innerText.trim(), links, images, busy: !!document.querySelector('button[aria-label*="Stop" i]') };
                })()`);
                errs = 0;
            } catch (e) {
                errs += 1;
                log(`poll error (${errs}): ${String(e.message || e).slice(0, 100)}`);
                if (errs > 8) throw e;
                continue;
            }
            const key = `${got.text.length}|${got.links?.length}|${got.images?.length}`;
            if (got.text.length > 40 && !got.busy && key === last) { stable += 1; if (stable >= 2) { out = got; break; } } else stable = 0;
            last = key;
        }
        if (!out) throw new EmptyResultError('meta ask', 'Meta AI did not answer in time');
        const link = String(await ev(page, 'location.href'));
        return [{ text: out.text, links: JSON.stringify(out.links || []), images: JSON.stringify(out.images || []), link }];
    },
});
