import { AnimatePresence, motion } from 'framer-motion'
import { Check, Monitor, Moon, Sun, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, type Health } from './api'
import { ClosetView } from './Closet'
import { CompareView } from './Compare'
import { type LimitDraft, UsageCard, UsageRing } from './Usage'
import { LooksView } from './Looks'
import { StylistView } from './Stylist'
import { useWardrobe } from './store'
import { ReportButton, SetupView, useSetup } from './Setup'
import { PhotoDrop, TryOnView } from './TryOn'
import { Button, ease } from './ui'

type View = 'tryon' | 'looks' | 'compare' | 'closet' | 'stylist' | 'you'
const TABS: { id: View; label: string }[] = [
  { id: 'tryon', label: 'Try on' },
  { id: 'looks', label: 'Looks' },
  { id: 'compare', label: 'Compare' },
  { id: 'closet', label: 'Closet' },
  { id: 'stylist', label: 'Stylist' },
  { id: 'you', label: 'You' },
]

function useHealth() {
  const [h, setH] = useState<Health | null>(null)
  const [checking, setChecking] = useState(false)
  const check = () => { setChecking(true); api.health().then(setH).catch(() => setH({ ok: false, profile: null, error: 'unknown' })).finally(() => setChecking(false)) }
  useEffect(check, [])
  return { h, checking, check }
}

type Theme = 'system' | 'light' | 'dark'
const THEME_NEXT: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' }

function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    try { return (localStorage.getItem('wardrobe-theme') as Theme) || 'system' } catch { return 'system' }
  })
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const apply = () => { document.documentElement.dataset.theme = theme === 'dark' || (theme === 'system' && mq.matches) ? 'dark' : 'light' }
    apply()
    try { localStorage.setItem('wardrobe-theme', theme) } catch { /* private mode */ }
    if (theme !== 'system') return
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])
  return { theme, cycle: () => setTheme((t) => THEME_NEXT[t]) }
}

function ThemeButton() {
  const { theme, cycle } = useTheme()
  const Icon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor
  const label = `Theme: ${theme}. Switch to ${THEME_NEXT[theme]}`
  return (
    <button onClick={cycle} title={label} aria-label={label} className="relative grid size-9 place-items-center overflow-hidden rounded-full text-ink-2 transition-colors hover:bg-panel hover:text-ink">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={theme} initial={{ y: 14, opacity: 0, rotate: -40 }} animate={{ y: 0, opacity: 1, rotate: 0 }} exit={{ y: -14, opacity: 0, rotate: 40 }} transition={{ duration: 0.3, ease }}>
          <Icon size={17} strokeWidth={1.75} />
        </motion.span>
      </AnimatePresence>
    </button>
  )
}

const FONTS = [
  { id: 'source-serif', label: 'Source Serif', note: 'Editorial serif · default', family: '"Source Serif 4", serif' },
  { id: 'newsreader', label: 'Newsreader', note: 'Classic book serif', family: '"Newsreader", serif' },
  { id: 'manrope', label: 'Manrope', note: 'Soft geometric sans', family: '"Manrope", sans-serif' },
  { id: 'geist', label: 'Geist', note: 'Precise Swiss sans', family: '"Geist", sans-serif' },
] as const
type FontId = (typeof FONTS)[number]['id']
const currentFont = (): FontId => { try { return (localStorage.getItem('wardrobe-font') as FontId) || 'source-serif' } catch { return 'source-serif' } }
/** Apply everywhere at once and remember it (this browser + server, so every browser matches). */
const applyFont = (f: FontId) => {
  document.documentElement.dataset.font = f
  try { localStorage.setItem('wardrobe-font', f) } catch { /* private mode */ }
}

