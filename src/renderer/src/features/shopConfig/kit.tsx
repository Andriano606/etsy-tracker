// Layout pieces the own-shop feature screens share (shopConfig and orders):
// a tab intro, cards, numbered form steps, choice cards (radio with a
// description), a table that turns into cards when its container is narrow,
// fact lists and the result notes. Styles: ../shopConfig.css ("fx-" classes).

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Callout, Icon, InfoTip, type GlossaryKey, type IconName } from '../../ui'

/** The heading of a tab: what this screen is for, in one or two sentences, and its main action. */
export function Intro({
  title,
  glossary,
  icon,
  children,
  action
}: {
  title: ReactNode
  glossary?: GlossaryKey
  icon?: IconName
  children?: ReactNode
  action?: ReactNode
}): JSX.Element {
  return (
    <header className="fx-intro">
      <div className="fx-intro-text">
        <h3 className="fx-intro-title">
          {icon && <Icon name={icon} size={18} />}
          <span>{title}</span>
          {glossary && <InfoTip glossary={glossary} />}
        </h3>
        {children && <p className="fx-intro-desc">{children}</p>}
      </div>
      {action && <div className="fx-intro-action">{action}</div>}
    </header>
  )
}

/** A bordered block with a title (+ ⓘ), an optional description, the content and a footer of buttons. */
export function Card({
  title,
  glossary,
  info,
  desc,
  children,
  footer,
  testId,
  className,
  tone,
  headingLevel = 4,
  reveal
}: {
  title?: ReactNode
  glossary?: GlossaryKey
  info?: ReactNode
  desc?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  testId?: string
  className?: string
  tone?: 'form' | 'danger'
  headingLevel?: 3 | 4
  /** A form that just opened: scroll it into view and focus its first field. */
  reveal?: boolean
}): JSX.Element {
  const H = headingLevel === 3 ? 'h3' : 'h4'
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!reveal || !ref.current) return
    ref.current.querySelector<HTMLElement>('input:not([type=hidden]), select, textarea')?.focus({ preventScroll: true })
    ref.current.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
    // Only when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <section ref={ref} className={'fx-card' + (tone ? ` fx-card--${tone}` : '') + (className ? ' ' + className : '')} data-testid={testId}>
      {title && (
        <H className="fx-card-title">
          <span className="min-w-0">{title}</span>
          {(glossary || info) && <InfoTip glossary={glossary} text={info} />}
        </H>
      )}
      {desc && <p className="fx-card-desc">{desc}</p>}
      {children}
      {footer && <div className="fx-card-foot">{footer}</div>}
    </section>
  )
}

/** One numbered step of a longer form (a fieldset named by its title, so a screen reader hears it). */
export function Step({
  n,
  title,
  glossary,
  desc,
  children
}: {
  n: number
  title: ReactNode
  glossary?: GlossaryKey
  desc?: ReactNode
  children: ReactNode
}): JSX.Element {
  const id = useId()
  return (
    <fieldset className="fx-step" aria-labelledby={`${id}-t`}>
      <div className="fx-step-head">
        <span className="fx-step-n" aria-hidden="true">
          {n}
        </span>
        <span className="fx-step-title" id={`${id}-t`}>
          {title}
        </span>
        {glossary && <InfoTip glossary={glossary} />}
      </div>
      {desc && <p className="fx-step-desc">{desc}</p>}
      <div className="fx-step-body">{children}</div>
    </fieldset>
  )
}

export interface Choice<T extends string> {
  value: T
  label: string
  desc?: ReactNode
  icon?: IconName
}

/** A radio group drawn as cards, each with a line explaining the choice (for 2–3 options that need words). */
export function ChoiceCards<T extends string>({
  label,
  value,
  onChange,
  options
}: {
  label: string
  value: T
  onChange: (v: T) => void
  options: ReadonlyArray<Choice<T>>
}): JSX.Element {
  const name = useId()
  return (
    <div className="fx-choices" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <label key={o.value} className={'fx-choice' + (o.value === value ? ' is-on' : '')}>
          <input type="radio" name={name} value={o.value} checked={o.value === value} onChange={() => onChange(o.value)} />
          <span className="fx-choice-text">
            <span className="fx-choice-label">
              {o.icon && <Icon name={o.icon} size={15} />}
              {o.label}
            </span>
            {o.desc && <span className="fx-choice-desc">{o.desc}</span>}
          </span>
        </label>
      ))}
    </div>
  )
}

export interface Column {
  label: string
  glossary?: GlossaryKey
  info?: ReactNode
  align?: 'end'
  /** Read by screen readers only (an actions column). */
  srOnly?: boolean
}

