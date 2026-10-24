import { useEffect, useId, useRef } from 'react'
import { useStore } from '../store'
import { Button, Icon, Modal } from '../ui'

// In-app confirmation dialog (a native confirm() leaves the window unfocused on Linux).
//
// Callers pass one message: "Question?\nWhat it means." (or "Question? What it
// means."). The question is shown large, the explanation under it; both are the
// dialog's accessible description. The focus always starts on "Скасувати", so a
// stray Enter never confirms anything. Tone, guessed from the message unless the
// request says `danger`:
// - danger (red): deleting, removing, signing out, data that will be deleted,
//   "не можна скасувати";
// - caution (amber): it costs money, replaces existing data, cuts off connected
//   clients or lets someone change the shop;
// - normal (green).
// A request may also carry `title`, `confirmLabel` and `danger` (see ConfirmView).

export interface ConfirmView {
  message: string
  /** The dialog heading (default "Підтвердження"). */
  title?: string
  /** The confirm button's text, a verb ("Видалити магазин"); default "Підтвердити". */
  confirmLabel?: string
  /** Force the red style on (true) or the plain one (false); default: guessed from the message. */
  danger?: boolean
}

/** The store's requestConfirm with options (kept for the areas that import it). */
export function confirmWith(opts: ConfirmView): Promise<boolean> {
  const { message, ...rest } = opts
  return useStore.getState().requestConfirm(message, rest)
}

export type ConfirmTone = 'danger' | 'caution' | 'normal'

/** Splits a message into the question and the explanation after it. */
export function splitConfirmMessage(message: string): { question: string; details: string } {
  const text = message.trim()
  const nl = text.indexOf('\n')
  if (nl > 0) return { question: text.slice(0, nl).trim(), details: text.slice(nl + 1).trim() }
  const m = text.match(/^(.+?\?)\s+(\S[\s\S]*)$/)
  if (m) return { question: m[1], details: m[2] }
  return { question: text, details: '' }
}

const DESTRUCTIVE =
  /^\s*(видалити|прибрати|вийти|скинути|очистити)(?!\p{L})|назавжди|не можна (буде )?(скасувати|відновити)|(буде|будуть) видален/iu
const CAUTION = /стягне|\$\s?\d|\d\s?\$|замін(ить|ять|ити)(?!\p{L})|перестануть працювати|змінювати ваш/iu

export function isDestructiveMessage(message: string): boolean {
  return DESTRUCTIVE.test(message)
}

export function confirmTone(message: string, danger?: boolean): ConfirmTone {
  if (danger === true) return 'danger'
  if (danger === false) return 'normal'
  if (DESTRUCTIVE.test(message)) return 'danger'
  if (CAUTION.test(message)) return 'caution'
  return 'normal'
}

export function ConfirmModal(): JSX.Element | null {
  const { confirmRequest, resolveConfirm } = useStore()
  const req = confirmRequest as ConfirmView | null
  const tone = req ? confirmTone(req.message, req.danger) : 'normal'
  const cancelRef = useRef<HTMLButtonElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const id = useId()
  const { question, details } = splitConfirmMessage(req?.message ?? '')

  useEffect(() => {
    if (!req) return
    // Focus "Скасувати" after the Modal noted who opened it (so closing returns the focus there).
    cancelRef.current?.focus()
    // The Modal describes the dialog only by its subtitle: point the description
    // at the question + explanation, so a screen reader reads what is asked.
    const dialog = textRef.current?.closest('[role="alertdialog"]')
    dialog?.setAttribute('aria-describedby', details ? `${id}-q ${id}-d` : `${id}-q`)
  }, [req, id, details])
  if (!req) return null

  const cancel = (): void => resolveConfirm(false)

  return (
    <Modal
      role="alertdialog"
      size="sm"
      title={req.title ?? 'Підтвердження'}
      onClose={cancel}
      // "modal": older callers' tests find the dialog through .closest('.modal').
      className={'modal confirm-modal' + (tone === 'normal' ? '' : ` is-${tone}`)}
      footer={
        <>
          <Button ref={cancelRef} onClick={cancel}>
            Скасувати
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger-solid' : tone === 'caution' ? 'secondary' : 'primary'}
            className={tone === 'caution' ? 'confirm-ok-caution' : undefined}
            icon={tone === 'normal' ? 'check' : 'warning'}
            onClick={() => resolveConfirm(true)}
          >
            {req.confirmLabel ?? 'Підтвердити'}
          </Button>
        </>
      }
    >
      <div className="confirm-body">
        <span className="confirm-icon" aria-hidden="true">
          <Icon name={tone === 'normal' ? 'help' : 'warning'} size={20} />
        </span>
        <div className="confirm-text" ref={textRef}>
          <p className="confirm-question" id={`${id}-q`}>
            {question}
          </p>
          {details && (
            <p className="confirm-details" id={`${id}-d`}>
              {details}
            </p>
          )}
        </div>
      </div>
    </Modal>
  )
}
