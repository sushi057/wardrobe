import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Bookmark, Columns2, Download, Eye, RefreshCw, Sparkles, Upload, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api, ERROR_COPY, type Item } from './api'
import { ClosetPanel } from './Closet'
import type { Wardrobe } from './store'
import { Button, ease, ProviderTag } from './ui'

const SINGULAR: Record<string, string> = { top: 'Top', bottom: 'Bottom', dress: 'Dress', outerwear: 'Outerwear', shoes: 'Shoes', accessory: 'Accessory' }

function useElapsed(since?: number) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { if (!since) return; const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t) }, [since])
  if (!since) return '0:00'
  const s = Math.max(0, Math.floor((now - since) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function PhotoDrop({ onDone, compact, tile }: { onDone: () => void; compact?: boolean; tile?: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const send = async (f?: File | File[]) => {
    const files = Array.isArray(f) ? f : f ? [f] : []
    if (!files.length) return
    setBusy(true); setErr(null)
    try { for (const one of files) await api.uploadPhoto(one); onDone() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  if (tile) return (
    <>
      <button onClick={() => input.current?.click()} disabled={busy} aria-label="Add a photo" className="grid w-full place-items-center rounded-xl border border-dashed border-line-strong text-ink-3 transition-colors hover:border-ink hover:text-ink disabled:opacity-60" style={{ aspectRatio: '3 / 4' }}>
        <span className="flex flex-col items-center gap-1 text-meta"><Upload size={16} strokeWidth={1.75} />{busy ? 'Adding…' : 'Add'}</span>
      </button>
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => { send(Array.from(e.target.files ?? [])); e.target.value = '' }} />
      {err && <p className="col-span-full text-meta text-warn">{err}</p>}
    </>
  )
  if (compact) return (
    <>
      <Button size="sm" onClick={() => input.current?.click()} disabled={busy}><Upload size={15} strokeWidth={1.75} /> {busy ? 'Uploading…' : 'Replace photo'}</Button>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => send(e.target.files?.[0])} />
      {err && <p className="text-meta text-warn">{err}</p>}
    </>
  )
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); send(e.dataTransfer.files[0]) }}
      className={`grid h-full w-full max-w-[520px] place-items-center rounded-[20px] border border-dashed p-10 text-center transition-colors duration-200 ${over ? 'border-ink bg-panel' : 'border-line-strong'}`}
    >
      <div>
        <h2 className="text-display">See it on you before you wear it</h2>
        <p className="mx-auto mt-4 max-w-[38ch] text-body text-ink-2">Start with one full-body photo: standing straight, head to feet in frame, plain background, fitted clothes.</p>
        <Button variant="primary" size="lg" className="mt-8" onClick={() => input.current?.click()} disabled={busy}><Upload size={16} strokeWidth={1.75} /> {busy ? 'Uploading…' : 'Upload your photo'}</Button>
        <p className="mt-4 text-meta text-ink-3">Or drop it here. It stays on this computer and goes only to the engine you choose.</p>
        {err && <p className="mt-3 text-meta text-warn">{err}</p>}
        <input ref={input} type="file" accept="image/*" hidden onChange={(e) => send(e.target.files?.[0])} />
      </div>
    </div>
  )
}

