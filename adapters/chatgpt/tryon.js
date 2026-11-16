// Wardrobe app: ChatGPT image edit with attached images.
// OpenCLI's own `chatgpt image --image` uploads through a file path Chrome can't read from WSL, so this
// command attaches images from the page (DataTransfer) and reuses OpenCLI's send / wait / export helpers.
// Installed to ~/.opencli/clis/chatgpt/tryon.js by `npm run adapters:install`.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { saveBase64ToFile } from '@jackwener/opencli/utils';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

// OpenCLI does not export its ChatGPT helpers; import them from whichever OpenCLI package runs this
// adapter (found through its public registry entry). File URLs keep Windows paths working.
const u = await import(process.env.OPENCLI_PKG_ROOT
    ? pathToFileURL(path.join(process.env.OPENCLI_PKG_ROOT, 'clis', 'chatgpt', 'utils.js')).href
    : new URL('../../clis/chatgpt/utils.js', import.meta.resolve('@jackwener/opencli/registry')).href);
const lib = await import(pathToFileURL(path.join(os.homedir(), '.opencli', 'wardrobe-lib.js')).href);
const { makeLog, unwrap, keepAwake, attachViaPaste } = lib;
const log = makeLog('chatgpt');
const ev = async (page, js) => unwrap(await page.evaluate(js));
const COMPOSER = '#prompt-textarea, .ProseMirror[contenteditable="true"], div[contenteditable="true"]';

async function waitFor(page, js, sec, step = 1) {
    for (let i = 0; i < sec / step; i += 1) {
        if (await ev(page, js).catch(() => false)) return true;
        await page.wait(step);
    }
    return false;
}

cli({
    site: 'chatgpt',
    name: 'tryon',
    access: 'write',
    description: 'Edit/compose images with ChatGPT web using attached local images (wardrobe app)',
    domain: u.CHATGPT_DOMAIN,
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
        await u.ensureOnChatGPT(page);
        await page.goto(`https://${u.CHATGPT_DOMAIN}/new?wr=${Date.now()}`, { waitUntil: 'load', settleMs: 2500 });
        await keepAwake(page);
        if (!(await waitFor(page, `!!document.querySelector(${JSON.stringify(COMPOSER)})`, 30))) {
            throw new CommandExecutionError('not logged in or ChatGPT did not load', 'not_logged_in');
        }
        await u.clearChatGPTDraft(page);

        log('attach');
        await attachViaPaste(page, files, COMPOSER);
        // previews: blob/estuary thumbnails inside the composer form
        const shown = await waitFor(page, `(() => {
            const form = document.querySelector('form') || document.body;
            return Array.from(form.querySelectorAll('img')).filter((i) => /blob:|estuary|files\\//.test(i.src)).length >= ${files.length};
        })()`, 40);
        if (!shown) throw new CommandExecutionError(`ChatGPT did not show ${files.length} attached image(s): upload_failed`);
        await page.wait(3);

        const beforeUrls = await u.getChatGPTVisibleImageUrls(page);
        log('send');
        const sent = await u.sendChatGPTMessage(page, `Edit the attached image${files.length === 1 ? '' : 's'}: ${kwargs.prompt}`);
        if (!sent) throw new CommandExecutionError('Failed to send the prompt to ChatGPT', 'send_failed');
        log('generating');
        let convUrl = '';
        for (let i = 0; i < 10; i += 1) {
            const url = String(await ev(page, 'location.href'));
            if (url.includes('/c/')) { convUrl = url; break; }
            await page.wait(2);
        }
        const urls = await u.waitForChatGPTImages(page, beforeUrls, timeout, convUrl);
        const link = String(await ev(page, 'location.href'));
        if (!urls.length) throw new EmptyResultError('chatgpt tryon', `no_image: no image appeared. ${link}`);
        log('export');
        const assets = await u.getChatGPTImageAssets(page, urls.slice(-1));
        if (!assets.length) throw new CommandExecutionError('Failed to export the generated image');
        const a = assets[0];
        const ext = a.mimeType.includes('png') ? '.png' : a.mimeType.includes('webp') ? '.webp' : '.jpg';
        const file = path.join(outDir, `${kwargs.name || 'chatgpt_' + Date.now()}${ext}`);
        await saveBase64ToFile(a.dataUrl.replace(/^data:[^;]+;base64,/, ''), file);
        return [{ status: 'saved', file, link }];
    },
});
