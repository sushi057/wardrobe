import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, Columns2, Heart, Maximize, SplitSquareHorizontal, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api, type Item, type Render } from './api'
import { isOwned } from './Closet'
import type { Wardrobe } from './store'
import { ease, ProviderTag } from './ui'

const LETTERS = ['A', 'B', 'C', 'D']
type View = { s: number; x: number; y: number }
const FIT: View = { s: 1, x: 0, y: 0 }

/**
 * Lightroom-style compare: equal columns, linked zoom/pan (every render shares the same base photo,
 * so framing lines up), a rating strip under each column, a 2-up wipe mode, and a filmstrip of all
 * try-ons to choose candidates from.
 */
export function CompareView({ w, onBack, onWear }: { w: Wardrobe; onBack: () => void; onWear: (r: Render) => void }) {
  const s = w.state!
  const all = [...s.renders].filter((r) => r.photoId === s.photo?.id).reverse()
  const byId = new Map(s.items.map((i) => [i.id, i]))
  const picked = w.compareIds.map((id) => s.renders.find((r) => r.id === id)).filter(Boolean) as Render[]
  const [mode, setMode] = useState<'side' | 'wipe'>('side')
  const [view, setView] = useState<View>(FIT)
  const [wipe, setWipe] = useState(50)
  const wipeMode = mode === 'wipe' && picked.length === 2

  // Pieces that are not in every column: these are what differs.
  const counts = new Map<string, number>()
  for (const r of picked) for (const id of r.itemIds) counts.set(id, (counts.get(id) ?? 0) + 1)
  const differs = (id: string) => picked.length > 1 && (counts.get(id) ?? 0) < picked.length

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onBack()
      if (e.key === '0') setView(FIT)
      const n = Number(e.key)
      if (n >= 1 && n <= picked.length) { const r = picked[n - 1]; api.favorite(r.id, !r.favorite).then(w.refresh) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [picked, onBack, w.refresh])

  const toggle = (r: Render) => {
    const res = w.toggleCompare(r.id)
    if (res === 'full') w.setToast('Compare holds 4 looks. Remove one first.')
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} aria-label="Back" className="-ml-2 grid size-9 place-items-center rounded-full text-ink-2 hover:bg-panel hover:text-ink"><ArrowLeft size={18} strokeWidth={1.75} /></button>
          <h1 className="text-title">Compare</h1>
          <span className="tabular text-meta text-ink-3">{picked.length} of 4</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 rounded-full bg-panel p-1" role="tablist" aria-label="Layout">
            {([['side', 'Side by side', Columns2], ['wipe', 'Wipe', SplitSquareHorizontal]] as const).map(([m, label, Icon]) => {
              const disabled = m === 'wipe' && picked.length !== 2
              return (
                <button key={m} role="tab" aria-selected={mode === m} disabled={disabled} title={disabled ? 'Wipe compares exactly 2 looks' : label} onClick={() => setMode(m)} className={`relative flex h-8 items-center gap-1.5 rounded-full px-3.5 text-label transition-colors disabled:cursor-not-allowed disabled:text-ink-3/60 ${mode === m && !disabled ? 'text-ink' : 'text-ink-3 hover:text-ink'}`}>
                  {(mode === m && !(m === 'wipe' && disabled)) && <motion.span layoutId="cmp-mode" className="absolute inset-0 rounded-full bg-card shadow-float" transition={{ duration: 0.3, ease }} />}
                  <Icon size={14} strokeWidth={1.75} className="relative" /><span className="relative">{label}</span>
                </button>
              )
            })}
          </div>
          <button onClick={() => setView(FIT)} disabled={view.s === 1} title="Fit (0)" className="flex h-10 items-center gap-1.5 rounded-full px-3.5 text-label text-ink-2 hover:bg-panel hover:text-ink disabled:text-ink-3/60 disabled:hover:bg-transparent">
            <Maximize size={14} strokeWidth={1.75} /> <span className="tabular">{Math.round(view.s * 100)}%</span>
          </button>
        </div>
      </div>

      {/* columns */}
      <div className="relative mt-5 flex min-h-0 flex-1">
        {picked.length === 0 ? (
          <div className="grid flex-1 place-items-center rounded-[20px] border border-dashed border-line-strong p-8 text-center">
            <div>
              <p className="text-title">Pick looks to compare</p>
              <p className="mx-auto mt-2 max-w-[42ch] text-body text-ink-2">Choose 2 to 4 try-ons from the strip below. Zoom with the scroll wheel; every look zooms together so you can check fit and details.</p>
            </div>
          </div>
        ) : wipeMode ? (
          <WipePair a={picked[0]} b={picked[1]} pos={wipe} setPos={setWipe} view={view} setView={setView} />
        ) : (
          <motion.div layout className="flex min-h-0 flex-1 divide-x divide-line overflow-hidden rounded-[20px] ring-1 ring-line">
            <AnimatePresence initial={false}>
              {picked.map((r, i) => (
                <motion.div key={r.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.35, ease }} className="relative min-w-0 flex-1 bg-panel">
                  <ZoomPane src={r.url} view={view} setView={setView} />
                  <span className="pointer-events-none absolute left-3 top-3 grid size-7 place-items-center rounded-full bg-card text-label shadow-float">{LETTERS[i]}</span>
                  <ProviderTag provider={r.provider} model={r.model} className="pointer-events-none absolute right-3 top-3" />
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </div>

      {/* Lightroom strip under each column */}
      {picked.length > 0 && (
        <div className={`mt-3 grid gap-4 ${wipeMode ? 'grid-cols-2' : ''}`} style={wipeMode ? undefined : { gridTemplateColumns: `repeat(${picked.length}, minmax(0, 1fr))` }}>
          {picked.map((r, i) => {
            const items = r.itemIds.map((id) => byId.get(id)).filter(Boolean) as Item[]
            const wish = items.filter((it) => !isOwned(it)).length
            return (
              <div key={r.id} className="min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-label"><span className="text-ink-3">{LETTERS[i]} · </span>{items.length} {items.length === 1 ? 'piece' : 'pieces'}{wish ? <span className="text-ink-2"> · {wish} from wishlist</span> : null}</p>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <button onClick={() => api.favorite(r.id, !r.favorite).then(w.refresh)} aria-pressed={!!r.favorite} title={`Favourite (${i + 1})`} className={`grid size-8 place-items-center rounded-full hover:bg-panel ${r.favorite ? 'text-accent' : 'text-ink-3 hover:text-ink'}`}>
                      <motion.span key={String(r.favorite)} initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={{ duration: 0.3, ease }}><Heart size={16} strokeWidth={1.75} fill={r.favorite ? 'currentColor' : 'none'} /></motion.span>
                    </button>
                    <button onClick={() => onWear(r)} className="h-8 rounded-full px-3 text-meta text-ink-2 hover:bg-panel hover:text-ink">Open</button>
                    <button onClick={() => toggle(r)} aria-label={`Remove ${LETTERS[i]}`} className="grid size-8 place-items-center rounded-full text-ink-3 hover:bg-panel hover:text-ink"><X size={15} strokeWidth={1.75} /></button>
                  </div>
                </div>
                <div className="mt-1.5 flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
                  {items.map((it) => (
                    <span key={it.id} title={`${it.name || it.category}${differs(it.id) ? ' (differs)' : ''}`} className={`relative size-11 shrink-0 overflow-hidden rounded-lg bg-plate ${differs(it.id) ? 'ring-[1.5px] ring-ink' : 'ring-1 ring-line'}`}>
                      <img loading="lazy" decoding="async" src={it.imageUrl} alt="" className="size-full object-contain p-1 mix-blend-multiply" />
                      {!isOwned(it) && <Heart size={9} strokeWidth={2.5} className="absolute right-0.5 top-0.5 text-ink" />}
                    </span>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* filmstrip: every try-on of this photo */}
      <div className="mt-4 border-t border-line pt-3">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {all.length === 0 && <p className="py-4 text-meta text-ink-2">No try-ons yet. Render a few outfits on Try on first.</p>}
          {all.map((r) => {
            const idx = w.compareIds.indexOf(r.id)
            return (
              <button key={r.id} onClick={() => toggle(r)} aria-pressed={idx >= 0} title={idx >= 0 ? 'Remove from compare' : 'Add to compare'} className={`relative h-24 shrink-0 overflow-hidden rounded-xl bg-panel transition-[box-shadow,opacity] ${idx >= 0 ? 'shadow-[0_0_0_2px_var(--color-ink)]' : 'opacity-70 ring-1 ring-line hover:opacity-100'}`} style={{ aspectRatio: '3 / 4' }}>
                <img loading="lazy" decoding="async" src={r.url} alt="" className="size-full object-cover" />
                {idx >= 0 && <span className="absolute left-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-ink text-[0.6875rem] text-paper">{LETTERS[idx]}</span>}
                {r.favorite && <Heart size={12} fill="currentColor" className="absolute bottom-1.5 right-1.5 text-accent" />}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** Image pane with linked zoom (wheel at cursor), drag-to-pan and double-click to fit. */
function ZoomPane({ src, view, setView }: { src: string; view: View; setView: (v: View | ((v: View) => View)) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number } | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const px = e.clientX - rect.left - rect.width / 2
      const py = e.clientY - rect.top - rect.height / 2
      setView((v) => {
        const s = Math.min(5, Math.max(1, v.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))
        if (s === 1) return FIT
        const k = s / v.s
        return { s, x: px - (px - v.x) * k, y: py - (py - v.y) * k }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [setView])
  return (
    <div
      ref={ref}
      onDoubleClick={() => setView(FIT)}
      onPointerDown={(e) => { if (view.s > 1) { drag.current = { x: e.clientX, y: e.clientY }; (e.target as Element).setPointerCapture?.(e.pointerId) } }}
      onPointerMove={(e) => { if (!drag.current) return; const dx = e.clientX - drag.current.x; const dy = e.clientY - drag.current.y; drag.current = { x: e.clientX, y: e.clientY }; setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy })) }}
      onPointerUp={() => { drag.current = null }}
      onPointerCancel={() => { drag.current = null }}
      className={`absolute inset-0 touch-none overflow-hidden ${view.s > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in'}`}
    >
      <img src={src} alt="" draggable={false} className="size-full select-none object-contain" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`, transition: drag.current ? 'none' : 'transform 120ms ease-out' }} />
    </div>
  )
}

/** Two looks stacked; drag the handle to wipe between them (Lightroom "Before and after"). */
function WipePair({ a, b, pos, setPos, view, setView }: { a: Render; b: Render; pos: number; setPos: (n: number) => void; view: View; setView: (v: View | ((v: View) => View)) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const move = (clientX: number) => {
    const r = box.current!.getBoundingClientRect()
    setPos(Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100)))
  }
  return (
    <div ref={box} className="relative min-h-0 flex-1 overflow-hidden rounded-[20px] bg-panel ring-1 ring-line">
      <ZoomPane src={b.url} view={view} setView={setView} />
      <div className="pointer-events-none absolute inset-0" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
        <img src={a.url} alt="" draggable={false} className="size-full select-none object-contain" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }} />
      </div>
      <span className="pointer-events-none absolute left-3 top-3 grid size-7 place-items-center rounded-full bg-card text-label shadow-float">A</span>
      <span className="pointer-events-none absolute right-3 top-3 grid size-7 place-items-center rounded-full bg-card text-label shadow-float">B</span>
      <div
        role="slider"
        aria-label="Wipe between A and B"
        aria-valuenow={Math.round(pos)}
        aria-valuemin={0}
        aria-valuemax={100}
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'ArrowLeft') setPos(Math.max(0, pos - 5)); if (e.key === 'ArrowRight') setPos(Math.min(100, pos + 5)) }}
        onPointerDown={(e) => { dragging.current = true; (e.target as Element).setPointerCapture(e.pointerId); move(e.clientX) }}
        onPointerMove={(e) => dragging.current && move(e.clientX)}
        onPointerUp={() => { dragging.current = false }}
        onPointerCancel={() => { dragging.current = false }}
        className="absolute inset-y-0 z-10 -ml-5 w-10 cursor-ew-resize touch-none"
        style={{ left: `${pos}%` }}
      >
        <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white shadow-[0_0_0_0.5px_rgb(0_0_0/0.2)]" />
        <span className="absolute left-1/2 top-1/2 grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-card text-ink shadow-lift">
          <SplitSquareHorizontal size={15} strokeWidth={1.75} />
        </span>
      </div>
    </div>
  )
}
