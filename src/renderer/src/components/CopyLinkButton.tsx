import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { etsyListingUrl } from '@shared/myShop'
import { Button, Icon } from '../ui'

// "Копіювати посилання": copies a listing's clean public link
// (https://www.etsy.com/listing/<id>) so the user can paste it to Claude, which
// finds the product over MCP. Two looks share one behaviour (`useCopyFeedback`):
// a round icon over a listing card (a sibling of the card button, like the
// photo magnifier) and a regular button in the listing window.

export type CopyState = 'idle' | 'copied' | 'failed'

/** How long "Скопійовано" / "Не вдалося скопіювати" stays before the button is back. */
export const COPY_FEEDBACK_MS = 2000

export const COPY_LINK_LABEL = 'Копіювати посилання'
export const COPY_DONE = 'Скопійовано'
export const COPY_FAILED = 'Не вдалося скопіювати'
export const COPY_LINK_HINT = 'Посилання на цей товар — вставте його Claude, і він знайде товар через MCP'

/** Copy `text` through main's clipboard; the state says how it went for COPY_FEEDBACK_MS. */
export function useCopyFeedback(): [CopyState, (text: string) => Promise<void>] {
  const [state, setState] = useState<CopyState>('idle')
  const timer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(timer.current), [])
  const copy = async (text: string): Promise<void> => {
    const ok = await window.api.copyText(text).catch(() => false)
    setState(ok ? 'copied' : 'failed')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), COPY_FEEDBACK_MS)
  }
  return [state, copy]
}

const feedbackText = (s: CopyState): string | null => (s === 'copied' ? COPY_DONE : s === 'failed' ? COPY_FAILED : null)

// Enter/Space on the icon must not reach the card button around it in the DOM order.
function stopActivationKeys(e: KeyboardEvent): void {
  if (e.key === 'Enter' || e.key === ' ') e.stopPropagation()
}

/**
 * The card's round "copy link" icon. Render it as a sibling of the card button
 * inside `.listing-card-host` (a button can't hold another one); it is placed
 * over the photo's right edge under the magnifier (`solo` = no magnifier, so
 * it takes the corner). Feedback: a check / warning icon and a small bubble.
 */
export function CardCopyLink({ listingId, title, solo }: { listingId: number; title: string; solo?: boolean }): JSX.Element {
  const [state, copy] = useCopyFeedback()
  const feedback = feedbackText(state)
  return (
    <span className={`card-copy${solo ? ' card-copy--solo' : ''}${state !== 'idle' ? ' is-flash' : ''}`} data-state={state}>
      <button
        type="button"
        className={`card-copy-btn${state === 'copied' ? ' copied' : state === 'failed' ? ' copy-failed' : ''}`}
        aria-label={`${COPY_LINK_LABEL} на товар: ${title}`}
        title={feedback ?? `${COPY_LINK_LABEL} — ${COPY_LINK_HINT}`}
        data-testid="card-copy-link"
        onClick={(e: MouseEvent) => {
          e.stopPropagation()
          e.preventDefault()
          void copy(etsyListingUrl(listingId))
        }}
        onKeyDown={stopActivationKeys}
      >
        <Icon name={state === 'copied' ? 'check' : state === 'failed' ? 'warning' : 'link'} size={14} />
      </button>
      <span className={feedback ? 'card-copy-flash' : 'sr-only'} role="status">
        {feedback ?? ''}
      </span>
    </span>
  )
}

/** The listing window's "Копіювати посилання" button (text turns into the feedback for 2 s). */
export function CopyLinkButton({ listingId }: { listingId: number }): JSX.Element {
  const [state, copy] = useCopyFeedback()
  return (
    <Button
      icon={state === 'copied' ? 'check' : state === 'failed' ? 'warning' : 'link'}
      className={state === 'copied' ? 'copied' : state === 'failed' ? 'copy-failed' : undefined}
      tooltip={COPY_LINK_HINT}
      data-testid="copy-listing-link"
      onClick={() => void copy(etsyListingUrl(listingId))}
    >
      {feedbackText(state) ?? COPY_LINK_LABEL}
    </Button>
  )
}
