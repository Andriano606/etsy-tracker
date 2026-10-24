import { useEffect, useRef, useState } from 'react'
import { parseShopInput } from '@shared/shopUrl'
import { useStore } from '../store'
import { Button, Field, Icon, Modal, Term } from '../ui'

/** What the dialog lists as accepted — every entry must pass parseShopInput (tested). "ShopName" stands for the real name. */
export const EXAMPLES = ['https://www.etsy.com/shop/ShopName', 'etsy.com/uk/shop/ShopName?ref=…', 'ShopName.etsy.com', 'ShopName']

export function AddShopModal(): JSX.Element | null {
  const { showAddShop, setShowAddShop, addShop } = useStore()
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // Focus the field after the Modal noted who opened it (an autoFocus would run
  // first, and closing would then not give the focus back to the opener).
  useEffect(() => {
    if (showAddShop) inputRef.current?.focus()
  }, [showAddShop])
  const close = (): void => {
    setInput('')
    setError(null)
    setShowAddShop(false)
  }
  if (!showAddShop) return null

  // What the app recognised in the input, live — so a beginner sees the link was understood.
  const parsed = input.trim() ? parseShopInput(input) : null
  const recognised = parsed?.ok ? parsed.shopName : null

  const submit = async (): Promise<void> => {
    if (busy) return
    const p = parseShopInput(input)
    if (!p.ok) {
      setError(p.error)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await addShop(input)
      if (res.ok) {
        setInput('')
      } else {
        setError(res.error ?? 'Не вдалося додати магазин.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Додати магазин"
      subtitle="Програма стежитиме за всіма товарами цього магазину"
      size="md"
      className="add-shop-modal"
      onClose={close}
      footer={
        <>
          <Button onClick={close}>Скасувати</Button>
          <Button variant="primary" icon="plus" busy={busy} disabled={!input.trim()} onClick={() => void submit()}>
            {busy ? 'Шукаю магазин…' : 'Додати магазин'}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <Field
          label="Посилання на магазин Etsy або його назва"
          glossary="shell.shopLink"
          error={error}
          hint={
            error ? undefined : recognised ? (
              <span className="add-shop-recognised">
                <Icon name="check" size={13} />
                <span>
                  <Term glossary="shell.shopName">Назва магазину</Term> з посилання: <b>{recognised}</b>. Перевіримо її на
                  Etsy, коли натиснете «Додати магазин».
                </span>
              </span>
            ) : (
              'Відкрийте магазин на сайті Etsy і скопіюйте адресу з адресного рядка браузера.'
            )
          }
        >
          <input
            id="shop-input"
            ref={inputRef}
            autoComplete="off"
            spellCheck={false}
            placeholder="https://www.etsy.com/shop/ShopName"
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              setError(null)
            }}
          />
        </Field>
      </form>

      <div className="add-shop-help">
        <div className="add-shop-help-title">Що можна вставити</div>
        <p className="add-shop-help-note">
          Замість <code>ShopName</code> — справжня назва магазину: латинськими літерами й цифрами, як у посиланні.
        </p>
        <ul className="add-shop-examples">
          {EXAMPLES.map((x) => (
            <li key={x}>
              <Icon name="check" size={13} className="is-ok" />
              <code>{x}</code>
            </li>
          ))}
          <li className="is-bad">
            <Icon name="close" size={13} />
            <span>
              Не підходить посилання на окремий товар: <code>etsy.com/listing/…</code>
              <span className="add-shop-bad-help">Відкрийте сам магазин — натисніть на назву продавця на сторінці товару.</span>
            </span>
          </li>
        </ul>
      </div>
      <p className="add-shop-next">
        <Icon name="info" size={14} />
        <span>Після додавання натисніть «Сканувати» — програма завантажить усі товари магазину.</span>
      </p>
    </Modal>
  )
}
