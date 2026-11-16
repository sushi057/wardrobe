import { AnimatePresence, motion } from 'framer-motion'
import { Columns2, Heart, Trash2 } from 'lucide-react'
import { api, type Render } from './api'
import type { Wardrobe } from './store'
import { ease, ProviderTag } from './ui'

function fmt(ts: number) {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function LooksView({ w, open }: { w: Wardrobe; open: (itemIds: string[], renderId: string | null) => void }) {
  const s = w.state!
  const renders = [...s.renders].filter((r) => r.photoId === s.photo?.id).reverse()
  const byId = new Map(s.items.map((i) => [i.id, i]))
  const renderById = new Map(s.renders.map((r) => [r.id, r]))

  // Doppl "Your Looks" card: tall grey tile, render fills it; pieces slide up on hover.
  const tile = (key: string, i: number, r: Render | null, itemIds: string[], title: string | null, onDelete: () => void) => (
    <motion.div key={key} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: 0.45, ease, delay: Math.min(i, 8) * 0.04 }} className="group">
      <button onClick={() => open(itemIds, r?.id ?? null)} className="relative block aspect-[3/4] w-full overflow-hidden rounded-[16px] bg-panel text-left">
        {r ? (
          <img loading="lazy" decoding="async" src={r.url} alt={title ?? 'Look'} className="size-full object-cover transition-transform duration-700 ease-[var(--ease-out-expo)] group-hover:scale-[1.03]" />
        ) : (
          <div className="grid size-full grid-cols-2 gap-px bg-line">
            {itemIds.slice(0, 4).map((id) => byId.get(id) && <img key={id} src={byId.get(id)!.imageUrl} alt="" className="size-full bg-plate object-contain p-4" />)}
          </div>
        )}
        {r && <ProviderTag provider={r.provider} model={r.model} className="absolute left-3 top-3" />}
        {r && w.compareIds.includes(r.id) && <span className="absolute right-3 top-3 grid size-6 place-items-center rounded-full bg-ink text-[0.6875rem] text-paper">{'ABCDEFGH'[w.compareIds.indexOf(r.id)]}</span>}
        {r?.favorite && <span className="absolute bottom-3 right-3 grid size-7 place-items-center rounded-full bg-card text-accent shadow-float transition-opacity group-hover:opacity-0"><Heart size={13} strokeWidth={1.75} fill="currentColor" /></span>}
        <div className="absolute inset-x-3 bottom-3 flex translate-y-2 gap-1.5 rounded-full bg-card/95 p-1.5 opacity-0 shadow-float transition-all duration-300 ease-[var(--ease-out-expo)] group-hover:translate-y-0 group-hover:opacity-100">
          {itemIds.map((id) => byId.get(id) && <img key={id} src={byId.get(id)!.imageUrl} alt="" className="size-9 rounded-full bg-plate object-contain p-1 ring-1 ring-line" />)}
        </div>
      </button>
      <div className="mt-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-label">{title ?? `Try-on ${fmt(r!.createdAt)}`}</p>
          <p className="tabular mt-0.5 text-meta text-ink-3">{r ? `${fmt(r.createdAt)} · ${itemIds.length} ${itemIds.length === 1 ? 'piece' : 'pieces'}` : 'Not rendered yet'}</p>
        </div>
        <div className="-mr-1.5 flex shrink-0 items-center">
        {r && (
          <button onClick={() => { const res = w.toggleCompare(r.id); if (res === 'full') w.setToast('Compare holds 8 looks. Remove one first.') }} aria-pressed={w.compareIds.includes(r.id)} title={w.compareIds.includes(r.id) ? 'Remove from compare' : 'Add to compare'} className={`grid size-8 place-items-center rounded-full transition-opacity hover:bg-panel ${w.compareIds.includes(r.id) ? 'text-ink opacity-100' : 'text-ink-3 opacity-0 hover:text-ink group-hover:opacity-100 focus:opacity-100 pointer-coarse:opacity-100'}`}><Columns2 size={14} strokeWidth={1.75} /></button>
        )}
        <button onClick={onDelete} aria-label="Delete" className="grid size-8 shrink-0 place-items-center rounded-full text-ink-3 opacity-0 transition-opacity hover:bg-panel hover:text-warn group-hover:opacity-100 focus:opacity-100 pointer-coarse:opacity-100"><Trash2 size={14} strokeWidth={1.75} /></button>
        </div>
      </div>
    </motion.div>
  )

  const grid = 'grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-[repeat(auto-fill,minmax(220px,1fr))] lg:gap-x-6'

  return (
    <div className="h-full overflow-y-auto pb-12">
      <h1 className="text-display">Your looks</h1>
      <p className="mt-2 text-body text-ink-2">Every outfit you’ve tried on. Open one to wear it again.</p>

      {s.looks.length > 0 && (
        <section className="mt-10">
          <h2 className="text-title">Saved</h2>
          <motion.div layout className={`mt-5 ${grid}`}>
            <AnimatePresence>
              {s.looks.map((l, i) => tile(l.id, i, l.renderId ? renderById.get(l.renderId) ?? null : null, l.itemIds, l.name, () => api.deleteLook(l.id).then(w.setState)))}
            </AnimatePresence>
          </motion.div>
        </section>
      )}

      <section className="mt-12">
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-title">All try-ons</h2>
          <span className="tabular text-meta text-ink-3">{renders.length}</span>
        </div>
        {renders.length === 0 ? (
          <p className="mt-4 max-w-[52ch] text-body text-ink-2">Nothing yet. Pick a few pieces on Try on and press the black button. Each render lands here, tagged with the model that made it.</p>
        ) : (
          <motion.div layout className={`mt-5 ${grid}`}>
            <AnimatePresence>
              {renders.map((r, i) => tile(r.id, i, r, r.itemIds, null, () => { if (confirm('Delete this try-on?')) api.deleteRender(r.id).then(w.setState) }))}
            </AnimatePresence>
          </motion.div>
        )}
      </section>
    </div>
  )
}
