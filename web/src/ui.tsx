import { motion, type HTMLMotionProps } from 'framer-motion'
import type { ReactNode } from 'react'

export const ease = [0.16, 1, 0.3, 1] as const

/** Alta-style filter pill: grey at rest, ink when active. */
export function Chip({ active, children, onClick, count }: { active?: boolean; children: ReactNode; onClick?: () => void; count?: number }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`relative h-9 shrink-0 rounded-full px-4 text-label transition-colors duration-200 ${active ? 'text-paper' : 'bg-panel text-ink hover:bg-panel-2'}`}
    >
      {active && <motion.span layoutId="chip-active" className="absolute inset-0 rounded-full bg-ink" transition={{ duration: 0.35, ease }} />}
      <span className="relative flex items-center gap-1.5">
        {children}
        {count !== undefined && <span className={`tabular text-meta ${active ? 'text-paper/60' : 'text-ink-3'}`}>{count}</span>}
      </span>
    </button>
  )
}

/** Which model made an image. */
export function ProviderTag({ provider, model, className = '' }: { provider?: string; model?: string; className?: string }) {
  if (!provider) return null
  return (
    <span title={model} className={`inline-flex h-6 items-center gap-1.5 rounded-full bg-card/95 pl-2 pr-2.5 text-meta text-ink shadow-float ${className}`}>
      <span className="size-1.5 rounded-full bg-accent" />
      {provider}
    </span>
  )
}

/** Doji buttons: black pill primary, white pill with hairline + float shadow secondary. */
export function Button({ variant = 'ghost', size = 'md', className = '', children, ...rest }: HTMLMotionProps<'button'> & { variant?: 'primary' | 'ghost' | 'quiet'; size?: 'sm' | 'md' | 'lg' }) {
  const styles = {
    primary: 'bg-ink text-paper hover:bg-ink/85 disabled:bg-panel disabled:text-ink-3',
    ghost: 'bg-card text-ink shadow-float ring-1 ring-line hover:ring-line-strong disabled:text-ink-3 disabled:shadow-none',
    quiet: 'text-ink-2 hover:text-ink hover:bg-panel disabled:text-ink-3',
  }[variant]
  const sizes = { sm: 'h-9 px-4 text-label gap-1.5', md: 'h-11 px-5 text-body gap-2', lg: 'h-12 px-7 text-[1rem] gap-2' }[size]
  return (
    <motion.button whileTap={{ scale: 0.97 }} className={`inline-flex shrink-0 items-center justify-center rounded-full transition-[background-color,box-shadow,color] duration-150 disabled:cursor-not-allowed ${sizes} ${styles} ${className}`} {...rest}>
      {children as ReactNode}
    </motion.button>
  )
}
