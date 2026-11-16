import { AnimatePresence, motion } from 'framer-motion'
import { ArrowUpRight, Check, Heart, ImagePlus, Link2, Plus, RotateCcw, ShoppingBag, Trash2, X } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { api, CATEGORIES, CATEGORY_LABEL, type Category, type Item, type ScanResult } from './api'
import type { Wardrobe } from './store'
import { Button, Chip, ease, ProviderTag } from './ui'

export const isOwned = (i: Item) => i.owned !== false

const SINGULAR: Record<Category, string> = { top: 'Top', bottom: 'Bottom', dress: 'Dress', outerwear: 'Outerwear', shoes: 'Shoes', accessory: 'Accessory' }

export function CategoryChips({ items, value, onChange }: { items: Item[]; value: Category | 'all'; onChange: (c: Category | 'all') => void }) {
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const i of items) m.set(i.category, (m.get(i.category) ?? 0) + 1)
    return m
  }, [items])
  return (
    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 py-0.5 [scrollbar-width:none]">
      <Chip active={value === 'all'} onClick={() => onChange('all')} count={items.length}>All</Chip>
      {CATEGORIES.filter((c) => counts.get(c)).map((c) => (
        <Chip key={c} active={value === c} onClick={() => onChange(c)} count={counts.get(c)}>{CATEGORY_LABEL[c]}</Chip>
      ))}
    </div>
  )
}

