import { useId, useRef, type MouseEvent, type ReactNode } from 'react'
import type { GlossaryKey } from '@shared/glossary'
import { InfoTip } from './Tip'

// An iOS-style on/off switch. Under the hood a real <input type="checkbox"
// role="switch">, so getByLabelText(label) / toBeChecked() / keyboard Space all
// work; the track + knob are drawn by CSS. The whole row is clickable (label,
// hint, empty space); the label alone is the accessible name, the hint is its
// description.

export interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  /** Visible label (the accessible name). Without one, pass `ariaLabel`. */
  label?: ReactNode
  /** One line under the label explaining what switching does. */
  hint?: ReactNode
  /** An ⓘ after the label, from the glossary… */
  glossary?: GlossaryKey
  /** …or with this text. */
  info?: ReactNode
  disabled?: boolean
  id?: string
  ariaLabel?: string
  size?: 'sm' | 'md'
  /** Switch on the left of the text (default right, like iOS settings rows). */
  switchFirst?: boolean
  className?: string
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  glossary,
  info,
  disabled,
  id,
  ariaLabel,
  size = 'md',
  switchFirst,
  className
}: ToggleProps): JSX.Element {
  const auto = useId()
  const inputId = id ?? `${auto}-t`
  const hintId = hint ? `${auto}-h` : undefined
  const input = useRef<HTMLInputElement>(null)

  const onRow = (e: MouseEvent<HTMLDivElement>): void => {
    if (disabled) return
    const t = e.target as HTMLElement
    // Labels, the input and other controls handle their own clicks.
    if (t.closest('label, button, a, input, select, textarea, [tabindex]')) return
    input.current?.click()
  }

  const cls = ['ui-toggle', `ui-toggle--${size}`, label || hint ? '' : 'ui-toggle--bare', switchFirst ? 'ui-toggle--first' : '', disabled ? 'is-disabled' : '', className ?? '']
    .filter(Boolean)
    .join(' ')
  return (
    <div className={cls} onClick={onRow}>
      {(label || hint) && (
        <div className="ui-toggle-text">
          {label && (
            <div className="ui-toggle-head">
              <label htmlFor={inputId} className="ui-toggle-label">
                {label}
              </label>
              {(glossary || info) && <InfoTip glossary={glossary} text={info} />}
            </div>
          )}
          {hint && (
            <div className="ui-toggle-hint" id={hintId}>
              {hint}
            </div>
          )}
        </div>
      )}
      <label className="ui-switch">
        <input
          ref={input}
          id={inputId}
          type="checkbox"
          role="switch"
          className="ui-switch-input"
          checked={checked}
          disabled={disabled}
          aria-label={label ? undefined : ariaLabel}
          aria-describedby={hintId}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="ui-switch-track" aria-hidden="true">
          <span className="ui-switch-knob" />
        </span>
      </label>
    </div>
  )
}
