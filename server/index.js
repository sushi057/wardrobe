import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { customAlphabet } from 'nanoid';
import { ENGINES, PLANNED_ENGINES, EngineError, health, setupStatus } from './engines.js';
import { DATA, PORT, ROOT } from './config.js';
import { recordJob, setupLogging } from './log.js';
import { buildReport } from './report.js';
setupLogging();
import { installAdapter } from './adapter.js';
import { PROMPT_VERSION, cutoutPrompt, tryOnPrompt } from './prompts.js';
import { downloadImage, scanProductPage } from './importer.js';

const FILES = path.join(DATA, 'files');
const DB_PATH = path.join(DATA, 'db.json');
fs.mkdirSync(FILES, { recursive: true });
const id = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 10);
const CATEGORIES = ['top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory'];

// ---------- store ----------
let db = { photo: null, items: [], renders: [], looks: [], settings: { engine: 'gemini' }, usage: [], limits: {} };
if (fs.existsSync(DB_PATH)) db = { ...db, ...JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) };

// ---------- usage limits ----------
// Free-tier image allowances (researched 2026-11-15). Neither vendor publishes a hard number today:
//  - Gemini app: compute-based, 5-hour refresh + weekly cap. Last published Nano Banana caps (until May 2026):
//    free 20/day, AI Plus 50/day, AI Pro 100/day. support.google.com/gemini/answer/16275805, felloai.com/is-nano-banana-free
//  - ChatGPT Free: "limited image creation"; users report ~2-3 images per rolling 24h. help.openai.com/en/articles/9275245
// The app only lets you use `pct`% of each allowance so you never hit the vendor wall mid-render.
const DEFAULT_LIMITS = {
  // New installs assume the free plan (safest); each person can raise it on You → Usage. Saved limits are kept.
  gemini: { plan: 'Gemini free', limit: 20, pct: 70, note: 'Last published Nano Banana cap for free accounts (AI Plus: 50, AI Pro: 100). Gemini now refreshes every 5 h up to a weekly cap.', source: 'https://support.google.com/gemini/answer/16275805' },
  chatgpt: { plan: 'ChatGPT Free', limit: 3, pct: 70, note: 'OpenAI says “limited”; free users report about 3 images per rolling 24 h.', source: 'https://help.openai.com/en/articles/9275245-chatgpt-free-tier-faq' },
};
const WINDOW_MS = 24 * 60 * 60 * 1000;
db.usage ||= [];
db.limits = Object.fromEntries(Object.entries(DEFAULT_LIMITS).map(([k, v]) => [k, { ...v, ...(db.limits?.[k] || {}) }]));
if (!db.usageBackfilled) {
  // First run of the meter: count what this app already generated in the last 24 h.
  const since = Date.now() - WINDOW_MS;
  for (const r of db.renders) if (r.createdAt > since) db.usage.push({ engine: r.engine || 'gemini', kind: 'render', at: r.createdAt });
  for (const i of db.items) if (i.cutout && i.createdAt > since) db.usage.push({ engine: i.cutoutProvider || 'gemini', kind: 'cutout', at: i.createdAt });
  db.usageBackfilled = true;
}
const usable = (l) => Math.max(1, Math.floor((l.limit * l.pct) / 100));
function usageFor(engine) {
  const l = db.limits[engine];
  if (!l) return null;
  const since = Date.now() - WINDOW_MS;
  const events = db.usage.filter((u) => u.engine === engine && u.at > since);
  const cap = usable(l);
  return {
    engine, plan: l.plan, limit: l.limit, pct: l.pct, usable: cap, used: events.length,
    left: Math.max(0, cap - events.length), blocked: events.length >= cap,
    resetsAt: events.length ? Math.min(...events.map((e) => e.at)) + WINDOW_MS : null,
    renders: events.filter((e) => e.kind === 'render').length, cutouts: events.filter((e) => e.kind === 'cutout').length,
    events: events.map((e) => ({ at: e.at, kind: e.kind })), note: l.note, source: l.source,
  };
}
function recordUsage(engine, kind) {
  db.usage.push({ engine, kind, at: Date.now() });
  db.usage = db.usage.filter((u) => u.at > Date.now() - 8 * WINDOW_MS);
  save();
  emit({ type: 'usage', usage: usageFor(engine) });
}
class LimitError extends Error {
  constructor(u) {
    const mins = u.resetsAt ? Math.max(1, Math.round((u.resetsAt - Date.now()) / 60000)) : 0;
    super(`You’ve used today’s ${u.usable} ${u.plan} images (${u.pct}% of ${u.limit}). Next one frees up in ${mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`}.`);
    this.code = 'limit';
  }
}
function assertQuota(engine) { const u = usageFor(engine); if (u?.blocked) throw new LimitError(u); }
// Count a job when it reached the model (success, refusal, or a timeout mid-generation).
const CONSUMED = new Set(['no_image', 'timeout']);
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFileSync(DB_PATH + '.tmp', JSON.stringify(db, null, 2));
    fs.renameSync(DB_PATH + '.tmp', DB_PATH);
  }, 50);
}
const fileUrl = (f) => (f ? `/files/${path.basename(f)}` : null);
const abs = (f) => path.join(FILES, path.basename(f));
function rm(f) { if (f) fs.rmSync(abs(f), { force: true }); }

// Items stuck mid-cutout from a previous run go back to the queue.
for (const it of db.items) if (it.cutoutStatus === 'running' || it.cutoutStatus === 'queued') it.cutoutStatus = 'queued';

// ---------- events (SSE) ----------
const clients = new Set();
function emit(event) {
  const msg = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) res.write(msg);
}

// ---------- job queue: concurrency 1, latest render wins ----------
let current = null;
let pendingRender = null; // only the newest render request is kept
const cutoutQueue = [];

function jobView(j) {
  return j && { id: j.id, type: j.type, key: j.key, baseId: j.baseId ?? null, itemId: j.itemId, engine: j.engine, stage: j.stage, startedAt: j.startedAt, error: j.error };
}
function publishQueue() {
  emit({ type: 'queue', current: jobView(current), pending: jobView(pendingRender), cutouts: cutoutQueue.length });
}

// Key: photo | added items | engine | prompt version | base version (b0 = the original photo).
function renderKey(photoId, itemIds, engine, baseId = null) {
  return [photoId, [...itemIds].sort().join('+'), engine, `p${PROMPT_VERSION}`, `b${baseId || 0}`].join('|');
}

// Slot rules (same as the web app): one per slot, a dress replaces top+bottom, accessories stack.
function mergeOutfit(wornIds, addedIds) {
  const cat = (iid) => db.items.find((i) => i.id === iid)?.category;
  let out = [...wornIds];
  for (const a of addedIds) {
    const c = cat(a);
    out = out.filter((o) => {
      if (o === a) return false;
      const oc = cat(o);
      if (!oc) return false;
      if (c === 'accessory') return true;
      if (oc === c) return false;
      if (c === 'dress') return oc !== 'top' && oc !== 'bottom';
      if (c === 'top' || c === 'bottom') return oc !== 'dress';
      return true;
    });
    out.push(a);
  }
  return out;
}

async function runJob(job) {
  const engine = ENGINES[job.engine] || ENGINES.gemini;
  if (job.type === 'cutout') {
    const item = db.items.find((i) => i.id === job.itemId);
    if (!item) return;
    try { assertQuota(engine.id); }
    catch (e) {
      Object.assign(item, { cutoutStatus: 'error', cutoutError: 'limit', cutoutMessage: e.message });
      save(); emit({ type: 'item', item: itemView(item) });
      return;
    }
    item.cutoutStatus = 'running'; save(); emit({ type: 'item', item: itemView(item) });
    try {
      const raw = await engine.edit({ prompt: cutoutPrompt(item.category, item.name), images: [abs(item.original)], outDir: FILES, name: `cut_${item.id}_${Date.now()}` });
      const out = await normalize(raw, `cut_${item.id}`);
      rm(item.cutout);
      Object.assign(item, { cutout: out, cutoutStatus: 'done', cutoutError: null, cutoutMessage: null, cutoutProvider: engine.id, cutoutModel: engine.model });
      recordUsage(engine.id, 'cutout');
    } catch (e) {
      if (CONSUMED.has(e.code)) recordUsage(engine.id, 'cutout');
      Object.assign(item, { cutoutStatus: 'error', cutoutError: e.code || 'unknown', cutoutMessage: e.message });
    }
    save(); emit({ type: 'item', item: itemView(item) });
    return;
  }
  // render
  const photo = db.photo;
  const base = job.baseId ? db.renders.find((r) => r.id === job.baseId) : null;
  if (job.baseId && !base) throw new EngineError('unknown', 'The version you started from was deleted');
  const items = job.itemIds.map((iid) => db.items.find((i) => i.id === iid)).filter(Boolean);
  if (!photo || !items.length) throw new EngineError('unknown', 'Photo or items missing');
  assertQuota(engine.id);
  const garments = items.map((i) => ({ category: i.category, name: i.name }));
  const sheet = items.length > 1 ? await garmentSheet(items.map((i) => abs(i.cutout || i.original))) : null;
  const images = [abs(base ? base.file : photo.file), sheet ?? abs(items[0].cutout || items[0].original)];
  let raw;
  try {
    raw = await engine.edit({ prompt: tryOnPrompt(garments, { sheet: !!sheet }), images, outDir: FILES, name: `render_${Date.now()}` });
    recordUsage(engine.id, 'render');
  } catch (e) {
    if (CONSUMED.has(e.code)) recordUsage(engine.id, 'render');
    throw e;
  } finally { if (sheet) fs.rmSync(sheet, { force: true }); }
  const file = await normalize(raw, 'render');
  // itemIds = everything worn in this version; addedIds = what this step put on; baseId = the version it edited.
  const render = { id: id(), key: job.key, photoId: photo.id, baseId: base?.id ?? null, addedIds: job.itemIds, itemIds: base ? mergeOutfit(base.itemIds, job.itemIds) : job.itemIds, engine: engine.id, provider: engine.label, model: engine.model, promptVersion: PROMPT_VERSION, file, createdAt: Date.now() };
  db.renders.push(render); save();
  emit({ type: 'render', render: renderView(render) });
}

async function pump() {
  if (current) return;
  let job = null;
  if (pendingRender) { job = pendingRender; pendingRender = null; }
  else if (cutoutQueue.length) job = cutoutQueue.shift();
  if (!job) { publishQueue(); return; }
  current = job; job.stage = 'running'; job.startedAt = Date.now();
  publishQueue();
  try {
    await runJob(job);
    job.stage = 'done';
    recordJob({ type: job.type, engine: job.engine || 'gemini', ok: true, seconds: Math.round((Date.now() - job.startedAt) / 1000) });
  } catch (e) {
    job.stage = 'error'; job.error = { code: e.code || 'unknown', message: e.message };
    console.error(`[job ${job.type} ${job.id}] ${job.error.code}: ${String(e.message).slice(0, 400)}`);
    recordJob({ type: job.type, engine: job.engine || 'gemini', ok: false, seconds: Math.round((Date.now() - job.startedAt) / 1000), code: job.error.code, message: String(e.message).slice(0, 400), detail: e.detail || '' });
    emit({ type: 'jobError', job: jobView(job) });
  }
  current = null;
  setTimeout(pump, 1500); // brief cooldown between browser jobs
  publishQueue();
}

function queueCutout(item) {
  item.cutoutStatus = 'queued';
  if (!cutoutQueue.some((j) => j.itemId === item.id)) cutoutQueue.push({ id: id(), type: 'cutout', itemId: item.id, engine: db.settings.engine });
  pump();
}

// All garments on one white sheet with numbered cells (Gemini web won't post 3+ attachments).
async function garmentSheet(paths) {
  const cell = 640, pad = 24, cols = Math.min(paths.length, 3), rows = Math.ceil(paths.length / cols);
  const tiles = await Promise.all(paths.map(async (p, i) => {
    const img = await sharp(p).resize(cell - pad * 2, cell - pad * 2, { fit: 'contain', background: '#ffffff' }).flatten({ background: '#ffffff' }).png().toBuffer();
    const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56"><circle cx="28" cy="28" r="24" fill="#111"/><text x="28" y="37" font-family="Arial, sans-serif" font-size="26" font-weight="700" fill="#fff" text-anchor="middle">${i + 1}</text></svg>`);
    const x = (i % cols) * cell, y = Math.floor(i / cols) * cell;
    return [{ input: img, left: x + pad, top: y + pad }, { input: label, left: x + 12, top: y + 12 }];
  }));
  const file = path.join(FILES, `sheet_${id()}.png`);
  await sharp({ create: { width: cols * cell, height: rows * cell, channels: 3, background: '#ffffff' } }).composite(tiles.flat()).png().toFile(file);
  return file;
}