function YouView({ w, health }: { w: ReturnType<typeof useWardrobe>; health: ReturnType<typeof useHealth> }) {
  const s = w.state!
  const statusText = health.h === null || health.checking ? 'Checking the browser connection…' : health.h.ok ? 'Chrome is connected and Gemini is signed in' : 'The browser engine isn’t reachable'
  const [font, setFont] = useState<FontId>(currentFont())
  const pickFont = (f: FontId) => { setFont(f); applyFont(f); api.setFont(f) }
  const saved = { engine: s.settings.engine, limits: Object.fromEntries(Object.values(s.usage ?? {}).map((u) => [u.engine, { limit: u.limit, pct: u.pct }])) as Record<string, LimitDraft> }
  const [draft, setDraft] = useState(saved)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)

  const save = async () => {
    setStatus('saving')
    try {
      if (draft.engine !== saved.engine) await api.setEngine(draft.engine)
      for (const [engine, d] of Object.entries(draft.limits)) {
        const o = saved.limits[engine]
        if (!o || o.limit !== d.limit || o.pct !== d.pct) await api.setLimit(engine, d)
      }
      await w.refresh()
      setStatus('saved')
      setTimeout(() => setStatus('idle'), 1800)
    } catch (e) { setStatus('idle'); w.setToast((e as Error).message) }
  }

  return (
    <div className="relative h-full overflow-y-auto">
      <div className="pb-32">
        <h1 className="text-display">You</h1>
        <p className="mt-3 text-body text-ink-2">Your photos, the engine that dresses you, how the app looks, and how much of your free allowance it may use.</p>
        <div className="mt-12 grid grid-cols-1 gap-12 lg:grid-cols-[minmax(320px,1fr)_minmax(0,1.15fr)] xl:grid-cols-[minmax(340px,1fr)_minmax(0,1.1fr)_minmax(0,1fr)] xl:gap-14">
          <section aria-labelledby="you-photo" className="min-w-0">
            <h2 id="you-photo" className="text-title">Your photos</h2>
            <p className="mt-2 max-w-[44ch] text-meta text-ink-2">Keep a few and switch between them. Each photo has its own try-ons.</p>
            <div className="mt-5">
              {s.photo ? (
                <>
                  <img src={s.photo.url} alt="Photo in use" className="w-full rounded-[16px] bg-panel object-cover" style={{ aspectRatio: `${s.photo.width} / ${s.photo.height}`, maxHeight: '68vh' }} />
                  <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-5 lg:grid-cols-4 2xl:grid-cols-5">
                    {s.photos.map((p, i) => {
                      const on = p.id === s.photo!.id
                      return (
                        <div key={p.id} className="group relative">
                          <button onClick={() => !on && w.switchPhoto(p.id).catch((e) => w.setToast(e.message))} aria-pressed={on} aria-label={`Photo ${i + 1}${on ? ' (in use)' : ''}`}
                            className={`block w-full overflow-hidden rounded-xl bg-panel transition-[box-shadow,opacity] ${on ? 'shadow-[0_0_0_2px_var(--color-ink)]' : 'opacity-75 ring-1 ring-line hover:opacity-100'}`} style={{ aspectRatio: '3 / 4' }}>
                            <img loading="lazy" decoding="async" src={p.url} alt="" className="size-full object-cover" />
                          </button>
                          {s.photos.length > 1 && (
                            <button onClick={() => { if (confirm('Remove this photo and its try-ons?')) w.removePhoto(p.id).catch((e) => w.setToast(e.message)) }} aria-label={`Remove photo ${i + 1}`}
                              className="absolute right-1 top-1 grid size-6 place-items-center rounded-full bg-card/95 text-ink-2 opacity-0 shadow-float transition-opacity hover:text-ink focus:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100"><X size={13} strokeWidth={2} /></button>
                          )}
                        </div>
                      )
                    })}
                    <PhotoDrop tile onDone={w.refresh} />
                  </div>
                </>
              ) : (
                <PhotoDrop onDone={w.refresh} />
              )}
            </div>
          </section>

          <div className="min-w-0 space-y-14">
            <section aria-labelledby="you-engine">
              <h2 id="you-engine" className="text-title">Image engine</h2>
              <p className="mt-2 max-w-[56ch] text-meta text-ink-2">Runs in your own Chrome{health.h?.profile ? <> on the <span className="text-ink">{health.h.profile}</span> profile</> : ''}, through OpenCLI. Every image is tagged with the engine that made it.</p>
              <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-[16px] bg-line ring-1 ring-line" role="radiogroup" aria-label="Image engine">
                {s.engines.map((e) => {
                  const active = draft.engine === e.id
                  return (
                    <button key={e.id} role="radio" aria-checked={active} disabled={!e.available} onClick={() => setDraft({ ...draft, engine: e.id })}
                      className={`relative bg-card px-5 py-4 text-left transition-colors duration-200 ${e.available ? 'hover:bg-panel' : 'cursor-not-allowed'}`}>
                      <span className="flex items-center gap-2.5">
                        <span className={`grid size-4 place-items-center rounded-full ring-1 ${active ? 'ring-ink' : 'ring-line-strong'}`}>{active && <motion.span layoutId="engine-dot" className="size-2 rounded-full bg-ink" />}</span>
                        <span className={`text-body ${e.available ? 'text-ink' : 'text-ink-3'}`}>{e.label}</span>
                      </span>
                      <span className="mt-1 block pl-[26px] text-meta text-ink-3">{e.available ? e.model : e.note ?? 'Coming next'}</span>
                      {s.usage?.[e.id] && (() => {
                        const l = draft.limits[e.id] ?? { limit: s.usage[e.id].limit, pct: s.usage[e.id].pct }
                        const n = Math.max(1, Math.floor((l.limit * l.pct) / 100))
                        return <span className="mt-2 block pl-[26px] text-meta"><span className="tabular text-ink">{n} images/day</span> <span className="tabular text-ink-3">· {l.pct}% of {l.limit}</span></span>
                      })()}
                    </button>
                  )
                })}
                {s.engines.length % 2 === 1 && <span className="bg-card" />}
              </div>
              <div className="mt-4 flex items-center justify-between gap-4 rounded-[16px] bg-panel py-3 pl-5 pr-3">
                <div className="flex items-center gap-3">
                  <span className={`size-2 shrink-0 rounded-full ${health.h === null || health.checking ? 'tile-pulse bg-ink-3' : health.h.ok ? 'bg-ok' : 'bg-warn'}`} />
                  <p className="text-label">{statusText}</p>
                </div>
                <Button size="sm" onClick={health.check} disabled={health.checking}>Check again</Button>
              </div>
              {health.h && !health.h.ok && !health.checking && <p className="mt-3 text-meta text-ink-2">Open Chrome{health.h.profile ? ` with the ${health.h.profile} profile` : ''}, make sure the OpenCLI extension is on and you’re signed in to Gemini. {health.h.message}</p>}
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
                <div className="min-w-0">
                  <p className="text-label">Something not working?</p>
                  <p className="mt-0.5 max-w-[52ch] text-meta text-ink-2">Save a report and send the file to whoever shared Wardrobe with you. It has settings and error logs, never your photos.</p>
                </div>
                <ReportButton />
              </div>
            </section>

            <section aria-labelledby="you-type">
              <h2 id="you-type" className="text-title">Typeface</h2>
              <p className="mt-2 text-meta text-ink-2">Applies everywhere as soon as you pick it.</p>
              <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4" role="radiogroup" aria-label="Typeface">
                {FONTS.map((f) => {
                  const active = font === f.id
                  return (
                    <motion.button key={f.id} role="radio" aria-checked={active} whileTap={{ scale: 0.97 }} onClick={() => pickFont(f.id)}
                      className={`relative flex flex-col justify-between rounded-[16px] p-4 text-left transition-shadow duration-200 ${active ? 'shadow-[0_0_0_1.5px_var(--color-ink)]' : 'ring-1 ring-line hover:ring-line-strong'}`}>
                      <span className="block text-[2rem] leading-none tracking-[-0.02em]" style={{ fontFamily: f.family }}>Aa</span>
                      <span className="mt-6 block">
                        <span className="block text-label" style={{ fontFamily: f.family }}>{f.label}</span>
                        <span className="mt-0.5 block text-[0.75rem] leading-snug text-ink-3">{f.note}</span>
                      </span>
                      {active && <motion.span layoutId="font-check" transition={{ duration: 0.3, ease }} className="absolute right-3 top-3 size-2 rounded-full bg-ink" />}
                    </motion.button>
                  )
                })}
              </div>
            </section>
          </div>
          <div className="min-w-0 lg:col-span-2 xl:col-span-1">
            <section aria-labelledby="you-usage">
              <h2 id="you-usage" className="text-title">Usage</h2>
              <p className="mt-2 max-w-[56ch] text-meta text-ink-2">Try-ons and cleanups both count as images, over a rolling 24 hours. The app stops at the usable share so you never hit the provider’s wall mid-render.</p>
              <div className="mt-5 space-y-4">
                {Object.values(s.usage ?? {}).map((u) => (
                  <UsageCard key={u.engine} u={u} label={s.engines.find((e) => e.id === u.engine)?.label ?? u.engine} active={draft.engine === u.engine}
                    draft={draft.limits[u.engine] ?? { limit: u.limit, pct: u.pct }} onDraft={(d) => setDraft({ ...draft, limits: { ...draft.limits, [u.engine]: d } })} />
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>

      {/* Save bar: slides up while there are unsaved changes, confirms, then tucks away. */}
      <AnimatePresence>
        {(dirty || status !== 'idle') && (
          <motion.div initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 16, opacity: 0 }} transition={{ duration: 0.35, ease }}
            className="sticky bottom-4 z-20 mx-auto flex w-fit items-center gap-4 rounded-full bg-card py-2 pl-6 pr-2 shadow-lift ring-1 ring-line">
            <span className="text-label text-ink-2" aria-live="polite">{status === 'saved' ? 'All changes saved' : 'You have unsaved changes'}</span>
            {status !== 'saved' && <Button size="sm" variant="quiet" onClick={() => setDraft(saved)} disabled={status === 'saving'}>Discard</Button>}
            <Button size="sm" variant="primary" onClick={save} disabled={status !== 'idle' || !dirty} className="min-w-[96px]">
              <AnimatePresence mode="wait" initial={false}>
                <motion.span key={status} initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -8, opacity: 0 }} transition={{ duration: 0.2 }} className="flex items-center gap-1.5">
                  {status === 'saved' ? <><Check size={15} strokeWidth={2} /> Saved</> : status === 'saving' ? 'Saving…' : 'Save'}
                </motion.span>
              </AnimatePresence>
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default function App() {
  const w = useWardrobe()
  const [view, setView] = useState<View>('tryon')
  const health = useHealth()
  const setup = useSetup()
  const q = w.state?.queue
  const busy = !!q?.current

  // Server-saved typeface wins, so every browser shows the same one.
  useEffect(() => {
    const f = w.state?.settings.font as FontId | undefined
    if (f && f !== currentFont()) applyFont(f)
  }, [w.state?.settings.font])

  // Once the first-run checks pass, refresh the header's connection dot too.
  useEffect(() => { if (setup.ready) health.check() }, [setup.ready]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!w.state || setup.pending) return <div className="grid h-full place-items-center"><span className="text-title text-ink-3 tile-pulse">Wardrobe</span></div>
  if (setup.show) return <SetupView s={setup.s!} onDone={setup.finish} />

  return (
    <div className="flex h-full flex-col">
      <header className="grid h-16 shrink-0 grid-cols-[auto_1fr_auto] items-center gap-4 border-b border-line px-4 sm:grid-cols-[1fr_auto_1fr] lg:h-[72px] lg:px-8">
        <span className="hidden text-[1.5rem] leading-none tracking-[-0.02em] sm:block">Wardrobe</span>
        {/* Alta-style text tabs: ink when active, grey otherwise, sliding underline */}
        <nav className="flex h-full gap-4 overflow-x-auto [scrollbar-width:none] sm:gap-8" aria-label="Sections">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setView(t.id)} aria-current={view === t.id ? 'page' : undefined} className={`relative h-full shrink-0 text-body transition-colors duration-200 ${view === t.id ? 'text-ink' : 'text-ink-3 hover:text-ink'}`}>
              {t.label}
              {t.id === 'compare' && w.compareIds.length > 0 && <motion.sup key={w.compareIds.length} initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="tabular ml-0.5 text-meta text-accent">{w.compareIds.length}</motion.sup>}
              {view === t.id && <motion.span layoutId="tab" className="absolute inset-x-0 -bottom-px h-[1.5px] bg-ink" transition={{ duration: 0.4, ease }} />}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-1 justify-self-end">
        <ThemeButton />
        <button onClick={() => setView('you')} className="flex items-center gap-2.5 rounded-full py-1 pl-3 pr-1 text-label hover:bg-panel" title={health.h?.message}>
          {(() => {
            const u = w.state!.usage?.[w.state!.settings.engine]
            return (
              <span className="flex items-center gap-2" title={u ? `${u.left} of ${u.usable} images left today · ${health.h?.ok ? 'Chrome connected' : 'Chrome not connected'}` : undefined}>
                <UsageRing u={u} dot={health.h === null ? 'var(--color-ink-3)' : health.h.ok ? 'var(--color-ok)' : 'var(--color-warn)'} />
                <span className="hidden sm:inline">{w.state!.engines.find((e) => e.id === w.state!.settings.engine)?.label}</span>
                {u && <span className="tabular hidden text-ink-3 lg:inline">{u.left} left</span>}
              </span>
            )
          })()}
          {busy && <span className="tabular hidden text-ink-3 md:inline">· {q!.current!.type === 'cutout' ? 'cleaning up' : 'rendering'}{q!.cutouts ? `, ${q!.cutouts} waiting` : ''}</span>}
          {w.state.photo ? <img src={w.state.photo.url} alt="" className="size-9 rounded-full bg-panel object-cover object-top ring-1 ring-line" /> : <span className="size-9 rounded-full bg-panel" />}
        </button>
        </div>
      </header>

      <main className="relative min-h-0 flex-1">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={view} className="absolute inset-0 px-4 pb-4 pt-5 lg:px-8 lg:pb-8 lg:pt-8" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.12 } }} transition={{ duration: 0.35, ease }}>
            {view === 'tryon' && <TryOnView w={w} />}
            {view === 'looks' && <LooksView w={w} open={(ids, rid) => { w.openLook(ids, rid); setView('tryon') }} />}
            {view === 'compare' && <CompareView w={w} onBack={() => setView('looks')} onWear={(r) => { w.setActiveId(r.id); setView('tryon') }} />}
            {view === 'closet' && <ClosetView w={w} />}
            {view === 'stylist' && <StylistView w={w} />}
            {view === 'you' && <YouView w={w} health={health} />}
          </motion.div>
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {w.toast && (
          <motion.div role="status" initial={{ opacity: 0, y: 16, x: '-50%' }} animate={{ opacity: 1, y: 0, x: '-50%' }} exit={{ opacity: 0, y: 8, x: '-50%' }} transition={{ duration: 0.3, ease }} className="fixed bottom-8 left-1/2 flex h-11 items-center rounded-full bg-ink px-6 text-label text-paper shadow-lift">
            {w.toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
