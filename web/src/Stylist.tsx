import { AnimatePresence, motion } from 'framer-motion'
import { Check, ExternalLink, Heart, Send, Sparkles, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api, type StylistMessage, type StylistPiece } from './api'
import type { Wardrobe } from './store'
import { Button, ease } from './ui'

const IDEAS = [
  'What is trending this season? Casual and smart-casual.',
  'Something to wear to a dinner or a wedding.',
  'What goes well with the pieces I already own?',
  'A clean, minimal capsule for everyday.',
]

function useElapsed(since?: number) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { if (!since) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [since])
  if (!since) return ''
  const s = Math.max(0, Math.floor((now - since) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** One suggested piece: add it to the wishlist in one click (reads the shop page for its photo), or open the shop. */
function PieceCard({ piece, w }: { piece: StylistPiece; w: Wardrobe }) {
  const [state, setState] = useState<'idle' | 'busy' | 'added'>('idle')
  const [err, setErr] = useState<string | null>(null)
  const add = async () => {
    if (!piece.url) return
    setState('busy'); setErr(null)
    try {
      const scan = await api.scan(piece.url)
      if (!scan.candidates.length) throw new Error('No product photo found on that page')
      await api.addFromUrl({ imageUrl: scan.candidates[0], pageUrl: piece.url, category: piece.category, name: (scan.title || piece.product || piece.name).replace(/\s*[|–-].*$/, '').slice(0, 60), price: scan.price, store: scan.store || piece.shop })
      await w.refresh()
      setState('added')
      w.setToast('Added to your Wishlist. Try it on from Closet.')
    } catch (e) { setState('idle'); setErr((e as Error).message) }
  }
  return (
    <div className="flex flex-col rounded-[16px] p-4 ring-1 ring-line">
      <div className="flex items-start justify-between gap-3">
        <p className="text-body">{piece.name}</p>
        <span className="shrink-0 rounded-full bg-panel px-2.5 py-0.5 text-meta capitalize text-ink-2">{piece.category}</span>
      </div>
      {piece.why && <p className="mt-1.5 text-meta text-ink-2">{piece.why}</p>}
      <p className="mt-2 text-meta text-ink-3">{piece.shop ? `${piece.product || piece.name} · ${piece.shop}` : piece.product}</p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {piece.url ? (
          <>
            <Button size="sm" variant="primary" onClick={add} disabled={state !== 'idle'}>
              {state === 'added' ? <><Check size={14} strokeWidth={2} /> In wishlist</> : state === 'busy' ? 'Reading the shop…' : <><Heart size={14} strokeWidth={1.75} /> Add to wishlist</>}
            </Button>
            <a href={piece.url} target="_blank" rel="noreferrer noopener" className="inline-flex h-9 items-center gap-1 rounded-full px-3 text-meta text-ink-2 hover:bg-panel hover:text-ink">Open shop <ExternalLink size={12} strokeWidth={1.75} /></a>
          </>
        ) : <span className="text-meta text-ink-3">No link came back for this one.</span>}
      </div>
      {err && <p className="mt-2 text-meta text-warn">{err}. Use “Open shop”, then add it from Closet → Wishlist.</p>}
    </div>
  )
}

function Answer({ m, w }: { m: StylistMessage; w: Wardrobe }) {
  if (m.error) return <p className="max-w-[60ch] text-body text-ink-2">Meta AI didn’t answer. <span className="text-meta text-ink-3">{m.error.message}</span></p>
  return (
    <div className="max-w-[72ch]">
      {m.intro && <p className="whitespace-pre-line text-body text-ink-2">{m.intro}</p>}
      {m.text && <p className="whitespace-pre-line text-body text-ink-2">{m.text}</p>}
      {m.pieces && m.pieces.length > 0 && (
        <div className="mt-5 grid gap-3 sm:grid-cols-2">{m.pieces.map((p, i) => <PieceCard key={i} piece={p} w={w} />)}</div>
      )}
      {m.outro && <p className="mt-5 text-meta text-ink-2">{m.outro}</p>}
      {m.link && <a href={m.link} target="_blank" rel="noreferrer noopener" className="mt-3 inline-flex items-center gap-1 text-meta text-ink-3 hover:text-ink">Open in Meta AI <ExternalLink size={12} strokeWidth={1.75} /></a>}
    </div>
  )
}

export function StylistView({ w }: { w: Wardrobe }) {
  const s = w.state!
  const { messages, busy } = s.stylist
  const [text, setText] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const end = useRef<HTMLDivElement>(null)
  const elapsed = useElapsed(busy?.startedAt)
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages.length, !!busy])

  const ask = async (q: string) => {
    const prompt = q.trim()
    if (!prompt || busy) return
    setErr(null); setText('')
    try { await api.askStylist(prompt); await w.refresh() } catch (e) { setErr((e as Error).message) }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-display">Stylist</h1>
          <p className="mt-3 max-w-[60ch] text-body text-ink-2">Ask Meta AI what to wear. It uses current trends and the weather, and brings back shop links you can add straight to your Wishlist.</p>
        </div>
        {messages.length > 0 && !busy && (
          <button onClick={() => api.clearStylist().then(() => w.refresh())} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-meta text-ink-3 hover:bg-panel hover:text-ink"><Trash2 size={14} strokeWidth={1.75} /> Clear</button>
        )}
      </div>

      <div className="mt-8 min-h-0 flex-1 overflow-y-auto pb-4">
        {messages.length === 0 && !busy && (
          <div>
            <p className="text-label text-ink-3">Try asking</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {IDEAS.map((q) => <button key={q} onClick={() => ask(q)} className="rounded-full px-4 py-2 text-left text-label text-ink-2 ring-1 ring-line transition-colors hover:bg-panel hover:text-ink">{q}</button>)}
            </div>
          </div>
        )}
        <div className="space-y-8">
          {messages.map((m) => (
            <motion.div key={m.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease }}>
              {m.role === 'user' ? (
                <div className="flex justify-end"><p className="max-w-[56ch] rounded-[18px] bg-panel px-4 py-2.5 text-body">{m.text}</p></div>
              ) : <Answer m={m} w={w} />}
            </motion.div>
          ))}
        </div>
        <AnimatePresence>
          {busy && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-8 flex items-center gap-3 text-body text-ink-2">
              <Sparkles size={16} strokeWidth={1.75} className="tile-pulse" /> Meta AI is looking up trends and shops… <span className="tabular text-ink-3">{elapsed}</span>
            </motion.div>
          )}
        </AnimatePresence>
        <div ref={end} />
      </div>

      <form onSubmit={(e) => { e.preventDefault(); ask(text) }} className="mt-2 flex items-center gap-2 rounded-full bg-panel py-2 pl-5 pr-2">
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={600} disabled={!!busy} placeholder={busy ? 'Waiting for the stylist…' : 'What should I wear? e.g. a dinner outfit under 10,000 rupees'}
          className="h-9 min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-ink-3" aria-label="Ask the stylist" />
        <Button variant="primary" size="sm" type="submit" disabled={!text.trim() || !!busy}><Send size={14} strokeWidth={1.75} /> Ask</Button>
      </form>
      {err && <p className="mt-2 text-meta text-warn">{err}</p>}
      <p className="mt-2 text-meta text-ink-3">Sends your question and the names of your own closet pieces to Meta AI, in your own Chrome. Takes 1 to 2 minutes.</p>
    </div>
  )
}