// Normalise any engine output into a JPEG in FILES.
async function normalize(srcPath, prefix) {
  const name = `${prefix}_${id()}.jpg`;
  await sharp(srcPath).rotate().flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toFile(path.join(FILES, name));
  if (path.resolve(srcPath).startsWith(FILES)) fs.rmSync(srcPath, { force: true });
  return name;
}
const RASTER = new Set(['jpeg', 'png', 'webp', 'avif', 'heif', 'gif', 'tiff']);
async function ingest(buffer, prefix, maxSide = 1536) {
  // Decode by content (magic bytes), refuse SVG/unknown, then re-encode: strips metadata and payloads.
  const info = await sharp(buffer, { limitInputPixels: 80_000_000 }).metadata().catch(() => null);
  if (!info || !RASTER.has(info.format)) throw new Error('unsupported image type');
  const name = `${prefix}_${id()}.jpg`;
  await sharp(buffer, { limitInputPixels: 80_000_000 }).rotate().resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toFile(path.join(FILES, name));
  const meta = await sharp(path.join(FILES, name)).metadata();
  return { name, width: meta.width, height: meta.height };
}

// ---------- views ----------
function itemView(i) {
  const label = ENGINES[i.cutoutProvider]?.label ?? i.cutoutProvider;
  return { ...i, cutoutProvider: label, originalUrl: fileUrl(i.original), cutoutUrl: fileUrl(i.cutout), imageUrl: fileUrl(i.cutout || i.original) };
}
function renderView(r) { return { baseId: null, addedIds: r.itemIds, ...r, url: fileUrl(r.file) }; }
function state() {
  return {
    photo: db.photo && { ...db.photo, url: fileUrl(db.photo.file) },
    items: db.items.map(itemView),
    renders: db.renders.map(renderView),
    looks: db.looks,
    settings: db.settings,
    engines: [
      ...Object.values(ENGINES).map((e) => ({ id: e.id, label: e.label, model: e.model, available: true })),
      ...PLANNED_ENGINES.map((e) => ({ ...e, available: false })),
    ],
    queue: { current: jobView(current), pending: jobView(pendingRender), cutouts: cutoutQueue.length },
    categories: CATEGORIES,
    usage: Object.fromEntries(Object.keys(db.limits).map((k) => [k, usageFor(k)])),
  };
}

