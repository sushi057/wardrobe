import { motion } from 'framer-motion'
import { Check } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, type Setup } from './api'
import { Button, ease } from './ui'

const STORE_URL = 'https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk'
const GEMINI_URL = 'https://gemini.google.com/app'
const DONE_KEY = 'wardrobe-setup-done'

const wasDone = () => { try { return localStorage.getItem(DONE_KEY) === '1' } catch { return false } }
const markDone = () => { try { localStorage.setItem(DONE_KEY, '1') } catch { /* private mode */ } }

/** Runs the first-run checks in the background. `show` is true only when something still needs doing. */
export function useSetup() {
  const [s, setS] = useState<Setup | null>(null)
  const [dismissed, setDismissed] = useState(wasDone)
  useEffect(() => {
    if (dismissed) return
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const tick = () => api.setup()
      // Once ready, stop polling for good: a slow check mid-render must never swap the app for this screen.
      .then((r) => { if (!alive) return; setS(r); if (r.ready) { markDone(); setDismissed(true) } })
      .catch(() => { /* server restarting; try again */ })
      .finally(() => { if (alive) timer = setTimeout(tick, 3000) })
    tick()
    return () => { alive = false; clearTimeout(timer) }
  }, [dismissed])
  const finish = () => { markDone(); setDismissed(true) }
  // `pending`: first check still running on a copy that has never finished setup (avoids a flash of the app).
  return { s, pending: !dismissed && !s, show: !dismissed && !!s && !s.ready, ready: !!s?.ready, finish }
}

function Step({ n, done, active, title, children }: { n: number; done: boolean; active: boolean; title: string; children: React.ReactNode }) {
  return (
    <li className={`flex gap-4 rounded-2xl p-5 transition-colors ${active ? 'bg-card shadow-float ring-1 ring-line' : ''}`}>
      <span className={`grid size-8 shrink-0 place-items-center rounded-full text-label ${done ? 'bg-ok text-paper' : active ? 'bg-ink text-paper' : 'bg-panel text-ink-3'}`}>
        {done ? <Check size={16} strokeWidth={2.25} aria-label="Done" /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <h2 className={`text-body ${done || active ? 'text-ink' : 'text-ink-3'}`}>{title}</h2>
        {active && <div className="mt-2 text-meta text-ink-2">{children}</div>}
      </div>
    </li>
  )
}

export function SetupView({ s, onDone }: { s: Setup; onDone: () => void }) {
  const ext = s.extension
  const gem = s.gemini
  return (
    <div className="grid h-full place-items-center overflow-y-auto px-4 py-10">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease }} className="w-full max-w-[520px]">
        <p className="text-caps uppercase text-ink-3">Welcome</p>
        <h1 className="mt-2 text-display">Wardrobe</h1>
        <p className="mt-3 text-body text-ink-2">Two quick steps in Google Chrome, then you can start trying things on. Wardrobe makes images with your own Gemini account.</p>

        <ol className="mt-8 flex flex-col gap-2" aria-live="polite">
          <Step n={1} done={ext} active={!ext} title="Add OpenCLI to Chrome">
            <p>OpenCLI is the free extension that lets Wardrobe use Gemini in your Chrome. Click <span className="text-ink">Add to Chrome</span> on the page that opens. This step ticks itself off a few seconds later.</p>
            <Button variant="primary" size="sm" className="mt-4" onClick={() => window.open(STORE_URL, '_blank', 'noopener')}>Open the Chrome Web Store</Button>
          </Step>
          <Step n={2} done={gem} active={ext && !gem} title="Sign in to Gemini">
            <p>Sign in with the Google account you want to use for images, then come back here.</p>
            <Button variant="primary" size="sm" className="mt-4" onClick={() => window.open(GEMINI_URL, '_blank', 'noopener')}>Open Gemini</Button>
          </Step>
        </ol>

        {s.problem && <p role="alert" className="mt-5 rounded-2xl bg-panel p-4 text-meta text-ink">{s.problem}</p>}

        <div className="mt-8 flex items-center gap-3">
          <span className="tile-pulse size-2 rounded-full bg-ink-3" aria-hidden />
          <span className="text-meta text-ink-3">Checking every few seconds…</span>
          <Button variant="quiet" size="sm" className="ml-auto" onClick={onDone}>Skip for now</Button>
        </div>

        <p className="mt-10 border-t border-line pt-5 text-meta text-ink-3">
          Stuck? <ReportButton variant="link" /> and send the file to whoever shared Wardrobe with you.
        </p>
      </motion.div>
    </div>
  )
}

/** Downloads /api/report (a text file with settings and error logs, never photos). */
export function ReportButton({ variant = 'button' }: { variant?: 'button' | 'link' }) {
  const [busy, setBusy] = useState(false)
  const save = () => {
    setBusy(true)
    const a = document.createElement('a')
    a.href = '/api/report'
    a.download = ''
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => setBusy(false), 4000) // the report takes a few seconds to gather
  }
  if (variant === 'link') {
    return <button onClick={save} disabled={busy} className="text-ink underline underline-offset-2 hover:text-ink-2 disabled:text-ink-3">{busy ? 'Saving a report…' : 'Save a report'}</button>
  }
  return <Button size="sm" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save a report'}</Button>
}
