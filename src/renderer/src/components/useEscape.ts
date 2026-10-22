import { useEffect, useRef } from 'react'

// Escape closes the topmost open modal. A keydown handler on the backdrop only
// fires when focus is inside the modal, and most modals open from a button that
// stays focused outside it — so listen on the document instead. Modals register
// in the order they open; only the most recent one handles Escape (e.g. a
// ConfirmModal over Settings, or a listing opened from the scan history).

type Entry = { current: () => void }
const stack: Entry[] = []

function onKeyDown(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || e.defaultPrevented) return
  const top = stack[stack.length - 1]
  if (!top) return
  e.preventDefault()
  top.current()
}

export function useEscape(onEscape: () => void, active = true): void {
  const ref = useRef(onEscape)
  ref.current = onEscape
  useEffect(() => {
    if (!active) return
    const entry: Entry = ref
    if (stack.length === 0) document.addEventListener('keydown', onKeyDown)
    stack.push(entry)
    return () => {
      const i = stack.lastIndexOf(entry)
      if (i >= 0) stack.splice(i, 1)
      if (stack.length === 0) document.removeEventListener('keydown', onKeyDown)
    }
  }, [active])
}