// ---------- routes ----------
const app = express();
app.use(express.json({ limit: '100kb' }));
const PORTS = [...new Set([5180, PORT])];
const ALLOWED_ORIGINS = new Set(PORTS.flatMap((p) => [`http://localhost:${p}`, `http://127.0.0.1:${p}`]));
const ALLOWED_HOSTS = new Set(PORTS.flatMap((p) => [`localhost:${p}`, `127.0.0.1:${p}`]));
app.use((req, res, next) => {
  // Only answer requests addressed to this machine by name (blocks DNS-rebinding pages reading photos).
  if (!ALLOWED_HOSTS.has(String(req.get('host') || '').toLowerCase())) return res.status(403).send('Forbidden host');
  // Other websites can't call the API at all, not even GETs (e.g. <img src=".../api/setup"> spawning OpenCLI).
  if (req.path.startsWith('/api/') && req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ error: 'Forbidden' });
  // Browsers send Origin on cross-site requests; refuse anything not from this app (CSRF / drive-by).
  const origin = req.get('origin');
  if (req.method !== 'GET' && origin && !ALLOWED_ORIGINS.has(origin)) return res.status(403).json({ error: 'Forbidden origin' });
  const site = req.get('sec-fetch-site');
  if (req.method !== 'GET' && site && site !== 'same-origin' && site !== 'none') return res.status(403).json({ error: 'Forbidden' });
  next();
});
app.use('/files', express.static(FILES, { maxAge: '1y', immutable: true }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

app.get('/api/ping', (_req, res) => res.json({ app: 'wardrobe' }));
app.get('/api/state', (_req, res) => res.json(state()));

app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write(': hi\n\n');
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => { clearInterval(ping); clients.delete(res); });
});

