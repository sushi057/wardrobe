import { AnimatePresence, motion, useDragControls } from 'framer-motion'
import { ArrowLeft, Columns2, GripVertical, Heart, Maximize, SplitSquareHorizontal, X } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { api, type Item, type Render } from './api'
import { isOwned } from './Closet'
import type { Wardrobe } from './store'
import { ease, ProviderTag } from './ui'

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
const MAX = 8
const GAP = 8
const STRIP = 76 // height reserved under each image for the piece strip
/** One column: a try-on, or the original photo (render is null). */
type Entry = { id: string; url: string; render: Render | null }
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
  const picked: Entry[] = w.compareIds.flatMap((id): Entry[] => {
    if (id === 'original') return s.photo ? [{ id, url: s.photo.url, render: null }] : []
    const r = s.renders.find((x) => x.id === id)
    return r ? [{ id, url: r.url, render: r }] : []
  })
  const ratio = s.photo ? s.photo.width / s.photo.height : 3 / 4
  const stage = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = stage.current
    if (!el) return
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // Largest image size that fits all columns, trying 1..n rows; images then sit shoulder to shoulder.
  const cell = (() => {
    let best = { w: 0, h: 0 }
    const n = picked.length
    for (let rows = 1; rows <= Math.max(1, n); rows++) {
      const cols = Math.ceil(n / rows)
      const hMax = (box.h - GAP * (rows - 1)) / rows - STRIP
      const wMax = (box.w - GAP * (cols - 1)) / cols
      const cw = Math.min(wMax, hMax * ratio)
      if (cw > best.w) best = { w: cw, h: cw / ratio }
    }
    return { w: Math.max(0, Math.floor(best.w)), h: Math.max(0, Math.floor(best.h)) }
  })()
  const [mode, setMode] = useState<'side' | 'wipe'>('side')
  const [view, setView] = useState<View>(FIT)
  const [full, setFull] = useState<string | null>(null)
  const [wipe, setWipe] = useState(50)
  const wipeMode = mode === 'wipe' && picked.length === 2

  // Pieces that are not in every column: these are what differs.
  const counts = new Map<string, number>()
  for (const { render: r } of picked) if (r) for (const id of r.itemIds) counts.set(id, (counts.get(id) ?? 0) + 1)
  const differs = (id: string) => picked.length > 1 && (counts.get(id) ?? 0) < picked.length

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (full) {
        const at = picked.findIndex((p) => p.id === full)
        if (e.key === 'Escape') setFull(null)
        else if (e.key === 'ArrowLeft' && at > 0) setFull(picked[at - 1].id)
        else if (e.key === 'ArrowRight' && at < picked.length - 1) setFull(picked[at + 1].id)
        return
      }
      if (e.key === 'Escape') onBack()
      if (e.key === '0') setView(FIT)
      const n = Number(e.key)
      const r = picked[n - 1]?.render
      if (n >= 1 && r) { api.favorite(r.id, !r.favorite).then(w.refresh) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [picked, onBack, w.refresh, full])

  const [dragId, setDragId] = useState<string | null>(null)
  const els = useRef(new Map<string, HTMLElement>())
  const move = (id: string, to: number) => {
    const ids = w.compareIds
    const from = ids.indexOf(id)
    if (from < 0 || to < 0 || to >= ids.length || from === to) return
    const next = [...ids]
    next.splice(to, 0, next.splice(from, 1)[0])
    w.setCompareIds(next)
  }
  const toggle = (id: string) => {
    const res = w.toggleCompare(id)
    if (res === 'full') w.setToast('Compare holds 8 looks. Remove one first.')
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} aria-label="Back" className="-ml-2 grid size-9 place-items-center rounded-full text-ink-2 hover:bg-panel hover:text-ink"><ArrowLeft size={18} strokeWidth={1.75} /></button>
          <h1 className="text-title">Compare</h1>
          <span className="tabular text-meta text-ink-3">{picked.length} of {MAX}</span>
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
      <div ref={stage} className="relative mt-5 flex min-h-0 flex-1 items-center justify-center">
        {picked.length === 0 ? (
          <div className="grid flex-1 place-items-center self-stretch rounded-[20px] border border-dashed border-line-strong p-8 text-center">
            <div>
              <p className="text-title">Pick looks to compare</p>
              <p className="mx-auto mt-2 max-w-[42ch] text-body text-ink-2">Choose 2 to 8 looks from the strip below, including the original photo. Zoom with the scroll wheel; every look zooms together so you can check fit and details.</p>
            </div>
          </div>
        ) : wipeMode ? (
          <div className="flex w-full flex-col items-center" style={{ height: '100%' }}>
            <WipePair a={picked[0]} b={picked[1]} pos={wipe} setPos={setWipe} view={view} setView={setView} w={cell.w * 2 + GAP} h={cell.h} />
            <div className="mt-2 grid gap-2" style={{ width: cell.w * 2 + GAP, gridTemplateColumns: '1fr 1fr' }}>
              {picked.map((e, i) => <Strip key={e.id} e={e} i={i} w={w} byId={byId} differs={differs} onWear={onWear} toggle={toggle} />)}
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap content-center justify-center" style={{ gap: GAP }}>
            <AnimatePresence initial={false}>
              {picked.map((e, i) => (
                <Column key={e.id} onOpen={() => setFull(e.id)} e={e} i={i} cell={cell} view={view} setView={setView} dragging={dragId === e.id} anyDragging={!!dragId} els={els}
                  onStart={() => setDragId(e.id)} onEnd={() => setDragId(null)}
                  onOver={(x, y) => {
                    // Live reorder: when the dragged column's centre passes over another column, swap into its slot.
                    for (const [id, el] of els.current) {
                      if (id === e.id) continue
                      const r = el.getBoundingClientRect()
                      if (x > r.left && x < r.right && y > r.top && y < r.bottom) { move(e.id, picked.findIndex((p) => p.id === id)); break }
                    }
                  }}
                  onMove={(d) => move(e.id, i + d)}>
                  <Strip e={e} i={i} w={w} byId={byId} differs={differs} onWear={onWear} toggle={toggle} />
                </Column>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      <AnimatePresence>
        {full && (() => {
          const e = picked.find((p) => p.id === full)
          if (!e) return null
          return (
            <motion.div key="full" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onClick={() => setFull(null)} className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-black/85 p-4" role="dialog" aria-label="Full size">
              <img src={e.url} alt="" className="block rounded-xl object-contain shadow-lift" style={{ maxHeight: 'calc(100dvh - 4rem)', maxWidth: 'calc(100vw - 2rem)' }} onClick={(ev) => ev.stopPropagation()} />
              <span className="absolute left-4 top-4 inline-flex h-7 items-center rounded-full bg-card px-3 text-meta">{LETTERS[picked.indexOf(e)]} · {e.render ? 'Look' : 'Original'}</span>
              <button onClick={() => setFull(null)} aria-label="Close" className="absolute right-4 top-4 grid size-10 place-items-center rounded-full bg-card text-ink shadow-float"><X size={18} strokeWidth={1.75} /></button>
            </motion.div>
          )
        })()}
      </AnimatePresence>

      {/* filmstrip: every try-on of this photo */}
      <div className="mt-4 border-t border-line pt-3">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {all.length === 0 && <p className="py-4 text-meta text-ink-2">No try-ons yet. Render a few outfits on Try on first.</p>}
          {s.photo && (() => {
            const idx = w.compareIds.indexOf('original')
            return (
              <button onClick={() => toggle('original')} aria-pressed={idx >= 0} title={idx >= 0 ? 'Remove original from compare' : 'Add original photo to compare'} className={`relative h-24 shrink-0 overflow-hidden rounded-xl bg-panel transition-[box-shadow,opacity] ${idx >= 0 ? 'shadow-[0_0_0_2px_var(--color-ink)]' : 'opacity-70 ring-1 ring-line hover:opacity-100'}`} style={{ aspectRatio: '3 / 4' }}>
                <img loading="lazy" decoding="async" src={s.photo!.url} alt="" className="size-full object-cover" />
                <span className="absolute bottom-1.5 left-1.5 rounded-full bg-card/95 px-2 text-meta text-ink shadow-float">Original</span>
                {idx >= 0 && <span className="absolute left-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-ink text-[0.6875rem] text-paper">{LETTERS[idx]}</span>}
              </button>
            )
          })()}
          {all.map((r) => {
            const idx = w.compareIds.indexOf(r.id)
            return (
              <button key={r.id} onClick={() => toggle(r.id)} aria-pressed={idx >= 0} title={idx >= 0 ? 'Remove from compare' : 'Add to compare'} className={`relative h-24 shrink-0 overflow-hidden rounded-xl bg-panel transition-[box-shadow,opacity] ${idx >= 0 ? 'shadow-[0_0_0_2px_var(--color-ink)]' : 'opacity-70 ring-1 ring-line hover:opacity-100'}`} style={{ aspectRatio: '3 / 4' }}>
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
function ZoomPane({ src, view, setView, onOpen }: { onOpen?: () => void; src: string; view: View; setView: (v: View | ((v: View) => View)) => void }) {
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
      onClick={() => { if (view.s === 1) onOpen?.() }}
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
function WipePair({ a, b, pos, setPos, view, setView, w, h }: { a: Entry; b: Entry; w: number; h: number; pos: number; setPos: (n: number) => void; view: View; setView: (v: View | ((v: View) => View)) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const move = (clientX: number) => {
    const r = box.current!.getBoundingClientRect()
    setPos(Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100)))
  }
  return (
    <div ref={box} className="relative shrink-0 overflow-hidden rounded-2xl bg-panel ring-1 ring-line" style={{ width: w, height: h }}>
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

/** Piece strip + actions under a column. The original photo has no pieces, only a remove button. */
function Strip({ e, i, w, byId, differs, onWear, toggle }: { e: Entry; i: number; w: Wardrobe; byId: Map<string, Item>; differs: (id: string) => boolean; onWear: (r: Render) => void; toggle: (id: string) => void }) {
  const r = e.render
  const items = r ? (r.itemIds.map((id) => byId.get(id)).filter(Boolean) as Item[]) : []
  const wish = items.filter((it) => !isOwned(it)).length
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-1">
        <p className="truncate text-label"><span className="text-ink-3">{LETTERS[i]} · </span>{r ? <>{items.length} {items.length === 1 ? 'piece' : 'pieces'}{wish ? <span className="text-ink-2"> · {wish} wish</span> : null}</> : 'Original'}</p>
        <div className="flex shrink-0 items-center">
          {r && (
            <>
              <button onClick={() => api.favorite(r.id, !r.favorite).then(w.refresh)} aria-pressed={!!r.favorite} title={`Favourite (${i + 1})`} className={`grid size-8 place-items-center rounded-full hover:bg-panel ${r.favorite ? 'text-accent' : 'text-ink-3 hover:text-ink'}`}>
                <motion.span key={String(r.favorite)} initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={{ duration: 0.3, ease }}><Heart size={16} strokeWidth={1.75} fill={r.favorite ? 'currentColor' : 'none'} /></motion.span>
              </button>
              <button onClick={() => onWear(r)} className="h-8 rounded-full px-2.5 text-meta text-ink-2 hover:bg-panel hover:text-ink">Open</button>
            </>
          )}
          <button onClick={() => toggle(e.id)} aria-label={`Remove ${LETTERS[i]}`} className="grid size-8 place-items-center rounded-full text-ink-3 hover:bg-panel hover:text-ink"><X size={15} strokeWidth={1.75} /></button>
        </div>
      </div>
      {items.length > 0 && (
        <div className="mt-1 flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
          {items.map((it) => (
            <span key={it.id} title={`${it.name || it.category}${differs(it.id) ? ' (differs)' : ''}`} className={`relative size-9 shrink-0 overflow-hidden rounded-lg bg-plate ${differs(it.id) ? 'ring-[1.5px] ring-ink' : 'ring-1 ring-line'}`}>
              <img loading="lazy" decoding="async" src={it.imageUrl} alt="" className="size-full object-contain p-1 mix-blend-multiply" />
              {!isOwned(it) && <Heart size={9} strokeWidth={2.5} className="absolute right-0.5 top-0.5 text-ink" />}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * One compare column. Grab the grip on the letter chip and the column lifts; the others slide aside
 * as you pass over them (Notion / Lightroom-filmstrip style), then it settles into its new slot.
 * Arrow keys on the focused chip move it too.
 */
function Column({ onOpen, e, i, cell, view, setView, dragging, anyDragging, els, onStart, onEnd, onOver, onMove, children }: {
  onOpen: () => void
  e: Entry; i: number; cell: { w: number; h: number }; view: View; setView: (v: View | ((v: View) => View)) => void
  dragging: boolean; anyDragging: boolean; els: React.MutableRefObject<Map<string, HTMLElement>>
  onStart: () => void; onEnd: () => void; onOver: (x: number, y: number) => void; onMove: (d: number) => void; children: React.ReactNode
}) {
  const controls = useDragControls()
  return (
    <motion.div
      ref={(el) => { if (el) els.current.set(e.id, el); else els.current.delete(e.id) }}
      layout
      drag
      dragControls={controls}
      dragListener={false}
      dragSnapToOrigin
      dragElastic={0}
      dragMomentum={false}
      onDragStart={onStart}
      onDragEnd={onEnd}
      onDrag={(_, info) => { const el = els.current.get(e.id); if (el) { const r = el.getBoundingClientRect(); onOver(r.left + r.width / 2, r.top + r.height / 2) } else onOver(info.point.x, info.point.y) }}
      initial={{ opacity: 0 }}
      animate={{ opacity: anyDragging && !dragging ? 0.75 : 1, scale: dragging ? 1.03 : 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25, ease, layout: { duration: 0.3, ease } }}
      whileDrag={{ zIndex: 30, cursor: 'grabbing' }}
      className="relative min-w-0"
      style={{ width: cell.w }}
    >
      <div className={`relative overflow-hidden rounded-2xl bg-panel transition-shadow ${dragging ? 'shadow-lift ring-2 ring-ink' : 'ring-1 ring-line'}`} style={{ width: cell.w, height: cell.h }}>
        <ZoomPane src={e.url} view={view} setView={setView} onOpen={onOpen} />
        <button
          aria-label={`Move ${LETTERS[i]}. Drag, or use arrow keys`}
          title="Drag to reorder"
          onPointerDown={(ev: RPointerEvent) => { ev.preventDefault(); controls.start(ev) }}
          onKeyDown={(ev) => { if (ev.key === 'ArrowLeft') { ev.preventDefault(); onMove(-1) } if (ev.key === 'ArrowRight') { ev.preventDefault(); onMove(1) } }}
          className={`absolute left-2 top-2 flex h-7 touch-none items-center gap-0.5 rounded-full bg-card pl-1 pr-2.5 text-meta shadow-float ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        >
          <GripVertical size={14} strokeWidth={1.75} className="text-ink-3" />{LETTERS[i]}
        </button>
        {e.render ? <ProviderTag provider={e.render.provider} model={e.render.model} className="pointer-events-none absolute right-2 top-2" /> : <span className="pointer-events-none absolute right-2 top-2 inline-flex h-6 items-center rounded-full bg-card/95 px-2.5 text-meta text-ink shadow-float">Original</span>}
      </div>
      <div className="mt-1.5" style={{ height: STRIP - 6 }}>{children}</div>
    </motion.div>
  )
}
