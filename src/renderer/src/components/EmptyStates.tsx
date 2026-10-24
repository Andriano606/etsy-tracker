import type { ReactNode } from 'react'
import { useStore } from '../store'
import { Button, Icon, Term, type IconName } from '../ui'
import { KeyHelp } from './KeyHelp'

// The first-run screens of the main area: no API key yet (a step-by-step "how
// to start" for someone who never used Etsy's developer pages) and a key but no
// shops (what to paste, and what the app will show afterwards).

function Step({
  n,
  title,
  state,
  children
}: {
  n: number
  title: ReactNode
  /** current = the step to do now; todo = still ahead; later = needs the earlier steps first. */
  state: 'current' | 'todo' | 'later'
  children: ReactNode
}): JSX.Element {
  return (
    <li className={`welcome-step is-${state}`} aria-current={state === 'current' ? 'step' : undefined}>
      <span className="welcome-step-num num" aria-hidden="true">
        {n}
      </span>
      <div className="welcome-step-body">
        <h3 className="welcome-step-title">
          <span className="sr-only">Крок {n}. </span>
          {title}
        </h3>
        {children}
      </div>
    </li>
  )
}

function Hero({ icon, title, children }: { icon: IconName; title: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <header className="welcome-hero">
      <span className="welcome-logo" aria-hidden="true">
        <Icon name={icon} size={26} />
      </span>
      <h2 className="welcome-title">{title}</h2>
      <p className="welcome-lead">{children}</p>
    </header>
  )
}

export function NoKeyState(): JSX.Element {
  const setShowSettings = useStore((s) => s.setShowSettings)
  return (
    <div className="welcome" data-testid="no-key">
      <div className="welcome-inner">
        <Hero icon="store" title="Вітаємо! Почнімо з ключа доступу до Etsy">
          Програма стежить за магазинами на <Term glossary="etsy" />: запам’ятовує всі їхні товари і після кожного{' '}
          <Term glossary="scan">сканування</Term> показує, що з’явилось нового, що зникло, що подешевшало і як ростуть
          відгуки.
        </Hero>

        <ol className="welcome-steps">
          <Step n={1} state="current" title={<>Отримайте <Term glossary="apiKey">ключ доступу</Term> на сайті Etsy</>}>
            <p className="welcome-text">
              Це безкоштовно: реєстрація займає кілька хвилин, а схвалення від Etsy — від кількох годин до кількох
              днів. Ключ — ваш особистий «пропуск» для читання даних з Etsy; він зберігається лише на цьому комп’ютері.
            </p>
            <KeyHelp withPasteStep={false} />
          </Step>
          <Step n={2} state="todo" title="Вставте ключ у Налаштуваннях">
            <p className="welcome-text">Дві частини ключа вписуються в окремі поля. Програма одразу перевірить, чи ключ працює.</p>
            <div className="welcome-action">
              <Button variant="primary" icon="settings" onClick={() => setShowSettings(true)}>
                Відкрити налаштування
              </Button>
            </div>
          </Step>
          <Step n={3} state="later" title="Додайте магазин і проскануйте його">
            <p className="welcome-text">
              Вставте посилання на будь-який магазин Etsy — свій чи конкурента. Перше сканування запам’ятає всі товари, а
              кожне наступне покаже, що змінилось.
            </p>
          </Step>
        </ol>
      </div>
    </div>
  )
}

const NEXT: { icon: IconName; title: string; text: ReactNode }[] = [
  {
    icon: 'refresh',
    title: 'Перше сканування',
    text: (
      <>
        Програма прочитає всі товари магазину і запам’ятає їх — це <Term glossary="baseline">базове сканування</Term>.
      </>
    )
  },
  {
    icon: 'history',
    title: 'Кожне наступне',
    text: 'Покаже нові, зниклі й змінені товари, акції та нові відгуки покупців.'
  },
  {
    icon: 'stats',
    title: 'Статистика',
    text: 'Графіки продажів, обраного і відгуків магазину — як вони змінюються з часом.'
  }
]

export function NoShopsState(): JSX.Element {
  const setShowAddShop = useStore((s) => s.setShowAddShop)
  return (
    <div className="welcome" data-testid="no-shops">
      <div className="welcome-inner">
        <Hero icon="store" title="Додайте перший магазин">
          Вставте посилання на магазин Etsy, за яким хочете стежити, — свій чи конкурента. Наприклад:{' '}
          <span className="welcome-code">etsy.com/shop/ShopName</span> (замість ShopName — назва магазину латинськими літерами).
        </Hero>
        <div className="welcome-cta">
          <Button variant="primary" icon="plus" onClick={() => setShowAddShop(true)}>
            Додати магазин
          </Button>
        </div>

        <section className="welcome-next" aria-labelledby="welcome-next-title">
          <h3 className="welcome-next-title" id="welcome-next-title">
            Що буде далі
          </h3>
          <ul className="welcome-cards">
            {NEXT.map((c) => (
              <li key={c.title} className="welcome-card">
                <span className="welcome-card-icon" aria-hidden="true">
                  <Icon name={c.icon} size={16} />
                </span>
                <div className="welcome-card-title">{c.title}</div>
                <div className="welcome-card-text">{c.text}</div>
              </li>
            ))}
          </ul>
          <p className="welcome-tip">
            <Icon name="info" size={14} />
            <span>
              Де взяти посилання: відкрийте магазин на сайті Etsy і скопіюйте адресу з адресного рядка браузера. Підійде
              і сама назва магазину.
            </span>
          </p>
        </section>
      </div>
    </div>
  )
}
