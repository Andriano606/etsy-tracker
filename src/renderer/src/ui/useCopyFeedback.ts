import { useEffect, useRef, useState } from 'react'

export type CopyState = 'idle' | 'copied' | 'failed'

/** How long "Скопійовано" / "Не вдалося скопіювати" stays before the button is back. */
export const COPY_FEEDBACK_MS = 2000

export const COPY_DONE = 'Скопійовано'
export const COPY_FAILED = 'Не вдалося скопіювати'

/** "Копіювати для Claude": a picture's etsy-tracker:// reference (shared/claudeRef.ts). */
export const COPY_FOR_CLAUDE = 'Копіювати для Claude'
export const COPY_FOR_CLAUDE_HINT = 'Вставте це Claude — він відкриє саме цю картинку через MCP'

/**
 * Copy `text` through main's clipboard; the state says how it went for
 * COPY_FEEDBACK_MS. `resetKey` = what the button copies now (a gallery's
 * current picture): when it changes the feedback goes back to idle — also a
 * copy still in flight for the previous one is dropped — while the button
 * itself stays mounted, so keyboard focus stays on it (never remount it per
 * picture with a React key).
 */
export function useCopyFeedback(resetKey?: unknown): [CopyState, (text: string) => Promise<void>] {
  const [state, setState] = useState<CopyState>('idle')
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const alive = useRef(true)
  const generation = useRef(0)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      clearTimeout(timer.current)
    }
  }, [])
  useEffect(() => {
    generation.current++
    clearTimeout(timer.current)
    setState('idle')
  }, [resetKey])
  const copy = async (text: string): Promise<void> => {
    const gen = generation.current
    const ok = await window.api.copyText(text).catch(() => false)
    if (!alive.current || gen !== generation.current) return
    setState(ok ? 'copied' : 'failed')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), COPY_FEEDBACK_MS)
  }
  return [state, copy]
}

/** The feedback text for a state, null while idle. */
export const copyFeedbackText = (s: CopyState): string | null => (s === 'copied' ? COPY_DONE : s === 'failed' ? COPY_FAILED : null)
