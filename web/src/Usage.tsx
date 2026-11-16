import { animate, motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'framer-motion'
import { ExternalLink, Minus, Plus, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, type Usage } from './api'
import { ease } from './ui'

/** Ticking number: counts to its new value instead of jumping. */
export function AnimatedNumber({ value, className = '' }: { value: number; className?: string }) {
  const reduce = useReducedMotion()
  const mv = useMotionValue(value)
  const text = useTransform(mv, (v) => String(Math.round(v)))
  useEffect(() => {
    if (reduce) { mv.set(value); return }
    const c = animate(mv, value, { duration: 0.6, ease })
    return () => c.stop()
  }, [value, mv, reduce])
  return <motion.span className={`tabular ${className}`}>{text}</motion.span>
}

export function useCountdown(at: number | null) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { if (!at) return; const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t) }, [at])
  if (!at) return null
  const mins = Math.max(0, Math.round((at - now) / 60000))
  return mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`
}

const tone = (u: Usage) => (u.blocked ? 'var(--color-warn)' : u.used / u.usable >= 0.8 ? 'var(--color-warn)' : 'var(--color-ink)')

/** Header ring (Apple Activity-style): fills as today's usable images are spent. */
export function UsageRing({ u, size = 22, dot }: { u?: Usage; size?: number; dot?: string }) {
  const r = size / 2 - 2
  const c = 2 * Math.PI * r
  const frac = u ? Math.min(1, u.used / u.usable) : 0
  const spring = useSpring(frac, { stiffness: 120, damping: 20 })
  useEffect(() => { spring.set(frac) }, [frac, spring])
  const offset = useTransform(spring, (f) => c * (1 - f))
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-line-strong)" strokeWidth={2.25} />
      {u && <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tone(u)} strokeWidth={2.25} strokeLinecap="round" strokeDasharray={c} style={{ strokeDashoffset: offset }} />}
      {dot && <circle cx={size / 2} cy={size / 2} r={2.5} fill={dot} />}
    </svg>
  )
}

/**
 * One row per engine, after Claude's and Gemini's Settings → Usage: what's used, a bar, when it resets.
 * The bar spans the vendor's whole allowance; the darker zone is the share this app may use.
 */
export type LimitDraft = { limit: number; pct: number }
export function UsageCard({ u, label, active, draft, onDraft }: { u: Usage; label: string; active: boolean; draft: LimitDraft; onDraft: (d: LimitDraft) => void }) {
  const reduce = useReducedMotion()
  const { limit, pct } = draft
  const setLimit = (f: (v: number) => number) => onDraft({ limit: f(limit), pct })
  const setPct = (v: number) => onDraft({ limit, pct: v })
  const countdown = useCountdown(u.resetsAt)
  const usableNow = Math.max(1, Math.floor((limit * pct) / 100))
  const usedFrac = Math.min(1, u.used / limit)
  const capFrac = usableNow / limit

  const status = u.blocked ? `Limit reached · next frees up in ${countdown}` : `${u.left} left today`
  return (
    <motion.div layout className="rounded-[16px] p-6 ring-1 ring-line">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-body">
            {label}
            {active && <span className="rounded-full bg-panel px-2 py-0.5 text-meta text-ink-2">In use</span>}
          </p>
          <p className="mt-0.5 text-meta text-ink-3">{u.plan}</p>
        </div>
        <p className="text-right">
          <span className="text-title"><AnimatedNumber value={u.used} /></span>
          <span className="text-meta text-ink-3"> / <AnimatedNumber value={usableNow} /> today</span>
        </p>
      </div>

      {/* allowance bar */}
      <div className="relative mt-5 h-2.5">
        <div className="absolute inset-0 overflow-hidden rounded-full bg-panel">
          {/* reserved zone (the share the app leaves untouched), hatched */}
          <motion.div className="absolute inset-y-0 right-0" initial={false} animate={{ left: `${capFrac * 100}%` }} transition={{ duration: reduce ? 0 : 0.5, ease }}
            style={{ backgroundImage: 'repeating-linear-gradient(-45deg, var(--color-line-strong) 0 1.5px, transparent 1.5px 5px)' }} />
          {/* used */}
          <motion.div className="absolute inset-y-0 left-0 origin-left rounded-full" style={{ width: '100%', background: tone(u) }} initial={{ scaleX: 0 }} animate={{ scaleX: usedFrac }} transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 90, damping: 18 }} />
        </div>
        {/* cap marker */}
        <motion.div className="absolute -top-1 bottom-[-4px] w-px bg-ink" initial={false} animate={{ left: `${capFrac * 100}%` }} transition={{ duration: reduce ? 0 : 0.5, ease }}>
          <span className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[0.6875rem] text-ink-2"><AnimatedNumber value={pct} />%</span>
        </motion.div>
      </div>
      <div className="mt-2 flex items-center justify-between text-meta text-ink-3">
        <span className={u.blocked ? 'text-warn' : ''}>{status}</span>
        <span className="tabular">{u.limit} free / day</span>
      </div>

      {/* every image in the window, newest last; pops in when a job lands */}
      {u.events.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1" aria-label={`${u.renders} try-ons and ${u.cutouts} cleanups in the last 24 hours`}>
          {u.events.map((e, i) => (
            <motion.span key={e.at} title={`${e.kind === 'render' ? 'Try-on' : 'Cleanup'} · ${new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
              initial={reduce ? false : { scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: reduce ? 0 : Math.min(i, 20) * 0.025, type: 'spring', stiffness: 500, damping: 22 }}
              className={`size-2.5 rounded-full ${e.kind === 'render' ? 'bg-ink' : 'ring-[1.5px] ring-inset ring-ink'}`} />
          ))}
          <span className="ml-2 inline-flex items-center gap-1.5 text-[0.6875rem] leading-[10px] text-ink-3">
            <span className="size-2 rounded-full bg-ink" /> try-on <span className="ml-1 size-2 rounded-full ring-[1.5px] ring-inset ring-ink" /> cleanup
          </span>
        </div>
      )}

      {/* controls */}
      <div className="mt-6 grid grid-cols-1 gap-6 border-t border-line pt-6 sm:grid-cols-2">
        <div>
          <p className="text-meta text-ink-2">Free allowance per day</p>
          <div className="mt-2 flex items-center gap-1">
            <button onClick={() => setLimit((v) => Math.max(1, v - 1))} aria-label="Decrease allowance" className="grid size-8 place-items-center rounded-full bg-panel text-ink-2 hover:bg-panel-2 hover:text-ink"><Minus size={14} strokeWidth={1.75} /></button>
            <input type="number" min={1} max={10000} value={limit} onChange={(e) => setLimit(() => Math.max(1, Math.min(10000, Number(e.target.value) || 1)))} className="tabular h-8 w-16 rounded-lg bg-transparent text-center text-body outline-none focus:ring-1 focus:ring-ink/40 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" aria-label="Free allowance per day" />
            <button onClick={() => setLimit((v) => Math.min(10000, v + 1))} aria-label="Increase allowance" className="grid size-8 place-items-center rounded-full bg-panel text-ink-2 hover:bg-panel-2 hover:text-ink"><Plus size={14} strokeWidth={1.75} /></button>
          </div>
        </div>
        <div>
          <p className="flex justify-between text-meta text-ink-2"><span>Usable share</span><span className="tabular text-ink">{pct}% · {usableNow} images</span></p>
          <input type="range" min={5} max={100} step={5} value={pct} onChange={(e) => setPct(Number(e.target.value))} aria-label="Usable share of the free allowance"
            className="mt-3.5 h-1 w-full cursor-pointer appearance-none rounded-full bg-panel-2 accent-[var(--color-ink)] [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-ink [&::-webkit-slider-thumb]:shadow-float [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-125" />
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-meta text-ink-3">
        <p className="max-w-[52ch]">{u.note}</p>
        <div className="flex items-center gap-3">
          <a href={u.source} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 hover:text-ink">Source <ExternalLink size={12} strokeWidth={1.75} /></a>
          <button onClick={() => api.setLimit(u.engine, { reset: true })} className="inline-flex h-8 items-center gap-1 hover:text-ink"><RotateCcw size={12} strokeWidth={1.75} /> Defaults</button>
        </div>
      </div>
    </motion.div>
  )
}