/** Doji rail: white floating circle, serif label underneath. */
function RailButton({ icon, label, onClick, disabled, primary, onHold, active }: { icon: React.ReactNode; label: string; onClick?: () => void; disabled?: boolean; primary?: boolean; onHold?: (down: boolean) => void; active?: boolean }) {
  return (
    <div className="flex w-[58px] flex-col items-center gap-1.5 lg:w-[72px] lg:gap-2">
      <motion.button
        whileTap={disabled ? undefined : { scale: 0.92 }}
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        onPointerDown={onHold && (() => onHold(true))}
        onPointerUp={onHold && (() => onHold(false))}
        onPointerLeave={onHold && (() => onHold(false))}
        onKeyDown={onHold && ((e) => { if (e.key === ' ' || e.key === 'Enter') onHold(true) })}
        onKeyUp={onHold && (() => onHold(false))}
        className={`grid place-items-center rounded-full transition-[background-color,box-shadow,color] duration-200 disabled:cursor-not-allowed ${
          primary
            ? 'size-12 lg:size-14 bg-ink text-paper shadow-lift hover:bg-ink/85 disabled:bg-panel-2 disabled:text-ink-3 disabled:shadow-none'
            : active ? 'size-11 lg:size-12 bg-ink text-paper shadow-float'
            : 'size-11 lg:size-12 bg-card text-ink shadow-float hover:shadow-lift disabled:bg-panel disabled:text-ink-3/70 disabled:shadow-none'
        }`}
      >
        {icon}
      </motion.button>
      <span className={`text-center text-[0.75rem] leading-tight lg:text-meta ${disabled ? 'text-ink-3' : 'text-ink'}`}>{label}</span>
    </div>
  )
}