// One OpenCLI check at a time per endpoint; concurrent callers share the result.
const shared = (fn) => { let p = null; return () => (p ||= fn().finally(() => { p = null; })); };
const healthOnce = shared(health);
const setupOnce = shared(setupStatus);
app.get('/api/health', async (_req, res) => res.json(await healthOnce()));
app.get('/api/setup', async (_req, res) => res.json(await setupOnce()));

// "Save a report": a text file the person can send to whoever shared Wardrobe with them.
app.get('/api/report', async (req, res) => {
  const note = String(req.query.note || '').slice(0, 500);
  const text = await buildReport(db, { note });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  res.set({ 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="wardrobe-report-${stamp}.txt"`, 'Cache-Control': 'no-store' });
  res.send(text);
});

// Lets the installer stop a running copy before it updates files. Browsers can't reach it:
// cross-site POSTs carry an Origin/Sec-Fetch-Site and are refused above; same-site pages have no reason to.
app.post('/api/quit', (req, res) => {
  if (req.get('origin') || req.get('sec-fetch-site')) return res.status(403).json({ error: 'Forbidden' });
  res.json({ ok: true });
  setTimeout(() => process.exit(0), 300); // after the debounced db save (50 ms)
});

app.post('/api/photo', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file required' });
  try {
    const { name, width, height } = await ingest(req.file.buffer, 'photo', 2048);
    if (db.photo) {
      rm(db.photo.file);
      for (const r of db.renders) rm(r.file);
      db.renders = [];
      for (const l of db.looks) l.renderId = null;
    }
    db.photo = { id: id(), file: name, width, height, createdAt: Date.now() };
    save();
    res.json(state());
  } catch (e) { res.status(400).json({ error: 'Could not read image: ' + e.message }); }
});

app.post('/api/items', upload.single('file'), async (req, res) => {
  const category = String(req.body.category || '');
  if (!req.file || !CATEGORIES.includes(category)) return res.status(400).json({ error: 'file and valid category required' });
  try {
    const { name } = await ingest(req.file.buffer, 'item');
    const item = newItem(req.body, category, name);
    if (req.body.cutout !== 'false') queueCutout(item); else item.cutoutStatus = 'skipped';
    res.json(itemView(item));
  } catch (e) { res.status(400).json({ error: 'Could not read image: ' + e.message }); }
});

function newItem(body, category, original) {
  const owned = !(body.owned === false || body.owned === 'false');
  const item = {
    id: id(), name: String(body.name || '').slice(0, 60), category, original, cutout: null, cutoutStatus: 'queued',
    owned, sourceUrl: owned ? null : String(body.sourceUrl || '').slice(0, 1000) || null,
    store: owned ? null : String(body.store || '').slice(0, 60) || null,
    price: owned ? null : String(body.price || '').slice(0, 30) || null,
    priceSeenAt: owned || !body.price ? null : Date.now(),
    createdAt: Date.now(),
  };
  db.items.unshift(item); save();
  return item;
}

// Try before you buy: find product images on a shop page (server fetch, then the user's Chrome).
app.post('/api/import/scan', async (req, res) => {
  try { res.json(await scanProductPage(String(req.body.url || '').trim())); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/items/from-url', async (req, res) => {
  const { imageUrl, pageUrl, category } = req.body;
  if (!CATEGORIES.includes(category)) return res.status(400).json({ error: 'Pick a category' });
  try {
    const buf = await downloadImage(String(imageUrl), String(pageUrl || ''));
    const { name } = await ingest(buf, 'item');
    const item = newItem({ ...req.body, owned: false, sourceUrl: pageUrl }, category, name);
    queueCutout(item);
    res.json(itemView(item));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.patch('/api/items/:id', (req, res) => {
  const item = db.items.find((i) => i.id === req.params.id);
  if (!item) return res.sendStatus(404);
  if (typeof req.body.name === 'string') item.name = req.body.name.slice(0, 60);
  if (CATEGORIES.includes(req.body.category)) item.category = req.body.category;
  if (req.body.owned === true) item.owned = true; // "I bought it": same id, renders and looks survive
  save(); res.json(itemView(item));
});

app.post('/api/items/:id/cutout', (req, res) => {
  const item = db.items.find((i) => i.id === req.params.id);
  if (!item) return res.sendStatus(404);
  queueCutout(item); save(); res.json(itemView(item));
});

app.delete('/api/items/:id', (req, res) => {
  const item = db.items.find((i) => i.id === req.params.id);
  if (!item) return res.sendStatus(404);
  rm(item.original); rm(item.cutout);
  db.items = db.items.filter((i) => i !== item);
  const dead = db.renders.filter((r) => r.itemIds.includes(item.id));
  for (const r of dead) rm(r.file);
  db.renders = db.renders.filter((r) => !dead.includes(r));
  db.looks = db.looks.filter((l) => !l.itemIds.includes(item.id));
  const qi = cutoutQueue.findIndex((j) => j.itemId === item.id);
  if (qi >= 0) cutoutQueue.splice(qi, 1);
  save(); res.json(state());
});

app.post('/api/renders', (req, res) => {
  const itemIds = Array.isArray(req.body.itemIds) ? req.body.itemIds.filter((x) => db.items.some((i) => i.id === x)) : [];
  if (!db.photo) return res.status(400).json({ error: 'Add your photo first' });
  if (!itemIds.length) return res.status(400).json({ error: 'Pick at least one item' });
  const engine = ENGINES[req.body.engine] ? req.body.engine : db.settings.engine;
  const baseId = typeof req.body.baseId === 'string' && req.body.baseId ? req.body.baseId : null;
  if (baseId && !db.renders.some((r) => r.id === baseId && r.photoId === db.photo.id)) return res.status(400).json({ error: 'That version no longer exists' });
  const key = renderKey(db.photo.id, itemIds, engine, baseId);
  if (!req.body.force) {
    const hit = [...db.renders].reverse().find((r) => (r.key.includes('|b') ? r.key : `${r.key}|b0`) === key);
    if (hit) return res.json({ cached: true, render: renderView(hit) });
  }
  if (current?.key === key) return res.json({ queued: true, key, job: jobView(current) });
  const u = usageFor(engine);
  if (u?.blocked) return res.status(429).json({ error: new LimitError(u).message, code: 'limit', usage: u });
  pendingRender = { id: id(), type: 'render', key, itemIds, baseId, engine, stage: 'queued' };
  pump();
  publishQueue();
  res.json({ queued: true, key, job: jobView(pendingRender || current) });
});

app.patch('/api/renders/:id', (req, res) => {
  const r = db.renders.find((x) => x.id === req.params.id);
  if (!r) return res.sendStatus(404);
  if (typeof req.body.favorite === 'boolean') r.favorite = req.body.favorite;
  save(); res.json(renderView(r));
});

app.delete('/api/renders/:id', (req, res) => {
  const r = db.renders.find((x) => x.id === req.params.id);
  if (!r) return res.sendStatus(404);
  rm(r.file);
  db.renders = db.renders.filter((x) => x !== r);
  for (const l of db.looks) if (l.renderId === r.id) l.renderId = null;
  save(); res.json(state());
});

app.post('/api/looks', (req, res) => {
  const { name, itemIds, renderId } = req.body;
  if (!Array.isArray(itemIds) || !itemIds.length) return res.status(400).json({ error: 'itemIds required' });
  const look = { id: id(), name: String(name || 'Untitled look').slice(0, 60), itemIds, renderId: renderId || null, createdAt: Date.now() };
  db.looks.unshift(look); save(); res.json(look);
});

app.delete('/api/looks/:id', (req, res) => {
  db.looks = db.looks.filter((l) => l.id !== req.params.id); save(); res.json(state());
});

app.put('/api/limits/:engine', (req, res) => {
  const l = db.limits[req.params.engine];
  if (!l) return res.sendStatus(404);
  const limit = Number(req.body.limit), pct = Number(req.body.pct);
  if (Number.isFinite(limit) && limit >= 1 && limit <= 10000) l.limit = Math.round(limit);
  if (Number.isFinite(pct) && pct >= 5 && pct <= 100) l.pct = Math.round(pct);
  if (req.body.reset === true) Object.assign(l, DEFAULT_LIMITS[req.params.engine]);
  save();
  const u = usageFor(req.params.engine);
  emit({ type: 'usage', usage: u });
  res.json(u);
});

app.put('/api/settings', (req, res) => {
  if (ENGINES[req.body.engine]) db.settings.engine = req.body.engine;
  if (['source-serif', 'newsreader', 'manrope', 'geist'].includes(req.body.font)) db.settings.font = req.body.font;
  save(); res.json(db.settings);
});

// Installed copies serve the built UI from here (dev uses Vite on :5180 instead).
const DIST = path.join(ROOT, 'web', 'dist');
if (fs.existsSync(path.join(DIST, 'index.html'))) {
  app.use(express.static(DIST, { index: false, maxAge: '1h' }));
  app.get(/^(?!\/(api|files)(\/|$)).*/, (_req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile('index.html', { root: DIST }); // root option: install paths may contain dot-folders
  });
}

const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`wardrobe on http://localhost:${PORT}`);
  installAdapter();
  for (const it of db.items) if (it.cutoutStatus === 'queued') queueCutout(it);
});
server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is already in use (is Wardrobe already running?)` : e.message);
  process.exit(1);
});
