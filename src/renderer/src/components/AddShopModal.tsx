import { useState } from 'react'
import { parseShopInput } from '@shared/shopUrl'
import { useStore } from '../store'
import { useEscape } from './useEscape'

export function AddShopModal(): JSX.Element | null {
  const { showAddShop, setShowAddShop, addShop } = useStore()
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const close = (): void => {
    setInput('')
    setError(null)
    setShowAddShop(false)
  }
  useEscape(close, showAddShop)
  if (!showAddShop) return null

  const submit = async (): Promise<void> => {
    const parsed = parseShopInput(input)
    if (!parsed.ok) {
      setError(parsed.error)
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
    <div className="modal-backdrop" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 520 }}>
        <h2>Додати магазин</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <div className="field">
            <label htmlFor="shop-input">Посилання на магазин Etsy або його назва</label>
            <div className="row">
              <input
                id="shop-input"
                autoFocus
                placeholder="https://www.etsy.com/shop/НазваМагазину"
                value={input}
                onChange={(e) => {
                  setInput(e.target.value)
                  setError(null)
                }}
              />
            </div>
            {error ? (
              <div className="hint err" role="alert">
                {error}
              </div>
            ) : (
              <div className="hint">
                Підходить посилання з адресного рядка сторінки магазину, напр.
                etsy.com/uk/shop/Name?ref=… — або просто назва.
              </div>
            )}
          </div>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={close}>
              Скасувати
            </button>
            <button type="submit" className="btn primary" disabled={busy || !input.trim()}>
              {busy ? 'Шукаю…' : 'Додати'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
