import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react'
import type { GlossaryKey } from '@shared/glossary'
import { InfoTip } from './Tip'

// A form field: label (+ ⓘ), the control, a help line and an error. The control
// gets an id (its own or a generated one), aria-describedby (help + error),
// aria-invalid and required — either cloned onto a single element child or
// passed to a render function: <Field label="…">{(p) => <input {...p} />}</Field>.

export interface FieldControlProps {
  id: string
  'aria-describedby'?: string
  'aria-invalid'?: true
  required?: boolean
}

export interface FieldProps {
  label: ReactNode
  children: ReactElement | ((props: FieldControlProps) => ReactNode)
  /** Help text under the control (what to type, where to find it). */
  hint?: ReactNode
  /** An error message; the field turns red and the text is announced (role="alert"). */
  error?: ReactNode
  required?: boolean
  /** An ⓘ after the label from the glossary… */
  glossary?: GlossaryKey
  /** …or with this text. */
  info?: ReactNode
  /** The control's id (else the child's id, else a generated one). */
  id?: string
  /** Something at the right end of the label row (a counter "12/140", a link). */
  aside?: ReactNode
  className?: string
}

export function Field({ label, children, hint, error, required, glossary, info, id, aside, className }: FieldProps): JSX.Element {
  const auto = useId()
  const childId = isValidElement(children) ? (children.props as { id?: string }).id : undefined
  const controlId = id ?? childId ?? `${auto}-c`
  const hintId = hint ? `${auto}-h` : undefined
  const errId = error ? `${auto}-e` : undefined
  const ownDescribed = isValidElement(children) ? (children.props as { 'aria-describedby'?: string })['aria-describedby'] : undefined
  const describedBy = [ownDescribed, hintId, errId].filter(Boolean).join(' ') || undefined
  const props: FieldControlProps = {
    id: controlId,
    'aria-describedby': describedBy,
    ...(error ? { 'aria-invalid': true as const } : {}),
    ...(required ? { required: true } : {})
  }
  const control = typeof children === 'function' ? children(props) : cloneElement(children, props as unknown as Record<string, unknown>)
  return (
    <div className={'ui-field' + (error ? ' has-error' : '') + (className ? ' ' + className : '')}>
      <div className="ui-field-head">
        <label htmlFor={controlId} className="ui-field-label">
          {label}
        </label>
        {required && (
          <span className="ui-field-req" aria-hidden="true" title="Обов’язкове поле">
            *
          </span>
        )}
        {(glossary || info) && <InfoTip glossary={glossary} text={info} />}
        {aside && <span className="ui-field-aside">{aside}</span>}
      </div>
      {control}
      {hint && (
        <div className="ui-field-hint" id={hintId}>
          {hint}
        </div>
      )}
      {error && (
        <div className="ui-field-error" id={errId} role="alert">
          {error}
        </div>
      )}
    </div>
  )
}