/** Doji's docked pieces: white pills, thumbnail + two-line caption. */
function Dock({ items, onRemove }: { items: Item[]; onRemove: (i: Item) => void }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-4 pb-4">
      <motion.div layout className="pointer-events-auto flex max-w-full gap-2 overflow-x-auto p-1 [scrollbar-width:none]">
        <AnimatePresence mode="popLayout" initial={false}>
          {items.map((i) => (
            <motion.div key={i.id} layout initial={{ opacity: 0, scale: 0.7, y: 14 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.7 }} transition={{ duration: 0.4, ease }} className="flex h-14 shrink-0 items-center gap-2.5 rounded-full bg-card/95 py-1 pl-1 pr-2 shadow-float">
              <img src={i.imageUrl} alt="" className="size-12 rounded-full bg-plate object-contain p-1.5 ring-1 ring-line" />
              <div className="min-w-0 max-w-[8.5rem] sm:max-w-[13rem]">
                <p className="truncate text-caps uppercase text-ink-2">{SINGULAR[i.category]}{i.owned === false ? ' · Wishlist' : ''}</p>
                <p className="truncate text-label">{i.name || 'Untitled'}</p>
              </div>
              <button onClick={() => onRemove(i)} aria-label={`Remove ${i.name || 'piece'}`} className="grid size-7 place-items-center rounded-full text-ink-3 hover:bg-panel hover:text-ink"><X size={14} strokeWidth={1.75} /></button>
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}

function Stage({ w, compare, setCompare }: { w: Wardrobe; compare: boolean; setCompare: (v: boolean) => void }) {
  const reduce = useReducedMotion()
  const photo = w.state!.photo!
  const r = w.shownRender
  const engine = w.state!.engines.find((e) => e.id === (w.renderJob?.engine ?? w.state!.settings.engine))
  const elapsed = useElapsed(w.renderingThis ? w.renderJob?.startedAt ?? Date.now() : undefined)
  const waitingBehind = w.renderingThis && w.state!.queue.pending && w.state!.queue.current?.key !== w.state!.queue.pending?.key
  const reveal = r && w.revealId === r.id
  const selectedItems = w.selected.map((id) => w.items.find((i) => i.id === id)).filter(Boolean) as Item[]
  const before = w.baseOf(r)
  const vLabel = (v: { id: string } | null) => (v ? `V${w.versions.findIndex((x) => x.id === v.id) + 1}` : 'Original')

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 lg:h-full">
    <div className="relative flex min-h-0 w-full flex-1 items-center justify-center">
      <div
        className={`relative h-full max-w-full touch-manipulation select-none overflow-hidden rounded-[20px] bg-panel ${r ? 'cursor-pointer' : ''}`}
        style={{ aspectRatio: `${photo.width} / ${photo.height}`, WebkitTouchCallout: 'none' }}
        title={r ? `Hold to see ${vLabel(before)}` : undefined}
        onPointerDown={(e) => { if (r && e.button === 0) { (e.currentTarget as Element).setPointerCapture?.(e.pointerId); setCompare(true) } }}
        onPointerUp={() => setCompare(false)}
        onPointerCancel={() => setCompare(false)}
        onContextMenu={(e) => e.preventDefault()}
        onDragStart={(e) => e.preventDefault()}
      >
        <img src={before?.url ?? photo.url} alt={before ? `You, ${vLabel(before)}` : 'You'} className="absolute inset-0 size-full object-cover" />
        <AnimatePresence initial={false}>
          {r && !compare && (
            <motion.img
              key={r.id}
              src={r.url}
              alt="You wearing the selected outfit"
              className="absolute inset-0 size-full object-cover"
              initial={reveal && !reduce ? { clipPath: 'inset(0% 0% 100% 0%)', filter: 'blur(14px) saturate(1.2)' } : { opacity: 0 }}
              animate={{ clipPath: 'inset(0% 0% 0% 0%)', filter: 'blur(0px) saturate(1)', opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.25 } }}
              transition={reveal && !reduce ? { duration: 1.15, ease } : { duration: 0.3 }}
              onAnimationComplete={() => reveal && w.setRevealId(null)}
            />
          )}
        </AnimatePresence>

        {/* rendering state */}
        <AnimatePresence>
          {w.renderingThis && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.5 } }} className="absolute inset-0 overflow-hidden">
              <div className="absolute inset-0 bg-white/20 backdrop-saturate-50" />
              <div className="shimmer-band" />
              <div className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center">
                <div className="flex h-11 items-center gap-2.5 rounded-full bg-card px-5 text-label text-ink shadow-lift">
                  <span className="relative flex size-2"><span className="absolute inset-0 animate-ping rounded-full bg-accent motion-reduce:animate-none" /><span className="relative size-2 rounded-full bg-accent" /></span>
                  {waitingBehind ? 'Queued after the current render' : `${engine?.label ?? 'Engine'} is dressing you`}
                  <span className="tabular text-ink-3">{elapsed}</span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* labels */}
        <div className="absolute left-4 top-4">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={r && !compare ? r.id : 'orig'} className="block" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
              {r && !compare ? (
                <span className="flex items-center gap-1.5"><span className="tabular inline-flex h-6 items-center rounded-full bg-ink px-2.5 text-meta text-paper shadow-float">{vLabel(r)}</span><ProviderTag provider={r.provider} model={r.model} /></span>
              ) : <span className="inline-flex h-6 items-center rounded-full bg-card/95 px-2.5 text-meta text-ink shadow-float">{compare && r ? `Before · ${vLabel(before)}` : 'Original photo'}</span>}
            </motion.span>
          </AnimatePresence>
        </div>
        {/* error */}
        <AnimatePresence>
          {w.error && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="absolute inset-x-4 top-14 rounded-2xl bg-card p-5 shadow-lift">
              <p className="text-body">The render didn’t come through</p>
              <p className="mt-1 text-meta text-ink-2">{ERROR_COPY[w.error.code] ?? ERROR_COPY.unknown}</p>
              <div className="mt-4 flex items-center gap-3">
                <Button variant="primary" size="sm" onClick={() => w.tryOn()}>Retry</Button>
                <details className="text-meta text-ink-3"><summary className="cursor-pointer">Details</summary><p className="mt-1 max-w-[44ch] break-words">{w.error.message}</p></details>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <Dock items={selectedItems} onRemove={(i) => w.toggle(i)} />
      </div>
    </div>
    <VersionStrip w={w} vLabel={vLabel} />
    </div>
  )
}

