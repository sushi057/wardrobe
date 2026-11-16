// Dev tool: evaluate JS in the Gemini adapter tab. `opencli --profile research gemini probe "<js expr>"`
import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'gemini', name: 'probe', access: 'read', description: 'Wardrobe dev: eval JS in Gemini tab',
    domain: 'gemini.google.com', strategy: Strategy.COOKIE, browser: true, siteSession: 'persistent', navigateBefore: false, defaultFormat: 'json',
    args: [{ name: 'js', positional: true, required: true, help: 'JS expression' }],
    columns: ['result'],
    func: async (page, kwargs) => {
        const r = await page.evaluate(`(async () => { try { return JSON.stringify(await (${kwargs.js})); } catch (e) { return 'ERR ' + e.message; } })()`);
        return [{ result: typeof r === 'object' && r && 'result' in r ? r.result : r }];
    },
});
