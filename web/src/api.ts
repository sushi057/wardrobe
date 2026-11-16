export type Category = 'top' | 'bottom' | 'dress' | 'outerwear' | 'shoes' | 'accessory'

export interface Item {
  id: string
  name: string
  category: Category
  imageUrl: string
  originalUrl: string
  cutoutUrl: string | null
  cutoutStatus: 'queued' | 'running' | 'done' | 'error' | 'skipped'
  cutoutError?: string
  cutoutMessage?: string
  cutoutProvider?: string
  cutoutModel?: string
  owned: boolean
  sourceUrl?: string | null
  store?: string | null
  price?: string | null
  createdAt: number
}
export interface Render {
  id: string
  key: string
  photoId: string
  /** Everything worn in this version. */
  itemIds: string[]
  /** What this step put on. */
  addedIds: string[]
  /** The version this one edited; null = the original photo. */
  baseId: string | null
  engine: string
  provider: string
  model: string
  url: string
  favorite?: boolean
  createdAt: number
}
export interface Look { id: string; name: string; itemIds: string[]; renderId: string | null; createdAt: number }
export interface Job { id: string; type: 'render' | 'cutout'; key?: string; baseId?: string | null; itemId?: string; engine: string; stage: string; startedAt?: number; error?: { code: string; message: string } }
export interface Engine { id: string; label: string; model?: string; available: boolean }
export interface State {
  photo: { id: string; url: string; width: number; height: number } | null
  items: Item[]
  renders: Render[]
  looks: Look[]
  settings: { engine: string; font?: string }
  engines: Engine[]
  queue: { current: Job | null; pending: Job | null; cutouts: number }
  usage: Record<string, Usage>
}
export interface ScanResult { candidates: string[]; title: string; price: string; store: string; brand?: string; via: 'server' | 'browser' }
export interface Usage {
  engine: string; plan: string; limit: number; pct: number; usable: number; used: number; left: number; blocked: boolean
  resetsAt: number | null; renders: number; cutouts: number; events: { at: number; kind: 'render' | 'cutout' }[]; note: string; source: string
}
export interface Health { ok: boolean; profile: string | null; error?: string; message?: string }
export interface Setup { ready: boolean; extension: boolean; gemini: boolean; problem: string | null }

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body as T
}
const post = (url: string, body?: unknown) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) })

export const api = {
  state: () => fetch('/api/state').then(json<State>),
  health: () => fetch('/api/health').then(json<Health>),
  setup: () => fetch('/api/setup').then(json<Setup>),
  uploadPhoto: (file: File) => {
    const fd = new FormData(); fd.append('file', file)
    return fetch('/api/photo', { method: 'POST', body: fd }).then(json<State>)
  },
  addItem: (file: File, category: Category, name: string, wishlist = false) => {
    const fd = new FormData(); fd.append('file', file); fd.append('category', category); fd.append('name', name)
    if (wishlist) fd.append('owned', 'false')
    return fetch('/api/items', { method: 'POST', body: fd }).then(json<Item>)
  },
  scan: (url: string) => post('/api/import/scan', { url }).then(json<ScanResult>),
  addFromUrl: (body: { imageUrl: string; pageUrl: string; category: Category; name: string; price?: string; store?: string }) => post('/api/items/from-url', body).then(json<Item>),
  markBought: (id: string) => fetch(`/api/items/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ owned: true }) }).then(json<Item>),
  favorite: (id: string, favorite: boolean) => fetch(`/api/renders/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ favorite }) }).then(json<Render>),
  deleteItem: (id: string) => fetch(`/api/items/${id}`, { method: 'DELETE' }).then(json<State>),
  redoCutout: (id: string) => post(`/api/items/${id}/cutout`).then(json<Item>),
  render: (itemIds: string[], force = false, baseId: string | null = null) =>
    post('/api/renders', { itemIds, force, baseId }).then(json<{ cached?: boolean; render?: Render; queued?: boolean; key?: string }>),
  deleteRender: (id: string) => fetch(`/api/renders/${id}`, { method: 'DELETE' }).then(json<State>),
  saveLook: (name: string, itemIds: string[], renderId: string | null) => post('/api/looks', { name, itemIds, renderId }).then(json<Look>),
  deleteLook: (id: string) => fetch(`/api/looks/${id}`, { method: 'DELETE' }).then(json<State>),
  setLimit: (engine: string, body: { limit?: number; pct?: number; reset?: boolean }) => fetch(`/api/limits/${engine}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(json<Usage>),
  setFont: (font: string) => fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ font }) }).then(json),
  setEngine: (engine: string) => fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ engine }) }).then(json),
}

export const CATEGORY_LABEL: Record<Category, string> = {
  top: 'Tops', bottom: 'Bottoms', dress: 'Dresses', outerwear: 'Outerwear', shoes: 'Shoes', accessory: 'Accessories',
}
export const CATEGORIES = Object.keys(CATEGORY_LABEL) as Category[]

export const ERROR_COPY: Record<string, string> = {
  no_image: 'The model answered with text instead of an image. Try again, or switch engine.',
  not_logged_in: 'You are signed out of the engine in the research Chrome profile. Sign in there, then retry.',
  profile_disconnected: 'Chrome (research profile) is not connected to OpenCLI. Open Chrome with that profile and retry.',
  timeout: 'The engine took longer than 4 minutes. Retry when the browser is idle.',
  upload_failed: 'Your photos did not attach in the browser. Retry; if it repeats, reload the engine tab.',
  limit: 'You’ve reached the usable share of today’s free allowance. Wait for it to free up, or raise the limit in You → Usage.',
  busy: 'The engine tab is still finishing an earlier job. Retry in a minute.',
  unknown: 'Something went wrong in the browser engine. Retry.',
}
