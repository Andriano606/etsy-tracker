import { useStore } from '../store'
import { KeyHelp } from './KeyHelp'

export function NoKeyState(): JSX.Element {
  const setShowSettings = useStore((s) => s.setShowSettings)
  return (
    <div className="empty-state" data-testid="no-key">
      <h2>Почнімо з API-ключа Etsy</h2>
      <p>
        Програма читає товари магазинів через офіційний Etsy API. Для цього потрібен ваш власний
        ключ — він зберігається лише на цьому комп’ютері.
      </p>
      <KeyHelp />
      <button className="btn primary" onClick={() => setShowSettings(true)}>
        Відкрити налаштування
      </button>
    </div>
  )
}

export function NoShopsState(): JSX.Element {
  const setShowAddShop = useStore((s) => s.setShowAddShop)
  return (
    <div className="empty-state" data-testid="no-shops">
      <h2>Додайте перший магазин</h2>
      <p>
        Вставте посилання на магазин Etsy (наприклад, https://www.etsy.com/shop/НазваМагазину).
        Перше сканування запам’ятає всі товари, а кожне наступне покаже, що з’явилося нового.
      </p>
      <button className="btn primary" onClick={() => setShowAddShop(true)}>
        + Додати магазин
      </button>
    </div>
  )
}
