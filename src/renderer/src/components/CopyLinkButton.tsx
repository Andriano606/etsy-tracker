import type { KeyboardEvent, MouseEvent } from 'react'
import { etsyListingUrl } from '@shared/myShop'
import { Button, Icon } from '../ui'
import {
  COPY_DONE,
  COPY_FAILED,
  COPY_FEEDBACK_MS,
  COPY_FOR_CLAUDE,
  COPY_FOR_CLAUDE_HINT,
  copyFeedbackText as feedbackText,
  useCopyFeedback,
  type CopyState
} from '../ui/useCopyFeedback'

export { COPY_DONE, COPY_FAILED, COPY_FEEDBACK_MS, COPY_FOR_CLAUDE, COPY_FOR_CLAUDE_HINT, useCopyFeedback, type CopyState }

export const COPY_LINK_LABEL = 'Копіювати посилання'
export const COPY_LINK_HINT = 'Посилання на цей товар — вставте його Claude, і він знайде товар через MCP'

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

/**
 * A round "Копіювати для Claude" icon over a picture (the listing window's main
 * photo): copies `text` — the picture's etsy-tracker:// reference — so the user
 * can paste it to Claude, which opens exactly this picture over MCP. Same look
 * and feedback as the card's copy-link icon. A sibling of the picture's button.
 * `what` names the picture for screen readers ("фото 2 з 5"). The feedback
 * resets when `text` changes (another photo shown) — the button stays mounted,
 * so it keeps keyboard focus while ←/→ switch the photo.
 */
export function CopyForClaudeIcon({ text, what, className = '' }: { text: string; what?: string; className?: string }): JSX.Element {
  const [state, copy] = useCopyFeedback(text)
  const feedback = feedbackText(state)
  return (
    <span className={`card-copy claude-copy ${className}${state !== 'idle' ? ' is-flash' : ''}`} data-state={state}>
      <button
        type="button"
        className={`card-copy-btn${state === 'copied' ? ' copied' : state === 'failed' ? ' copy-failed' : ''}`}
        aria-label={what ? `${COPY_FOR_CLAUDE}: ${what}` : COPY_FOR_CLAUDE}
        title={feedback ?? `${COPY_FOR_CLAUDE} — ${COPY_FOR_CLAUDE_HINT}`}
        data-testid="copy-for-claude"
        onClick={(e: MouseEvent) => {
          e.stopPropagation()
          e.preventDefault()
          void copy(text)
        }}
        onKeyDown={stopActivationKeys}
      >
        <Icon name={state === 'copied' ? 'check' : state === 'failed' ? 'warning' : 'copy'} size={14} />
      </button>
      <span className={feedback ? 'card-copy-flash' : 'sr-only'} role="status">
        {feedback ?? ''}
      </span>
    </span>
  )
}