/** Flow-style timeline: the original photo, then every version. Click one to put it on stage and build on it. */
function VersionStrip({ w, vLabel }: { w: Wardrobe; vLabel: (v: { id: string } | null) => string }) {
  const photo = w.state!.photo!
  const activeId = w.shownRender?.id ?? null
  const row = useRef<HTMLDivElement>(null)
  const tiles: { id: string | null; url: string; label: string; from?: string; added?: string }[] = [
    { id: null, url: photo.url, label: 'Original' },
    ...w.versions.map((v) => ({
      id: v.id, url: v.url, label: vLabel(v), from: vLabel(w.baseOf(v)),
      added: v.addedIds.map((iid) => w.items.find((i) => i.id === iid)?.name || SINGULAR[w.items.find((i) => i.id === iid)?.category ?? ''] || 'piece').join(', '),
    })),
  ]
  // The path from the original to the version on stage.
  const lineage = new Set<string | null>([null])
  for (let v = w.shownRender; v; v = w.baseOf(v)) lineage.add(v.id)

  useEffect(() => {
    row.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }, [activeId, w.versions.length])

  const move = (d: number) => {
    const i = tiles.findIndex((t) => t.id === activeId)
    const next = tiles[Math.min(tiles.length - 1, Math.max(0, i + d))]
    w.setActiveId(next.id)
    requestAnimationFrame(() => row.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus())
  }

  return (
    <div className="flex shrink-0 justify-center">
      <div
        ref={row}
        role="tablist"
        aria-label="Versions"
        onKeyDown={(e) => { if (e.key === 'ArrowLeft') { e.preventDefault(); move(-1) } else if (e.key === 'ArrowRight') { e.preventDefault(); move(1) } }}
        className="flex max-w-full items-end gap-2 overflow-x-auto rounded-2xl bg-panel p-2 [scrollbar-width:none]"
      >
        {tiles.map((t, i) => {
          const on = t.id === activeId
          const title = t.id ? `${t.label}: ${t.added} on ${t.from}` : 'Original photo'
          return (
            <div key={t.id ?? 'orig'} className="flex shrink-0 items-end gap-2">
              <motion.button
                layout
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3, ease }}
                role="tab"
                aria-selected={on}
                tabIndex={on ? 0 : -1}
                aria-label={title}
                title={title}
                onClick={() => w.setActiveId(t.id)}
                className="group relative flex flex-col items-center gap-1 outline-none"
              >
                <span className={`relative block h-16 overflow-hidden rounded-xl bg-panel-2 transition-[box-shadow,opacity] duration-200 group-focus-visible:ring-2 group-focus-visible:ring-accent lg:h-[72px] ${on ? 'opacity-100 ring-2 ring-ink ring-offset-2 ring-offset-panel' : 'opacity-75 hover:opacity-100'}`} style={{ aspectRatio: `${photo.width} / ${photo.height}` }}>
                  <img src={t.url} alt="" loading="lazy" className="size-full object-cover" />
                </span>
                <span className={`tabular flex items-center gap-1 text-[0.6875rem] leading-none ${on ? 'text-ink' : 'text-ink-3'}`}>
                  <span className={`size-1 rounded-full ${lineage.has(t.id) ? 'bg-ink' : 'bg-transparent'}`} />{t.label}
                </span>
              </motion.button>
              {i === 0 && tiles.length > 1 && <span aria-hidden className="mb-5 h-10 w-px bg-line-strong" />}
            </div>
          )
        })}
        {w.renderJobs.map((j) => (
          <div key={j.id} className="flex shrink-0 flex-col items-center gap-1" aria-live="polite">
            <span className="relative grid h-16 place-items-center overflow-hidden rounded-xl bg-panel-2 lg:h-[72px]" style={{ aspectRatio: `${photo.width} / ${photo.height}` }}>
              <span className="shimmer-band" />
              <span className="relative flex size-2"><span className="absolute inset-0 animate-ping rounded-full bg-accent motion-reduce:animate-none" /><span className="relative size-2 rounded-full bg-accent" /></span>
            </span>
            <span className="text-[0.6875rem] leading-none text-ink-3">on {vLabel(j.baseId ? { id: j.baseId } : null)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function TryOnView({ w }: { w: Wardrobe }) {
  const [compare, setCompare] = useState(false)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const s = w.state!
  if (!s.photo) return (
    <div className="flex h-full flex-col gap-6 lg:flex-row lg:gap-10"><ClosetPanel w={w} /><div className="grid min-h-0 flex-1 place-items-center"><PhotoDrop onDone={w.refresh} /></div></div>
  )
  const has = w.selected.length > 0
  const r = w.shownRender
  const save = async () => {
    await api.saveLook(name.trim() || 'Untitled look', r?.itemIds ?? w.selected, r?.id ?? null)
    setSaving(false); setName(''); w.refresh(); w.setToast('Saved to Looks')
  }
  return (
    <div className="flex h-full min-h-0 flex-col gap-5 lg:flex-row lg:gap-12">
      <h1 className="sr-only">Try on</h1>
      <ClosetPanel w={w} />
      <Stage w={w} compare={compare} setCompare={setCompare} />
      <div className="flex shrink-0 flex-row items-start justify-center gap-1 lg:w-[72px] lg:flex-col lg:items-center lg:justify-center lg:gap-5">
        {(() => {
          const u = s.usage?.[s.settings.engine]
          return (
            <div className="relative">
              <RailButton primary icon={<Sparkles size={22} strokeWidth={1.75} />} label={u?.blocked ? 'Limit reached' : 'Try on'} disabled={!has || w.renderingThis || !!u?.blocked} onClick={() => w.tryOn()} />
              {u && (
                <motion.span key={u.left} initial={{ y: -4, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.35, ease }} title={`${u.left} of ${u.usable} images left today`}
                  className={`tabular absolute -right-0.5 top-0 grid h-5 min-w-5 place-items-center rounded-full px-1 text-[0.6875rem] shadow-float lg:right-1 ${u.blocked ? 'bg-warn text-white' : 'bg-card text-ink'}`}>
                  {u.left}
                </motion.span>
              )}
            </div>
          )
        })()}
        <RailButton icon={<RefreshCw size={18} strokeWidth={1.75} />} label="Regenerate" disabled={!r || w.renderingThis} onClick={w.regenerate} />
        <RailButton icon={<Eye size={18} strokeWidth={1.75} />} label="Before" disabled={!r} onHold={setCompare} />
        <div className="relative">
          <RailButton icon={<Bookmark size={18} strokeWidth={1.75} />} label="Save" disabled={!has && !r} onClick={() => setSaving((v) => !v)} />
          <AnimatePresence>
            {saving && (
              <motion.form onSubmit={(e) => { e.preventDefault(); save() }} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }} transition={{ duration: 0.2, ease }} className="absolute bottom-[calc(100%+12px)] right-0 z-10 flex w-72 gap-2 rounded-full bg-card p-1.5 shadow-lift lg:bottom-auto lg:right-[calc(100%+8px)] lg:top-0">
                <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this look" className="h-9 min-w-0 flex-1 rounded-full bg-panel px-4 text-label outline-none" />
                <Button variant="primary" size="sm" type="submit">Save</Button>
              </motion.form>
            )}
          </AnimatePresence>
        </div>
        <RailButton icon={<Columns2 size={18} strokeWidth={1.75} />} label={r && w.compareIds.includes(r.id) ? 'In compare' : 'Compare'} disabled={!r} active={!!r && w.compareIds.includes(r.id)} onClick={() => {
          if (!r) return
          const res = w.toggleCompare(r.id)
          w.setToast(res === 'full' ? 'Compare holds 8 looks. Remove one first.' : res === 'added' ? `Added to Compare (${w.compareIds.length + 1} of 8)` : 'Removed from Compare')
        }} />
        <a href={r?.url} download={r ? `look-${r.id}.jpg` : undefined} aria-disabled={!r} tabIndex={-1} className={r ? '' : 'pointer-events-none'}>
          <RailButton icon={<Download size={18} strokeWidth={1.75} />} label="Download" disabled={!r} />
        </a>
        <RailButton icon={<X size={18} strokeWidth={1.75} />} label="Clear" disabled={!has} onClick={() => w.setSelected([])} />
      </div>
    </div>
  )
}
