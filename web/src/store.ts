import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type Item, type Job, type Render, type State } from './api'

export const setKey = (ids: string[]) => [...ids].sort().join('+')

export interface RenderError { baseId: string | null; code: string; message: string }

/** Applies the slot rules: one item per slot, dress replaces top+bottom, accessories stack. */
export function toggleInOutfit(selected: string[], item: Item, items: Item[]): string[] {
  if (selected.includes(item.id)) return selected.filter((x) => x !== item.id)
  const byId = new Map(items.map((i) => [i.id, i]))
  const clash = (other: Item) => {
    if (item.category === 'accessory') return false
    if (other.category === item.category) return true
    if (item.category === 'dress') return other.category === 'top' || other.category === 'bottom'
    if (item.category === 'top' || item.category === 'bottom') return other.category === 'dress'
    return false
  }
  return [...selected.filter((id) => { const o = byId.get(id); return o && !clash(o) }), item.id]
}

export function useWardrobe() {
  const [state, setState] = useState<State | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  /** The version on stage and the base for the next try-on (null = original photo). */
  const [activeId, setActiveIdRaw] = useState<string | null>(null)
  const activeRef = useRef(activeId)
  activeRef.current = activeId
  const [revealId, setRevealId] = useState<string | null>(null)
  const [error, setError] = useState<RenderError | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const photoRef = useRef<string | undefined>(undefined)
  const selectedRef = useRef(selected)
  selectedRef.current = selected

  const refresh = useCallback(() => api.state().then(setState), [])

  // Compare set (render ids, max 8), kept per browser across reloads.
  const [compareIds, setCompareIds] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('wardrobe-compare') || '[]') } catch { return [] }
  })
  useEffect(() => { try { localStorage.setItem('wardrobe-compare', JSON.stringify(compareIds)) } catch { /* private mode */ } }, [compareIds])
  /** Returns 'added' | 'removed' | 'full'. */
  const toggleCompare = useCallback((renderId: string): 'added' | 'removed' | 'full' => {
    if (compareIds.includes(renderId)) { setCompareIds(compareIds.filter((x) => x !== renderId)); return 'removed' }
    if (compareIds.length >= 8) return 'full'
    setCompareIds([...compareIds, renderId]); return 'added'
  }, [compareIds])

  useEffect(() => {
    refresh()
    const es = new EventSource('/api/events')
    es.onopen = () => { refresh() } // resync after (re)connect: events sent while away are lost
    es.onmessage = (ev) => {
      const e = JSON.parse(ev.data)
      if (e.type === 'queue') {
        setState((s) => s && { ...s, queue: { current: e.current, pending: e.pending, cutouts: e.cutouts } })
      } else if (e.type === 'usage') {
        setState((s) => s && { ...s, usage: { ...s.usage, [e.usage.engine]: e.usage } })
      } else if (e.type === 'stylist') {
        refresh()
      } else if (e.type === 'item') {
        setState((s) => s && { ...s, items: s.items.map((i) => (i.id === e.item.id ? e.item : i)) })
      } else if (e.type === 'render') {
        const r: Render = e.render
        setState((s) => s && { ...s, renders: [...s.renders, r] })
        if (r.photoId !== photoRef.current) {
          setToast('A try-on finished on one of your other photos')
        } else if (r.baseId === activeRef.current) {
          // Still on the version it was made from: move forward to the new one.
          setActiveIdRaw(r.id)
          setSelected([])
          setRevealId(r.id)
          setError(null)
        } else {
          setToast('A new version is ready in the strip below')
        }
      } else if (e.type === 'jobError') {
        const j: Job = e.job
        if (j.type === 'render') setError({ baseId: j.baseId ?? null, code: j.error?.code ?? 'unknown', message: j.error?.message ?? '' })
        else setToast('A cutout failed. Open Closet to retry it.')
      }
    }
    return () => es.close()
  }, [refresh])

  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 3800); return () => clearTimeout(t) } }, [toast])

  const items = state?.items ?? []
  const photoId = state?.photo?.id
  photoRef.current = photoId

  // Every version on the current photo, oldest first (the original photo sits before them).
  const versions = useMemo(
    () => (state?.renders ?? []).filter((r) => r.photoId === photoId).sort((a, b) => a.createdAt - b.createdAt),
    [state?.renders, photoId],
  )
  const shownRender = versions.find((r) => r.id === activeId) ?? null
  const baseOf = (r: Render | null) => (r?.baseId ? versions.find((v) => v.id === r.baseId) ?? null : null)

  const q = state?.queue
  const renderJobs = [q?.current, q?.pending].filter((j): j is Job => j?.type === 'render')
  const renderingThis = renderJobs.some((j) => (j.baseId ?? null) === (shownRender?.id ?? null))
  const renderJob = q?.current?.type === 'render' ? q.current : null

  /** Put a version on stage; the next try-on edits it. */
  const setActiveId = useCallback((rid: string | null) => {
    setActiveIdRaw(rid)
    setSelected([])
    setError(null)
  }, [])

  /** Make another of your photos the one in use; each keeps its own versions. */
  const switchPhoto = useCallback(async (pid: string) => {
    const next = await api.selectPhoto(pid)
    setState((s) => (s ? { ...s, ...next } : next))
    setActiveIdRaw(null); setSelected([]); setError(null)
  }, [])
  const removePhoto = useCallback(async (pid: string) => {
    const next = await api.deletePhoto(pid)
    setState((s) => (s ? { ...s, ...next } : next))
    setActiveIdRaw(null); setSelected([]); setError(null)
  }, [])

  const toggle = useCallback((item: Item) => {
    setSelected((sel) => toggleInOutfit(sel, item, items))
    setError(null)
  }, [items])

  const send = useCallback(async (ids: string[], baseId: string | null, force: boolean) => {
    setError(null)
    try {
      const res = await api.render(ids, force, baseId)
      if (res.cached && res.render) { setActiveIdRaw(res.render.id); setSelected([]); setRevealId(res.render.id) }
    } catch (e) {
      const msg = (e as Error).message
      setError({ baseId, code: /used today|frees up/.test(msg) ? 'limit' : 'unknown', message: msg })
    }
  }, [])

  /** Put the picked pieces on the version on stage. */
  const tryOn = useCallback(() => { if (selected.length) send(selected, activeId, false) }, [selected, activeId, send])

  /** Make another take of the version on stage, from the same base. */
  const regenerate = useCallback(() => {
    const r = shownRender
    if (!r) return
    setActiveIdRaw(r.baseId)
    setSelected(r.addedIds)
    send(r.addedIds, r.baseId, true)
  }, [shownRender, send])

  /** Open a saved look: its render if it still exists, otherwise its pieces ready to try on the original. */
  const openLook = useCallback((ids: string[], rid: string | null) => {
    if (rid && state?.renders.some((r) => r.id === rid)) setActiveId(rid)
    else { setActiveIdRaw(null); setSelected(ids); setError(null) }
  }, [state?.renders, setActiveId])

  const liveCompare = compareIds.filter((id) => (id === 'original' ? !!state?.photo : state?.renders.some((r) => r.id === id)))

  return {
    compareIds: liveCompare, setCompareIds, toggleCompare,
    state, setState, refresh, items, selected, setSelected, toggle, tryOn,
    switchPhoto, removePhoto, versions, shownRender, baseOf, activeId, setActiveId, regenerate, openLook, renderJobs, revealId, setRevealId,
    renderingThis, renderJob, error: error && error.baseId === (shownRender?.id ?? null) ? error : null,
    toast, setToast,
  }
}
export type Wardrobe = ReturnType<typeof useWardrobe>