/** Doji product cell: white, hairline-separated, product centred, two-line caption. */
/** worn: the piece is already on the version on stage, so it can't be added again. */
export function ItemCell({ item, selected, onClick, actions, worn }: { item: Item; selected?: boolean; onClick?: () => void; actions?: React.ReactNode; worn?: { label: string; thumb: string } }) {
  const busy = item.cutoutStatus === 'queued' || item.cutoutStatus === 'running'
  return (
    <motion.div layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3, ease }} className="group relative bg-card">
      <button
        onClick={onClick}
        disabled={!!worn}
        aria-pressed={selected}
        aria-label={`${item.name || SINGULAR[item.category]}${selected ? ', in outfit' : ''}${worn ? `, already worn in ${worn.label}` : ''}`}
        title={worn ? `Already on you in ${worn.label}` : undefined}
        className="block w-full text-left disabled:cursor-default"
      >
        <div className="relative aspect-square overflow-hidden bg-plate">
          <img
            loading="lazy"
            decoding="async"
            src={item.imageUrl}
            alt=""
            draggable={false}
            className={`absolute inset-0 size-full transition-transform duration-500 ease-[var(--ease-out-expo)] group-hover:scale-[1.04] ${item.cutoutUrl ? 'object-contain p-[14%] mix-blend-multiply' : 'object-cover'} ${busy ? 'tile-pulse' : ''} ${worn ? 'opacity-45 group-hover:scale-100' : ''}`}
          />
          <AnimatePresence>
            {worn && (
              <motion.span initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.25, ease }} className="absolute inset-x-3 bottom-3 flex h-8 items-center gap-2 rounded-full bg-card py-1 pl-1 pr-3 text-meta text-ink shadow-float">
                <img src={worn.thumb} alt="" className="size-6 shrink-0 rounded-full object-cover object-top ring-1 ring-line" />
                <span className="truncate">Wearing in {worn.label}</span>
              </motion.span>
            )}
          </AnimatePresence>
          {busy && (
            <span className="absolute inset-x-3 bottom-3 flex h-7 items-center justify-center gap-1.5 rounded-full bg-card/95 text-meta text-ink shadow-float">
              <span className="size-1.5 rounded-full bg-accent tile-pulse" />
              {item.cutoutStatus === 'running' ? 'Cleaning up' : 'Waiting'}
            </span>
          )}
          {!isOwned(item) && (
            <span title="Wishlist: you don’t own this yet" className="absolute left-3 top-3 grid size-6 place-items-center rounded-full bg-card/95 text-ink shadow-float"><Heart size={12} strokeWidth={2} /></span>
          )}
          {item.cutoutStatus === 'error' && <span className="absolute inset-x-3 bottom-3 flex h-7 items-center justify-center rounded-full bg-card/95 text-meta text-warn shadow-float">Cleanup failed</span>}
        </div>
        <div className="px-3.5 pb-3.5 pt-1">
          <p className="truncate text-caps uppercase text-ink-2">{isOwned(item) ? SINGULAR[item.category] : item.store || 'Wishlist'}</p>
          <p className="mt-0.5 flex items-baseline justify-between gap-2 text-label text-ink">
            <span className="truncate">{item.name || 'Untitled'}</span>
            {!isOwned(item) && item.price && <span className="tabular shrink-0 text-meta text-ink-2">{item.price}</span>}
          </p>
        </div>
      </button>
      {actions}
      {/* selection: inset ink frame + check */}
      <AnimatePresence>
        {selected && (
          <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="pointer-events-none absolute inset-0 shadow-[inset_0_0_0_1.5px_var(--color-ink)]">
            <motion.span initial={{ scale: 0.4 }} animate={{ scale: 1 }} transition={{ duration: 0.3, ease }} className="absolute right-3 top-3 grid size-6 place-items-center rounded-full bg-ink text-paper">
              <Check size={13} strokeWidth={2.5} />
            </motion.span>
          </motion.span>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

/** Inline add flow: drop or pick photos, give each a category, add. */
export function AddItems({ onClose, onAdded, wishlist = false }: { onClose: () => void; onAdded: () => void; wishlist?: boolean }) {
  const [mode, setMode] = useState<'link' | 'photo'>(wishlist ? 'link' : 'photo')
  const [drafts, setDrafts] = useState<{ file: File; url: string; name: string; category: Category | null }[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const addFiles = (files: FileList | null) => {
    if (!files) return
    const next = Array.from(files).filter((f) => f.type.startsWith('image/')).map((file) => ({
      file, url: URL.createObjectURL(file), name: file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').slice(0, 40), category: null as Category | null,
    }))
    setDrafts((d) => [...d, ...next])
  }
  const ready = drafts.length > 0 && drafts.every((d) => d.category)
  const submit = async () => {
    setBusy(true); setErr(null)
    try {
      for (const d of drafts) await api.addItem(d.file, d.category!, d.name, wishlist)
      onAdded(); onClose()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.3, ease }} className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between">
        <h3 className="text-title">{wishlist ? 'Add to wishlist' : 'Add pieces'}</h3>
        <button onClick={onClose} className="-mr-2 grid size-9 place-items-center rounded-full text-ink-2 hover:bg-panel hover:text-ink" aria-label="Close"><X size={18} strokeWidth={1.75} /></button>
      </div>
      <p className="mt-1 max-w-[46ch] text-meta text-ink-2">{wishlist ? 'Try something on with your own clothes before you buy it.' : 'Any photo works: on a hanger, on the bed, or a shop screenshot. Gemini turns it into a clean product shot.'}</p>
      {wishlist && (
        <div className="mt-4 flex gap-1 rounded-full bg-panel p-1" role="tablist">
          {([['link', 'Shop link'], ['photo', 'Screenshot']] as const).map(([m, label]) => (
            <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={`relative h-8 flex-1 rounded-full text-label transition-colors ${mode === m ? 'text-ink' : 'text-ink-3 hover:text-ink'}`}>
              {mode === m && <motion.span layoutId="add-mode" className="absolute inset-0 rounded-full bg-card shadow-float" transition={{ duration: 0.3, ease }} />}
              <span className="relative">{label}</span>
            </button>
          ))}
        </div>
      )}
      {mode === 'link' ? <div className="mt-5 flex min-h-0 flex-1 flex-col"><AddFromLink onClose={onClose} onAdded={onAdded} /></div> : <>
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files) }}
        onClick={() => input.current?.click()}
        className={`mt-5 grid cursor-pointer place-items-center rounded-2xl border border-dashed px-6 py-8 text-center transition-colors duration-200 ${over ? 'border-ink bg-panel' : 'border-line-strong hover:bg-panel'}`}
      >
        <ImagePlus size={22} strokeWidth={1.5} className="mb-2.5 text-ink-2" />
        <p className="text-label">Drop photos here, or <span className="underline decoration-line-strong underline-offset-4">choose files</span></p>
        <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => addFiles(e.target.files)} />
      </div>
      <div className="mt-2 min-h-0 flex-1 divide-y divide-line overflow-y-auto">
        <AnimatePresence initial={false}>
          {drafts.map((d, i) => (
            <motion.div key={d.url} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25, ease }} className="flex gap-4 py-4">
              <img src={d.url} alt="" className="size-20 shrink-0 rounded-xl bg-panel object-cover" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <input value={d.name} placeholder="Name (optional)" onChange={(e) => setDrafts((all) => all.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className="h-9 min-w-0 flex-1 rounded-lg bg-panel px-3 text-label outline-none focus:ring-1 focus:ring-ink/40" />
                  <button onClick={() => setDrafts((all) => all.filter((_, j) => j !== i))} className="grid size-8 place-items-center rounded-full text-ink-3 hover:bg-panel hover:text-ink" aria-label="Remove"><X size={16} strokeWidth={1.75} /></button>
                </div>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {CATEGORIES.map((c) => (
                    <button key={c} onClick={() => setDrafts((all) => all.map((x, j) => (j === i ? { ...x, category: c } : x)))} className={`h-7 rounded-full px-3 text-meta transition-colors ${d.category === c ? 'bg-ink text-paper' : 'bg-panel text-ink hover:bg-panel-2'}`}>
                      {SINGULAR[c]}
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      {err && <p className="mt-3 text-meta text-warn">{err}</p>}
      <Button variant="primary" size="lg" className="mt-4 w-full" disabled={!ready || busy} onClick={submit}>
        {busy ? 'Adding…' : drafts.length === 0 ? (wishlist ? 'Add to wishlist' : 'Add pieces') : ready ? `Add ${drafts.length} piece${drafts.length > 1 ? 's' : ''}` : 'Pick a category for each'}
      </Button>
      </>}
    </motion.div>
  )
}

/** Alta's "Closet  Wishlist" header tabs: active ink, inactive grey. */
export function OwnedTabs({ value, onChange, counts, size }: { value: 'closet' | 'wishlist'; onChange: (v: 'closet' | 'wishlist') => void; counts: [number, number]; size: 'title' | 'display' }) {
  const cls = size === 'display' ? 'text-display' : 'text-title'
  return (
    <div className="flex items-baseline gap-6" role="tablist">
      {(['closet', 'wishlist'] as const).map((v, i) => (
        <button key={v} role="tab" aria-selected={value === v} onClick={() => onChange(v)} className={`${cls} relative flex items-baseline gap-2 pb-1.5 transition-colors duration-200 ${value === v ? 'text-ink' : 'text-ink-3 hover:text-ink-2'}`}>
          {v === 'closet' ? 'Closet' : 'Wishlist'}
          <span className="tabular text-meta text-ink-3">{counts[i]}</span>
          {value === v && <motion.span layoutId={`owned-tab-${size}`} className="absolute inset-x-0 bottom-0 h-[1.5px] bg-ink" transition={{ duration: 0.35, ease }} />}
        </button>
      ))}
    </div>
  )
}

/** Try before you buy: paste a shop link, pick the product image. */
export function AddFromLink({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [url, setUrl] = useState('')
  const [scan, setScan] = useState<ScanResult | null>(null)
  const [pick, setPick] = useState(0)
  const [name, setName] = useState('')
  const [category, setCategory] = useState<Category | null>(null)
  const [busy, setBusy] = useState<'scan' | 'add' | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [broken, setBroken] = useState<Set<number>>(new Set())

  const doScan = async () => {
    if (!url.trim()) return
    setBusy('scan'); setErr(null); setScan(null); setBroken(new Set())
    try { const r = await api.scan(url.trim()); setScan(r); setPick(0); setName(r.title.replace(/\s*[|–-].*$/, '').slice(0, 60)) }
    catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }
  const add = async () => {
    if (!scan || !category) return
    setBusy('add'); setErr(null)
    try {
      await api.addFromUrl({ imageUrl: scan.candidates[pick], pageUrl: url.trim(), category, name, price: scan.price, store: scan.store })
      onAdded(); onClose()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <form onSubmit={(e) => { e.preventDefault(); doScan() }} className="flex gap-2">
        <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-full bg-panel pl-4 pr-1.5 focus-within:ring-1 focus-within:ring-ink/40">
          <Link2 size={16} strokeWidth={1.75} className="shrink-0 text-ink-3" />
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste a product link" inputMode="url" className="h-full min-w-0 flex-1 bg-transparent text-label outline-none" />
        </label>
        <Button variant="primary" type="submit" disabled={!url.trim() || busy !== null}>{busy === 'scan' ? 'Finding…' : 'Find'}</Button>
      </form>
      {busy === 'scan' && <p className="mt-3 text-meta text-ink-3">Reading the page. Shops that block apps open briefly in your Chrome.</p>}
      {err && <p className="mt-3 text-meta text-warn">{err}</p>}
      <AnimatePresence>
        {scan && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease }} className="mt-5 flex min-h-0 flex-1 flex-col">
            <p className="text-meta text-ink-2">Pick the cleanest product photo. Flat or packshot images work best.</p>
            <div className="mt-3 grid min-h-0 grid-cols-3 gap-2 overflow-y-auto">
              {scan.candidates.map((c, i) => !broken.has(i) && (
                <button key={c} onClick={() => setPick(i)} aria-pressed={pick === i} className={`relative aspect-square overflow-hidden rounded-xl bg-plate transition-shadow ${pick === i ? 'shadow-[0_0_0_1.5px_var(--color-ink)]' : 'ring-1 ring-line hover:ring-line-strong'}`}>
                  <img src={c} alt="" referrerPolicy="no-referrer" onError={() => setBroken((b) => new Set(b).add(i))} className="size-full object-contain mix-blend-multiply" />
                  {pick === i && <span className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-ink text-paper"><Check size={11} strokeWidth={2.5} /></span>}
                </button>
              ))}
            </div>
            <div className="mt-4 flex items-center gap-2">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="h-9 min-w-0 flex-1 rounded-lg bg-panel px-3 text-label outline-none focus:ring-1 focus:ring-ink/40" />
              {scan.price && <span className="tabular shrink-0 text-meta text-ink-2">{scan.price}</span>}
            </div>
            <p className="mt-1.5 text-meta text-ink-3">{scan.store}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {CATEGORIES.map((c) => (
                <button key={c} onClick={() => setCategory(c)} className={`h-7 rounded-full px-3 text-meta transition-colors ${category === c ? 'bg-ink text-paper' : 'bg-panel text-ink hover:bg-panel-2'}`}>{SINGULAR[c]}</button>
              ))}
            </div>
            <Button variant="primary" size="lg" className="mt-5 w-full" disabled={!category || busy !== null} onClick={add}>
              <Heart size={16} strokeWidth={1.75} /> {busy === 'add' ? 'Adding…' : category ? 'Add to wishlist' : 'Pick a category'}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function HairlineGrid({ children, cols }: { children: React.ReactNode; cols: string }) {
  // Doji's hairline dividers: every cell draws a full border, overlapped by 1px so shared edges stay hairline.
  return <motion.div layout className={`grid pb-px pr-px [&>*]:-mb-px [&>*]:-mr-px [&>*]:border [&>*]:border-line ${cols}`}>{children}</motion.div>
}

/** Left column on the try-on screen. */
export function ClosetPanel({ w }: { w: Wardrobe }) {
  const [cat, setCat] = useState<Category | 'all'>('all')
  const [adding, setAdding] = useState(false)
  const [tab, setTab] = useState<'closet' | 'wishlist'>('closet')
  const owned = w.items.filter(isOwned)
  const wish = w.items.filter((i) => !isOwned(i))
  const pool = tab === 'closet' ? owned : wish
  const shown = pool.filter((i) => cat === 'all' || i.category === cat)
  return (
    <aside className="flex h-[36%] min-h-0 w-full shrink-0 flex-col lg:h-auto lg:w-[392px] lg:border-r lg:border-line lg:pr-8">
      <AnimatePresence mode="wait" initial={false}>
        {adding ? (
          <AddItems key="add" wishlist={tab === 'wishlist'} onClose={() => setAdding(false)} onAdded={w.refresh} />
        ) : (
          <motion.div key="grid" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center justify-between">
              <OwnedTabs size="title" value={tab} onChange={(v) => { setTab(v); setCat('all') }} counts={[owned.length, wish.length]} />
              <Button size="sm" onClick={() => setAdding(true)} aria-label={tab === 'wishlist' ? 'Add to wishlist' : 'Add pieces'}><Plus size={15} strokeWidth={1.75} /> Add</Button>
            </div>
            {pool.length > 0 && <div className="mt-4"><CategoryChips items={pool} value={cat} onChange={setCat} /></div>}
            {pool.length === 0 ? (
              <button onClick={() => setAdding(true)} className="mt-5 grid flex-1 place-items-center rounded-2xl border border-dashed border-line-strong p-8 text-center hover:bg-panel">
                <span>
                  <span className="block text-title">{tab === 'closet' ? 'Your closet is empty' : 'Nothing on your wishlist'}</span>
                  <span className="mx-auto mt-1.5 block max-w-[30ch] text-meta text-ink-2">{tab === 'closet' ? 'Add a few pieces to start trying on outfits.' : 'Paste a shop link and try it on with clothes you own, before you buy.'}</span>
                </span>
              </button>
            ) : (
              <div className="mt-5 min-h-0 flex-1 overflow-y-auto pb-4">
                <HairlineGrid cols="grid-cols-3 lg:grid-cols-2">
                  <AnimatePresence>
                    {shown.map((item) => <ItemCell key={item.id} item={item} selected={w.selected.includes(item.id)} onClick={() => w.toggle(item)} worn={w.shownRender?.itemIds.includes(item.id) ? { label: `V${w.versions.findIndex((v) => v.id === w.shownRender!.id) + 1}`, thumb: w.shownRender.url } : undefined} />)}
                  </AnimatePresence>
                </HairlineGrid>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </aside>
  )
}

/** Full closet screen: bigger cells with provider tags and manage actions. */
export function ClosetView({ w }: { w: Wardrobe }) {
  const [cat, setCat] = useState<Category | 'all'>('all')
  const [adding, setAdding] = useState(false)
  const [tab, setTab] = useState<'closet' | 'wishlist'>('closet')
  const owned = w.items.filter(isOwned)
  const wish = w.items.filter((i) => !isOwned(i))
  const pool = tab === 'closet' ? owned : wish
  const shown = pool.filter((i) => cat === 'all' || i.category === cat)
  return (
    <div className="flex h-full min-h-0 flex-col gap-8 lg:flex-row">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="sr-only">{tab === 'closet' ? 'Closet' : 'Wishlist'}</h1>
            <OwnedTabs size="display" value={tab} onChange={(v) => { setTab(v); setCat('all'); setAdding(false) }} counts={[owned.length, wish.length]} />
            <p className="mt-3 text-body text-ink-2">{tab === 'closet' ? 'Hover a piece to see its original photo.' : 'Pieces you’re considering. Try them on with what you own, then mark them bought.'}</p>
          </div>
          <Button variant="primary" onClick={() => setAdding(true)}><Plus size={16} strokeWidth={1.75} /> {tab === 'closet' ? 'Add pieces' : 'Add to wishlist'}</Button>
        </div>
        {pool.length > 0 && <div className="mt-6"><CategoryChips items={pool} value={cat} onChange={setCat} /></div>}
        {pool.length === 0 && (
          <div className="mt-10 max-w-[44ch]">
            <p className="text-title">{tab === 'closet' ? 'Your closet is empty' : 'Nothing on your wishlist yet'}</p>
            <p className="mt-2 text-body text-ink-2">{tab === 'closet' ? 'Add photos of your clothes; Gemini turns each into a clean product shot.' : 'Paste a link from any shop. Pick the product photo, and it becomes a piece you can try on with your own clothes.'}</p>
            <Button variant="primary" className="mt-5" onClick={() => setAdding(true)}><Plus size={16} strokeWidth={1.75} /> {tab === 'closet' ? 'Add pieces' : 'Add to wishlist'}</Button>
          </div>
        )}
        <div className="mt-6 min-h-0 flex-1 overflow-y-auto pb-8">
          <HairlineGrid cols="grid-cols-[repeat(auto-fill,minmax(210px,1fr))]">
            <AnimatePresence>
              {shown.map((item) => (
                <ItemCell
                  key={item.id}
                  item={item}
                  selected={w.selected.includes(item.id)}
                  onClick={() => w.toggle(item)}
                  actions={
                    <>
                      {item.cutoutUrl && (
                        <img src={item.originalUrl} alt="" className="pointer-events-none absolute inset-x-0 top-0 aspect-square w-full object-cover opacity-0 transition-opacity delay-300 duration-300 group-hover:opacity-100" />
                      )}
                      <ProviderTag provider={item.cutoutProvider} model={item.cutoutModel} className="absolute left-3 top-3 opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
                      <div className="absolute bottom-[4.25rem] right-3 flex gap-1.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100">
                        {!isOwned(item) && item.sourceUrl && (
                          <a href={item.sourceUrl} target="_blank" rel="noreferrer noopener" title={`View at ${item.store ?? 'store'}`} aria-label="View at store" className="grid size-8 place-items-center rounded-full bg-card text-ink-2 shadow-float hover:text-ink"><ArrowUpRight size={14} strokeWidth={1.75} /></a>
                        )}
                        {!isOwned(item) && (
                          <button title="I bought it: move to closet" aria-label="I bought it" onClick={() => api.markBought(item.id).then(() => { w.refresh(); w.setToast('Moved to your closet') })} className="grid size-8 place-items-center rounded-full bg-card text-ink-2 shadow-float hover:text-ink"><ShoppingBag size={14} strokeWidth={1.75} /></button>
                        )}
                        <button title="Clean up again" aria-label="Clean up again" onClick={() => api.redoCutout(item.id).then(w.refresh)} className="grid size-8 place-items-center rounded-full bg-card text-ink-2 shadow-float hover:text-ink"><RotateCcw size={14} strokeWidth={1.75} /></button>
                        <button title="Delete" aria-label="Delete piece" onClick={() => { if (confirm(`Delete “${item.name || 'this piece'}”? Looks that use it are deleted too.`)) api.deleteItem(item.id).then(w.setState) }} className="grid size-8 place-items-center rounded-full bg-card text-ink-2 shadow-float hover:text-warn"><Trash2 size={14} strokeWidth={1.75} /></button>
                      </div>
                    </>
                  }
                />
              ))}
            </AnimatePresence>
          </HairlineGrid>
        </div>
      </div>
      <AnimatePresence>
        {adding && (
          <motion.aside initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} transition={{ duration: 0.35, ease }} className="flex max-h-[70%] w-full shrink-0 flex-col border-line lg:max-h-none lg:w-[400px] lg:border-l lg:pl-8">
            <AddItems key={tab} wishlist={tab === 'wishlist'} onClose={() => setAdding(false)} onAdded={w.refresh} />
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  )
}
