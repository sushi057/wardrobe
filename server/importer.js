// "Try before you buy": find product images on a shop page.
// 1) Fetch the page server-side (fast) and read og:image, JSON-LD Product images and large <img>s.
// 2) If the shop blocks servers, open the page in the user's Chrome (research profile) via OpenCLI.
// All network fetches go through safeFetch, which refuses local/private addresses (SSRF).
import dns from 'node:dns/promises';
import net from 'node:net';
import { spawnOpencli } from './opencli.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MAX_HTML = 4 * 1024 * 1024;
export const MAX_IMAGE = 15 * 1024 * 1024;

function isPrivateIp(ip) {
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
    return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

export async function assertPublicUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error('That doesn’t look like a link'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Only http(s) links are supported');
  if (u.username || u.password) throw new Error('Links with credentials are not allowed');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('Local addresses are not allowed');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => { throw new Error('Could not find that website'); });
  if (addrs.some((a) => isPrivateIp(a.address))) throw new Error('Local or private addresses are not allowed');
  return u;
}

/** fetch with SSRF checks on every redirect hop, a timeout and a body size cap. */
export async function safeFetch(raw, { accept = '*/*', maxBytes = MAX_HTML, referer } = {}) {
  let url = raw;
  for (let hop = 0; hop < 5; hop += 1) {
    const u = await assertPublicUrl(url);
    const res = await fetch(u, {
      redirect: 'manual',
      signal: AbortSignal.timeout(12_000),
      headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'en-US,en;q=0.9', ...(referer ? { Referer: referer } : {}) },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location'), u).toString();
      continue;
    }
    const len = Number(res.headers.get('content-length') || 0);
    if (len > maxBytes) throw new Error('File is too large');
    const reader = res.body?.getReader();
    const chunks = [];
    let total = 0;
    while (reader) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) { reader.cancel(); throw new Error('File is too large'); }
      chunks.push(value);
    }
    return { res, url: u.toString(), body: Buffer.concat(chunks) };
  }
  throw new Error('Too many redirects');
}

const decode = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

function largestFromSrcset(srcset) {
  let best = null; let bestW = 0;
  for (const part of String(srcset).split(',')) {
    const [u, d] = part.trim().split(/\s+/);
    const w = d ? parseFloat(d) * (d.endsWith('x') ? 1000 : 1) : 1;
    if (u && w >= bestW) { best = u; bestW = w; }
  }
  return best;
}

function collectJsonLdImages(node, out, meta) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach((n) => collectJsonLdImages(n, out, meta)); return; }
  const type = [].concat(node['@type'] || []).join(' ');
  if (/Product/i.test(type)) {
    for (const img of [].concat(node.image || [])) out.push(typeof img === 'string' ? img : img?.url || img?.contentUrl);
    meta.title ||= node.name;
    const offer = [].concat(node.offers || [])[0];
    if (offer && !meta.price) {
      const p = offer.price ?? offer.lowPrice ?? offer.priceSpecification?.price;
      if (p) meta.price = `${offer.priceCurrency || offer.priceSpecification?.priceCurrency || ''} ${p}`.trim();
    }
    meta.brand ||= typeof node.brand === 'string' ? node.brand : node.brand?.name;
  }
  for (const v of Object.values(node)) if (v && typeof v === 'object') collectJsonLdImages(v, out, meta);
}

