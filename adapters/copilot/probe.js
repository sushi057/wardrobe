// Dev tool: evaluate JS in the copilot tab. `opencli --profile research copilot probe "<js expr>" [--image a.jpg,b.jpg] [--goto url]`
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cli, Strategy } from '@jackwener/opencli/registry';
const lib = await import(pathToFileURL(path.join(os.homedir(), '.opencli', 'wardrobe-lib.js')).href);
cli({
    site: 'copilot', name: 'probe', access: 'read', description: 'Wardrobe dev: eval JS in the copilot tab',
    domain: 'copilot.microsoft.com', strategy: Strategy.COOKIE, browser: true, siteSession: 'persistent', navigateBefore: false, defaultFormat: 'json',
    args: [
        { name: 'js', positional: true, required: true, help: 'JS expression' },
        { name: 'image', default: '', help: 'stage these local images as window.__wardrobeFiles first' },
        { name: 'goto', default: '', help: 'navigate first' },
    ],
    columns: ['result'],
    func: async (page, kwargs) => {
        if (kwargs.goto) await page.goto(String(kwargs.goto), { waitUntil: 'load', settleMs: 2500 });
        await lib.keepAwake(page);
        if (kwargs.image) await lib.stageFiles(page, String(kwargs.image).split(',').map((s) => s.trim()));
        const r = await page.evaluate(`(async () => { try { return JSON.stringify(await (${kwargs.js})); } catch (e) { return 'ERR ' + e.message; } })()`);
        return [{ result: typeof r === 'object' && r && 'result' in r ? r.result : r }];
    },
});