const STACK_BELOW = { sm: 480, md: 640, lg: 760 } as const

/** true while the element is narrower than `px` (ResizeObserver; never in jsdom, which has no layout). */
function useNarrow(px: number): [React.RefObject<HTMLDivElement>, boolean] {
  const ref = useRef<HTMLDivElement>(null)
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const check = (): void => {
      const w = el.getBoundingClientRect().width
      if (w > 0) setNarrow(w < px)
    }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [px])
  return [ref, narrow]
}

/**
 * A table that becomes a list of cards when its own width drops below the
 * `stack` breakpoint (sm 480 / md 640 / lg 760 px — measured, so it follows
 * the pane, not the window). Every <Td> carries its column's name as `label`,
 * shown before the value in the card form.
 */
export function DataTable({
  label,
  columns,
  children,
  testId,
  stack = 'md',
  className
}: {
  label: string
  columns: ReadonlyArray<Column>
  children: ReactNode
  testId?: string
  stack?: keyof typeof STACK_BELOW
  className?: string
}): JSX.Element {
  const [ref, narrow] = useNarrow(STACK_BELOW[stack])
  return (
    <div ref={ref} className={'fx-table-wrap' + (className ? ' ' + className : '')}>
      <table className={'fx-table' + (narrow ? ' is-stacked' : '')} aria-label={label} data-testid={testId}>
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={i} scope="col" className={c.align === 'end' ? 'fx-td-end' : undefined}>
                {c.srOnly ? (
                  <span className="sr-only">{c.label}</span>
                ) : (
                  <span className="fx-th">
                    {c.label}
                    {(c.glossary || c.info) && <InfoTip glossary={c.glossary} text={c.info} size={13} />}
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

/** A table cell. `primary` = the row's title (the card's heading when stacked); `actions` = the buttons cell. */
export function Td({
  label,
  children,
  primary,
  actions,
  align,
  className,
  colSpan
}: {
  label: string
  children?: ReactNode
  primary?: boolean
  actions?: boolean
  align?: 'end'
  className?: string
  colSpan?: number
}): JSX.Element {
  const cls = [primary ? 'fx-td-primary' : '', actions ? 'fx-td-actions' : '', align === 'end' ? 'fx-td-end' : '', className ?? '']
    .filter(Boolean)
    .join(' ')
  return (
    <td data-label={label} className={cls || undefined} colSpan={colSpan}>
      {actions ? <div className="fx-row-actions">{children}</div> : <div className="fx-td-v">{children}</div>}
    </td>
  )
}

export interface Fact {
  label: string
  glossary?: GlossaryKey
  info?: ReactNode
  value: ReactNode
  /** Emphasised (a total). */
  strong?: boolean
  testId?: string
}

/** Label → value pairs (a definition list) that wrap into one column when narrow. */
export function Facts({ items, testId, className }: { items: ReadonlyArray<Fact | false | null | undefined>; testId?: string; className?: string }): JSX.Element {
  return (
    <dl className={'fx-facts' + (className ? ' ' + className : '')} data-testid={testId}>
      {items
        .filter((f): f is Fact => !!f)
        .map((f) => (
          <div key={f.label} className={'fx-fact' + (f.strong ? ' is-strong' : '')} data-testid={f.testId}>
            <dt>
              <span className="fx-fact-label">{f.label}</span>
              {(f.glossary || f.info) && <InfoTip glossary={f.glossary} text={f.info} size={13} />}
            </dt>
            <dd>{f.value}</dd>
          </div>
        ))}
    </dl>
  )
}

/** The error of a load or a change (role="alert"). */
export function ErrorNote({ error, title }: { error: string | null; title?: string }): JSX.Element | null {
  if (!error) return null
  return (
    <Callout tone="error" compact title={title}>
      {error}
    </Callout>
  )
}

/** The result of a change: the error (alert) or the success note (status) — scrolled into view when it appears. */
export function Status({ error, note }: { error: string | null; note: string | null }): JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (error || note) ref.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [error, note])
  if (!error && !note) return null
  return (
    <div ref={ref} className="fx-status">
      {error ? (
        <ErrorNote error={error} />
      ) : (
        <Callout tone="success" compact>
          {note}
        </Callout>
      )}
    </div>
  )
}

/** A static explanation (role="note", so it never competes with result notes). */
export function Note({ children, tone = 'info', title, icon }: { children: ReactNode; tone?: 'info' | 'warn'; title?: ReactNode; icon?: IconName }): JSX.Element {
  return (
    <Callout tone={tone} role="note" compact title={title} icon={icon}>
      {children}
    </Callout>
  )
}