export function extractFromHtml(html, pageUrl) {
  const meta = {};
  const imgs = [];
  const metaTag = (prop) => {
    const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*>`, 'i'));
    return m ? decode(m[0].match(/content=["']([^"']*)["']/i)?.[1]) : '';
  };
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { collectJsonLdImages(JSON.parse(m[1].trim()), imgs, meta); } catch { /* bad JSON-LD */ }
  }
  imgs.push(metaTag('og:image'), metaTag('og:image:secure_url'), metaTag('twitter:image'));
  meta.title ||= metaTag('og:title') || decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]);
  meta.price ||= [metaTag('product:price:currency') || metaTag('og:price:currency'), metaTag('product:price:amount') || metaTag('og:price:amount')].filter(Boolean).join(' ');
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const src = largestFromSrcset(tag.match(/\s(?:data-)?srcset=["']([^"']+)["']/i)?.[1] || '') || tag.match(/\s(?:data-src|src)=["']([^"']+)["']/i)?.[1];
    if (!src || /sprite|logo|icon|badge|pixel|placeholder|\.svg|\.gif/i.test(src)) continue;
    const w = Number(tag.match(/\swidth=["']?(\d+)/i)?.[1] || 0);
    if (w && w < 200) continue;
    imgs.push(decode(src));
    if (imgs.length > 60) break;
  }
  return finish(imgs, meta, pageUrl);
}

function finish(imgs, meta, pageUrl) {
  const seen = new Set();
  const candidates = [];
  for (const raw of imgs) {
    if (!raw) continue;
    let u;
    try { u = new URL(decode(raw), pageUrl); } catch { continue; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') continue;
    if (u.protocol === 'http:') u.protocol = 'https:';
    // Ask common CDNs for a big version instead of the thumbnail (Shopify, imgix, SFCC...).
    for (const p of ['width', 'w', 'sw', 'imwidth']) if (u.searchParams.has(p)) u.searchParams.set(p, '1600');
    for (const p of ['height', 'h', 'sh']) u.searchParams.delete(p);
    u.pathname = u.pathname.replace(/_(\d{2,4})x(\d{2,4})?(?=\.(jpe?g|png|webp))/i, '_1600x');
    if (/\.(svg|gif)$/i.test(u.pathname)) continue;
    const key = u.host + u.pathname;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(u.toString());
    if (candidates.length >= 8) break;
  }
  const host = new URL(pageUrl).hostname.replace(/^www\./, '');
  return { candidates, title: (meta.title || '').slice(0, 90), price: meta.price || '', brand: meta.brand || '', store: host };
}

// ---- fallback: the user's Chrome (configured profile; 'research' on the owner's machine) ----
function run(args, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawnOpencli(args); } catch (e) { reject(e); return; }
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const t = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Browser timed out')); }, timeoutMs);
    child.on('close', () => { clearTimeout(t); resolve(out); });
    child.on('error', (e) => { clearTimeout(t); reject(e); });
  });
}

const BROWSER_EXTRACT = `(() => {
  const out = [];
  const add = (u) => { if (u && !out.includes(u)) out.push(u); };
  document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => { try { const walk = (n) => { if (!n || typeof n !== 'object') return; if (Array.isArray(n)) return n.forEach(walk); if (/Product/i.test([].concat(n['@type']||[]).join(' '))) [].concat(n.image||[]).forEach((i) => add(typeof i === 'string' ? i : i && (i.url || i.contentUrl))); Object.values(n).forEach(walk); }; walk(JSON.parse(s.textContent)); } catch (e) {} });
  add(document.querySelector('meta[property="og:image"]')?.content);
  [...document.images].filter((i) => i.naturalWidth >= 300 && i.naturalHeight >= 300).sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight).slice(0, 12).forEach((i) => add(i.currentSrc || i.src));
  const price = document.querySelector('meta[property="product:price:amount"]')?.content || '';
  return JSON.stringify({ imgs: out.slice(0, 16), title: document.querySelector('meta[property="og:title"]')?.content || document.title, price });
})()`;

async function scanInBrowser(url) {
  const session = 'wardrobe-import';
  try {
    await run(['browser', 'open', url, '--session', session]);
    await new Promise((r) => setTimeout(r, 2500)); // let lazy images settle
    const out = await run(['browser', 'eval', BROWSER_EXTRACT, '--session', session]);
    const m = out.match(/\{\\?"imgs[\s\S]*\}/);
    let parsed = null;
    for (const cand of [m?.[0], m?.[0]?.replace(/\\"/g, '"')]) { try { parsed = JSON.parse(cand); break } catch { /* try next */ } }
    if (!parsed) {
      // eval output may be wrapped as {"ok":true,"data":"<json string>"}
      const env = JSON.parse(out.split('\n').find((l) => l.trim().startsWith('{')) || '{}');
      const v = env.data?.result ?? env.data ?? env.result;
      parsed = typeof v === 'string' ? JSON.parse(v) : v;
    }
    return finish(parsed?.imgs || [], { title: parsed?.title, price: parsed?.price }, url);
  } finally {
    run(['browser', 'close', '--session', session], 15_000).catch(() => {});
  }
}

export async function scanProductPage(url) {
  await assertPublicUrl(url);
  let result = null;
  try {
    const { res, body, url: finalUrl } = await safeFetch(url, { accept: 'text/html,application/xhtml+xml' });
    if (res.ok && /html/i.test(res.headers.get('content-type') || '')) result = { ...extractFromHtml(body.toString('utf8'), finalUrl), via: 'server' };
  } catch { /* blocked or failed: fall through to the browser */ }
  if (!result || result.candidates.length < 2) {
    try {
      const b = await scanInBrowser(url);
      if (b.candidates.length) result = { ...b, via: 'browser', title: b.title || result?.title, price: b.price || result?.price };
    } catch (e) {
      if (!result) throw new Error(`Couldn’t read that page (${e.message}). Paste a screenshot instead.`);
    }
  }
  if (!result?.candidates.length) throw new Error('No product images found on that page. Paste a screenshot instead.');
  return result;
}

/** Download a chosen product image (Referer = the shop page, some CDNs require it). */
export async function downloadImage(imageUrl, pageUrl) {
  const { res, body } = await safeFetch(imageUrl, { accept: 'image/avif,image/webp,image/*', maxBytes: MAX_IMAGE, referer: pageUrl });
  const type = res.headers.get('content-type') || '';
  if (!res.ok) throw new Error(`The shop refused the image (${res.status})`);
  if (!/^image\//i.test(type) && !/\.(jpe?g|png|webp|avif)(\?|$)/i.test(imageUrl)) throw new Error('That link is not an image');
  return body;
}
