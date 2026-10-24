import { createContext, useContext, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import type { EtsyAuthStatus, MyListing, MyListingPatch, MyListingState, MyShopPatch, MyShopProfile } from '@shared/types'
import {
  MAX_MATERIALS,
  MAX_TAGS,
  MY_LISTING_STATES,
  SHOP_FIELDS,
  SCOPE_LABEL,
  STATE_LABEL,
  TITLE_MAX,
  listingPatch,
  materialProblems,
  missingScopes,
  shopPatch,
  splitList,
  tagProblems,
  titleProblems
} from '@shared/myShop'
import { formatDateTime, formatPrice } from '@shared/format'
import { GLOSSARY, type GlossaryKey } from '@shared/glossary'
import { useStore } from '../store'
import { confirmWith } from './ConfirmModal'
import { LazyDetails, panelMeta } from '../features/LazyDetails'
import { MY_SHOP_TABS, OWN_LISTING_SECTIONS } from '../features/registry'
import type { OwnListingSection } from '../features/types'
import {
  Badge,
  Button,
  Callout,
  EmptyState,
  Field,
  Icon,
  InfoTip,
  Loading,
  Modal,
  Segmented,
  Tabs,
  Term,
  Toggle,
  type BadgeTone,
  type IconName,
  type TabItem
} from '../ui'

export const DEV_APPS_URL = 'https://www.etsy.com/developers/your-apps'

/** Every scope the app asks for at sign-in (main/etsyAuth.ts OAUTH_SCOPES). */
export const ALL_SCOPES = Object.keys(SCOPE_LABEL)

/** What a permission lets the app do, in the words this window uses ("товар", not Etsy's "лістинг"). */
const SCOPE_TEXT: Record<string, string> = {
  listings_r: 'читання товарів',
  listings_w: 'зміну товарів',
  listings_d: 'видалення товарів'
}
export const scopeText = (s: string): string => SCOPE_TEXT[s] ?? SCOPE_LABEL[s] ?? s

/** Etsy's fee for publishing (and every renewal of) a listing, written the Ukrainian way. */
export const LISTING_FEE = '$0,20'

/** "назву", "назву і теги", "назву, теги і опис". */
export const listText = (items: string[]): string =>
  items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} і ${items[items.length - 1]}`

/**
 * Asks before unsaved edits are thrown away (closing the window, another tab, "До списку"…).
 * `what` says what would be lost. Resolves true = go on and drop them.
 */
export function confirmDiscard(what: string): Promise<boolean> {
  return confirmWith({
    title: 'Незбережені зміни',
    message: `Закрити без збереження?\n${what} На Etsy нічого не зміниться.`,
    confirmLabel: 'Не зберігати',
    danger: true
  })
}

/**
 * Where an open editor tells its window what it would lose (null = nothing),
 * so the window can ask before it closes or switches tabs.
 */
export const UnsavedContext = createContext<MutableRefObject<string | null> | null>(null)

/** Registers this editor's unsaved changes (null = none) with the window around it. */
export function useUnsaved(what: string | null): void {
  const ref = useContext(UnsavedContext)
  useEffect(() => {
    if (!ref) return
    ref.current = what
    return () => {
      ref.current = null
    }
  }, [ref, what])
}

/** The guard for the window's exits: true when nothing is unsaved or the user agreed to drop it. */
export async function canLeave(ref: MutableRefObject<string | null>): Promise<boolean> {
  return !ref.current || (await confirmDiscard(ref.current))
}

/** Runs `go` — at once when nothing is unsaved, else only after the user agreed to drop the changes. */
export function leaveThen(ref: MutableRefObject<string | null>, go: () => void): void {
  if (!ref.current) return go()
  void confirmDiscard(ref.current).then((ok) => ok && go())
}

// ---------------------------------------------------------------- shared bits

/** A listing state as a coloured chip whose tooltip explains the state. */
const STATE_TONE: Record<string, BadgeTone> = {
  active: 'accent',
  draft: 'info',
  inactive: 'neutral',
  expired: 'warn',
  sold_out: 'warn',
  removed: 'danger',
  edit: 'info'
}
const STATE_GLOSSARY: Record<string, GlossaryKey> = {
  active: 'listingActive',
  draft: 'listingDraft',
  inactive: 'listingInactive',
  expired: 'listingExpired',
  sold_out: 'listingSoldOut'
}

export function StateBadge({ state }: { state: string }): JSX.Element {
  const g = STATE_GLOSSARY[state]
  return (
    <Badge tone={STATE_TONE[state] ?? 'neutral'} hint={g ? GLOSSARY[g].short : undefined}>
      {STATE_LABEL[state] ?? state}
    </Badge>
  )
}

const price = (l: MyListing): string =>
  l.priceAmount != null && l.priceDivisor && l.currency ? formatPrice(l.priceAmount, l.priceDivisor, l.currency) : '—'

/** The seller's own price, explained: the shop page shows buyers another one (with VAT, minus a sale). */
function Price({ listing }: { listing: MyListing }): JSX.Element {
  const p = price(listing)
  return p === '—' ? (
    <span className="num">—</span>
  ) : (
    <Term glossary="basePrice" className="num">
      {p}
    </Term>
  )
}

/** How many can still be bought: for a file that is "how many more times", for a thing "how many are left". */
function Quantity({ listing }: { listing: MyListing }): JSX.Element | null {
  if (listing.quantity == null) return null
  const n = listing.quantity.toLocaleString('uk-UA')
  return (
    <Term glossary="quantity" className="dim">
      {listing.type === 'download' ? `можна купити ще: ${n}` : `у наявності: ${n}`}
    </Term>
  )
}

const openExternal = (url: string) => (e: { preventDefault: () => void }) => {
  e.preventDefault()
  void window.api.openExternal(url)
}

/** A thumbnail, or a calm placeholder when the listing has no photo. */
function Thumb({ src, size = 'md' }: { src: string | null | undefined; size?: 'md' | 'sm' }): JSX.Element {
  return src ? (
    <img className={`my-thumb my-thumb--${size}`} src={src} alt="" />
  ) : (
    <span className={`my-thumb my-thumb--${size} my-thumb--empty`} aria-hidden="true">
      <Icon name="image" size={size === 'sm' ? 16 : 20} />
    </span>
  )
}

/** A failed save in the save bar: right next to the button that was clicked, not somewhere below the form. */
export function SaveError({ title, error }: { title: string; error: string }): JSX.Element {
  return (
    <div className="my-savebar-error" role="alert">
      <Icon name="error" size={16} />
      <div className="my-savebar-error-text">
        <b>{title}</b>
        <span className="clamp-3" title={error}>
          {error}
        </span>
      </div>
    </div>
  )
}

/**
 * The bottom bar of an editor: what will happen (or why the save failed) + the
 * actions; sticks to the bottom of the scrolling area.
 */
export function SaveBar({ status, error, children }: { status: ReactNode; error?: { title: string; text: string } | null; children: ReactNode }): JSX.Element {
  return (
    <div className={'my-savebar' + (error ? ' has-error' : '')}>
      <div className="my-savebar-status">{error ? <SaveError title={error.title} error={error.text} /> : status}</div>
      <div className="my-savebar-actions">{children}</div>
    </div>
  )
}

function Saved(): JSX.Element {
  return (
    <span className="my-saved">
      <Icon name="check" size={15} />
      <span>Збережено на Etsy.</span>
    </span>
  )
}

/** Tags/materials as the editor will send them: one chip each, red when Etsy would refuse it. */
function ChipPreview({ items, bad }: { items: string[]; bad: (v: string) => boolean }): JSX.Element | null {
  if (!items.length) return null
  return (
    <ul className="my-chips" aria-label="Як це побачить Etsy">
      {items.map((t) => (
        <li key={t} className={'my-chip' + (bad(t) ? ' is-bad' : '')}>
          {t}
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------- sign-in

/** Not signed in: a 3-step guide — what will happen, the redirect address, paste the URL the browser landed on. */
function SignIn({ st }: { st: EtsyAuthStatus | null }): JSX.Element {
  const setEtsyAuth = useStore((s) => s.setEtsyAuth)
  const [redirect, setRedirect] = useState(st?.redirectUri ?? '')
  const [pasted, setPasted] = useState('')
  const [url, setUrl] = useState<string | null>(null)
  // Each error sits at the step it belongs to: "Увійти через Etsy" (step 2) and "Завершити вхід" (step 3).
  const [beginError, setBeginError] = useState<string | null>(null)
  const [completeError, setCompleteError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [opened, setOpened] = useState(0)
  const step3 = useRef<HTMLLIElement>(null)
  const pasteBox = useRef<HTMLTextAreaElement>(null)
  const waiting = !!url || !!st?.pending

  useEffect(() => {
    if (st?.redirectUri && !redirect) setRedirect(st.redirectUri)
  }, [st?.redirectUri, redirect])

  // Etsy opened in the browser: bring step 3 into view and put the cursor where the address goes.
  useEffect(() => {
    if (!opened) return
    step3.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
    pasteBox.current?.focus({ preventScroll: true })
  }, [opened])

  const begin = async (): Promise<void> => {
    setBeginError(null)
    const res = await window.api.beginEtsyLogin(redirect.trim())
    if (!res.ok) setBeginError(res.error)
    else {
      setUrl(res.value)
      setOpened((n) => n + 1)
    }
  }

  const complete = async (): Promise<void> => {
    setBusy(true)
    setCompleteError(null)
    try {
      const res = await window.api.completeEtsyLogin(pasted)
      if (!res.ok) setCompleteError(res.error)
      else setEtsyAuth(res.value)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="my-signin" data-testid="etsy-signin">
      <p className="my-lead">
        Увійдіть у свій акаунт <Term glossary="etsy" />, і тут можна буде змінювати свої товари й тексти магазину, бачити
        замовлення та фінанси. Це займе хвилину, і робиться один раз.
      </p>
      {st?.unreadable && (
        <Callout tone="warn" title="Потрібно увійти ще раз">
          Збережений вхід не вдалося розшифрувати — увійдіть ще раз.
        </Callout>
      )}
      <ol className="my-steps">
        <li className="my-step">
          <span className="my-step-num" aria-hidden="true">
            1
          </span>
          <div className="my-step-body">
            <h3 className="my-step-title">Що станеться</h3>
            <ul className="my-bullets">
              <li>Програма відкриє сторінку Etsy у вашому браузері.</li>
              <li>
                Там ви ввійдете у свій акаунт — пароль вводиться лише на сайті Etsy, програма його не бачить — і дасте
                дозвіл.
              </li>
              <li>
                Etsy видасть програмі <Term glossary="accessToken">цифровий пропуск</Term>. Він зберігається на цьому
                комп’ютері зашифрованим. Вийти можна будь-коли.
              </li>
            </ul>
            <div className="my-perms">
              <span className="my-perms-label">
                Програма попросить <Term glossary="permissions">дозволи</Term> на:
              </span>
              <ul className="my-chips">
                {ALL_SCOPES.map((s) => (
                  <li key={s} className="my-chip">
                    {scopeText(s)}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </li>
        <li className="my-step">
          <span className="my-step-num" aria-hidden="true">
            2
          </span>
          <div className="my-step-body">
            <h3 className="my-step-title">Перевірте адресу й відкрийте Etsy</h3>
            <Field
              label="Адреса повернення"
              glossary="myshop.redirectUri"
              hint={
                <>
                  Має точно збігатися з адресою в налаштуваннях вашого застосунку на{' '}
                  <a className="ext-link" href={DEV_APPS_URL} onClick={openExternal(DEV_APPS_URL)}>
                    etsy.com/developers/your-apps
                  </a>{' '}
                  (поле «Callback URLs»). Зазвичай нічого міняти не треба.
                </>
              }
              error={beginError ? `Не вдалося відкрити Etsy: ${beginError}` : undefined}
            >
              <input
                id="etsy-redirect"
                spellCheck={false}
                value={redirect}
                onChange={(e) => {
                  setRedirect(e.target.value)
                  setBeginError(null)
                }}
              />
            </Field>
            <div className="ui-row">
              <Button variant={waiting ? 'secondary' : 'primary'} icon={waiting ? 'external' : 'login'} onClick={() => void begin()}>
                {waiting ? 'Відкрити сторінку Etsy ще раз' : 'Увійти через Etsy'}
              </Button>
            </div>
          </div>
        </li>
        <li ref={step3} className={'my-step' + (waiting ? '' : ' is-later')}>
          <span className="my-step-num" aria-hidden="true">
            3
          </span>
          <div className="my-step-body">
            <h3 className="my-step-title">Вставте адресу з браузера</h3>
            {waiting ? (
              <div className="my-paste" data-testid="etsy-paste">
                <ol className="my-bullets my-bullets--num">
                  <li>
                    У браузері відкрилася сторінка Etsy — натисніть «Allow Access» (Дозволити).
                  </li>
                  <li>
                    Браузер перейде на <code className="my-code">{redirect || st?.redirectUri}</code> і покаже помилку «сайт
                    недоступний» — так і має бути.
                  </li>
                  <li>
                    Скопіюйте всю адресу з адресного рядка (вона містить <code className="my-code">code=…</code>) і вставте
                    нижче.
                  </li>
                </ol>
                <Field
                  label="Адреса з браузера"
                  glossary="myshop.pastedUrl"
                  error={completeError ? `Не вдалося увійти: ${completeError}` : undefined}
                >
                  <textarea
                    ref={pasteBox}
                    id="etsy-pasted"
                    rows={3}
                    spellCheck={false}
                    value={pasted}
                    placeholder="https://localhost:3003/callback?code=…&state=…"
                    onChange={(e) => {
                      setPasted(e.target.value)
                      setCompleteError(null)
                    }}
                  />
                </Field>
                <div className="ui-row">
                  <Button variant="primary" icon="check" busy={busy} disabled={!pasted.trim()} onClick={() => void complete()}>
                    Завершити вхід
                  </Button>
                </div>
              </div>
            ) : (
              <p className="my-muted">Цей крок стане доступним, коли ви натиснете «Увійти через Etsy».</p>
            )}
          </div>
        </li>
      </ol>
    </div>
  )
}

// ---------------------------------------------------------------- listing editor

const PATCH_LABEL: Record<keyof MyListingPatch, string> = {
  title: 'назву',
  description: 'опис',
  tags: 'теги',
  materials: 'матеріали',
  shouldAutoRenew: 'автоподовження',
  state: 'стан'
}

const patchLabels = (keys: string[]): string[] => keys.map((k) => PATCH_LABEL[k as keyof MyListingPatch] ?? k)
const changedText = (keys: string[]): string => `Буде змінено: ${patchLabels(keys).join(', ')}.`

/** What a state change does, in plain words (shown under the state switch). */
function stateNote(from: string, to: string): string {
  if (to === from) return GLOSSARY[STATE_GLOSSARY[from] ?? 'listingActive'].short
  if (to === 'inactive') return GLOSSARY['myshop.deactivate'].short
  if (from === 'inactive') return 'Товар знову з’явиться в магазині й у пошуку Etsy.'
  const fee = GLOSSARY['myshop.publish'].short
  return from === 'sold_out' ? `${fee} Спершу додайте кількість у розділі «Ціна, кількість і варіанти» нижче.` : fee
}

const STATE_ACTION: Record<string, string> = {
  active: 'Вимкнути',
  inactive: 'Увімкнути',
  draft: 'Опублікувати',
  expired: 'Поновити',
  sold_out: 'Повернути в продаж'
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

/** The host's words for the feature sections under the editor: icon, a one-line explanation, their order. */
const SECTION_META: Record<string, { icon: IconName; description: string; label?: string; danger?: boolean }> = {
  inventory: { icon: 'money', description: 'Ціна, скільки штук можна купити, і варіанти (розмір, колір) — кожен зі своєю ціною.' },
  media: { icon: 'photo', description: 'Фото й відео на сторінці товару, а для цифрового товару — файли, які отримає покупець.' },
  'variation-images': { icon: 'image', description: 'Яке фото покупець побачить, коли вибере колір чи інший варіант.' },
  'shopConfig-section': { icon: 'folder', description: 'На якій «полиці» вашого магазину покупці знайдуть цей товар.' },
  attributes: { icon: 'list', description: 'Властивості для фільтрів пошуку Etsy: колір, розмір, свято, стиль. Допомагають покупцям знайти товар.' },
  personalization: { icon: 'edit', description: 'Чи може покупець вписати свій текст (ім’я, дату) під час замовлення.' },
  translations: { icon: 'globe', description: 'Назва, опис і теги іншими мовами — для покупців з інших країн.' },
  'orders-sales': { icon: 'receipt', description: 'Скільки разів цей товар купили, скільки штук і скільки він приніс.' },
  danger: {
    icon: 'trash',
    label: 'Видалити товар з Etsy',
    description: 'Назавжди прибрати товар з магазину. Цю дію не можна скасувати.',
    danger: true
  }
}
const SECTION_ORDER = Object.keys(SECTION_META)

/** The feature sections in the order a seller works through them; deleting always last. */
export function ownListingSections(): Array<OwnListingSection & { meta: { icon?: IconName; description?: string; label: string; danger: boolean } }> {
  const rank = (id: string): number => {
    if (SECTION_META[id]?.danger) return SECTION_ORDER.length + 1
    const i = SECTION_ORDER.indexOf(id)
    return i < 0 ? SECTION_ORDER.length : i
  }
  return OWN_LISTING_SECTIONS.map((sec, i) => ({ sec, i }))
    .sort((a, b) => rank(a.sec.id) - rank(b.sec.id) || a.i - b.i)
    .map(({ sec }) => {
      const own = panelMeta(sec)
      const host = SECTION_META[sec.id]
      return {
        ...sec,
        meta: {
          icon: own.icon ?? host?.icon,
          description: own.description ?? host?.description,
          label: host?.label ?? sec.label,
          danger: !!host?.danger
        }
      }
    })
}

/** One listing's editor: only changed fields go to Etsy. */
function ListingEditor({
  listing,
  onSaved,
  onClose
}: {
  listing: MyListing
  onSaved: (l: MyListing) => void
  /** Leave the editor right away (after a save, or when a section deleted the listing). */
  onClose: () => void
}): JSX.Element {
  const requestConfirm = useStore((s) => s.requestConfirm)
  const [title, setTitle] = useState(listing.title)
  const [description, setDescription] = useState(listing.description)
  const [tags, setTags] = useState(listing.tags.join(', '))
  const [materials, setMaterials] = useState(listing.materials.join(', '))
  const [autoRenew, setAutoRenew] = useState(listing.shouldAutoRenew ?? false)
  const [state, setState] = useState(listing.state)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  const patch = useMemo(
    () => listingPatch(listing, { title, description, tags, materials, shouldAutoRenew: autoRenew, state }),
    [listing, title, description, tags, materials, autoRenew, state]
  )
  // Problems per field — only for what changed (what main would refuse).
  const tagList = splitList(tags)
  const materialList = splitList(materials)
  const titleErr = patch.title !== undefined ? titleProblems(patch.title) : []
  const tagErr = patch.tags !== undefined ? tagProblems(patch.tags) : []
  const materialErr = patch.materials !== undefined ? materialProblems(patch.materials) : []
  const descErr = patch.description !== undefined && !patch.description.trim() ? ['Опис не може бути порожнім.'] : []
  const blocked = titleErr.length + tagErr.length + materialErr.length + descErr.length > 0
  const changedKeys = Object.keys(patch)
  const changed = changedKeys.length > 0
  const canToggle = listing.state in STATE_ACTION
  const target = listing.state === 'active' ? 'inactive' : 'active'
  const lost = changed ? `Ви змінили ${listText(patchLabels(changedKeys))}, але ще не зберегли на Etsy — ці зміни пропадуть.` : null
  useUnsaved(lost)
  const sections = useMemo(ownListingSections, [])

  /** "До списку" / "Скасувати": asks first when something is unsaved. */
  const leave = async (): Promise<void> => {
    if (lost && !(await confirmDiscard(lost))) return
    onClose()
  }

  const save = async (): Promise<void> => {
    if (patch.state === 'active' && listing.state !== 'active') {
      const ok = await requestConfirm(
        listing.state === 'inactive'
          ? 'Увімкнути товар?\nВін знову з’явиться в магазині.'
          : `Опублікувати товар?\nВін з’явиться в магазині, а Etsy стягне звичайну плату за публікацію (${LISTING_FEE} за 4 місяці). Для чернетки потрібне хоча б одне фото.`
      )
      if (!ok) return
    }
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const res = await window.api.saveMyListing(listing.listingId, patch)
      if (!res.ok) setError(res.error)
      else {
        setSaved(true)
        onSaved({ ...res.value, imageUrl: res.value.imageUrl ?? listing.imageUrl })
      }
    } finally {
      setBusy(false)
    }
  }

  const touch = <T,>(f: (v: T) => void) => (v: T) => {
    f(v)
    setSaved(false)
    setError(null)
  }
  const errText = (list: string[]): string | undefined => (list.length ? list.join(' ') : undefined)

  return (
    <div className="listing-editor my-editor" data-testid="listing-editor">
      <div className="my-editor-head">
        <Button variant="ghost" size="sm" icon="chevron-left" onClick={() => void leave()}>
          До списку
        </Button>
        <Thumb src={listing.imageUrl} size="sm" />
        <div className="my-editor-headtext">
          <div className="my-editor-title truncate" title={listing.title}>
            {listing.title || '(без назви)'}
          </div>
          <div className="my-meta">
            <StateBadge state={listing.state} />
            <Price listing={listing} />
            <span className="dim">№ {listing.listingId}</span>
          </div>
        </div>
        {listing.url && (
          <Button variant="ghost" size="sm" icon="external" tooltip="Відкрити сторінку товару в браузері" onClick={openExternal(listing.url)}>
            На Etsy
          </Button>
        )}
      </div>

      <section className="my-card">
        <h3 className="my-card-title">Що бачать покупці</h3>
        <Field
          label="Назва"
          glossary="myshop.title"
          aside={<span className="num">{`${title.trim().length}/${TITLE_MAX}`}</span>}
          error={errText(titleErr)}
        >
          <input id="ed-title" value={title} onChange={(e) => touch(setTitle)(e.target.value)} />
        </Field>
        <Field label="Опис" glossary="myshop.description" error={errText(descErr)}>
          <textarea id="ed-desc" rows={7} value={description} onChange={(e) => touch(setDescription)(e.target.value)} />
        </Field>
        <div className="ui-form-grid">
          <Field
            label="Теги"
            glossary="tags"
            aside={<span className="num">{`${tagList.length}/${MAX_TAGS}`}</span>}
            hint={
              <>
                {GLOSSARY['myshop.tagRules'].short}
                <ChipPreview items={tagList} bad={(t) => tagProblems([t]).length > 0} />
              </>
            }
            error={errText(tagErr)}
          >
            <input id="ed-tags" value={tags} onChange={(e) => touch(setTags)(e.target.value)} />
          </Field>
          <Field
            label="Матеріали"
            glossary="materials"
            aside={<span className="num">{`${materialList.length}/${MAX_MATERIALS}`}</span>}
            hint={
              <>
                Через кому: з чого зроблено товар. Лише літери, цифри й пробіли.
                <ChipPreview items={materialList} bad={(m) => materialProblems([m]).length > 0} />
              </>
            }
            error={errText(materialErr)}
          >
            <input id="ed-materials" value={materials} onChange={(e) => touch(setMaterials)(e.target.value)} />
          </Field>
        </div>
      </section>

      <section className="my-card">
        <h3 className="my-card-title">Продаж</h3>
        {canToggle && (
          <div className="my-state">
            <div className="ui-field-head">
              <span className="ui-field-label">Стан</span>
              <InfoTip glossary="myshop.state" />
            </div>
            <Segmented
              label="Стан"
              value={state}
              onChange={touch(setState)}
              options={[
                { value: listing.state, label: `${cap(STATE_LABEL[listing.state] ?? listing.state)} (як зараз)` },
                { value: target, label: STATE_ACTION[listing.state] }
              ]}
            />
            <div className={'ui-field-hint' + (state !== listing.state ? ' my-note-strong' : '')}>{stateNote(listing.state, state)}</div>
          </div>
        )}
        <Toggle
          label="Автоматично продовжувати"
          glossary="autoRenew"
          hint={`Коли 4 місяці розміщення минуть, Etsy сам поновить товар і візьме ${LISTING_FEE}.`}
          checked={autoRenew}
          onChange={touch(setAutoRenew)}
        />
      </section>

      <SaveBar
        status={saved ? <Saved /> : changed ? changedText(changedKeys) : 'Змін ще немає.'}
        error={error ? { title: 'Не вдалося зберегти на Etsy', text: error } : null}
      >
        <Button onClick={() => void leave()}>Скасувати</Button>
        <Button variant="primary" icon="upload" busy={busy} disabled={!changed || blocked} onClick={() => void save()}>
          Зберегти на Etsy
        </Button>
      </SaveBar>

      {sections.length > 0 && (
        <section className="my-more">
          <h3 className="my-card-title">Більше налаштувань товару</h3>
          <p className="my-muted">
            Кожен розділ читає дані з Etsy, коли ви його відкриваєте, і зберігає свої зміни окремо — кнопкою всередині розділу.
          </p>
          {sections.map((sec) => (
            <LazyDetails
              key={sec.id}
              label={sec.meta.label}
              icon={sec.meta.icon}
              description={sec.meta.description}
              testId={`own-section-${sec.id}`}
              className={'my-section' + (sec.meta.danger ? ' my-section--danger' : '')}
            >
              {() => (
                <sec.Component
                  listing={listing}
                  // A listing passed = it changed on Etsy; none = it is gone (deleted): back to the reloaded list.
                  onChanged={(l) => (l ? onSaved({ ...l, imageUrl: l.imageUrl ?? listing.imageUrl }) : onClose())}
                />
              )}
            </LazyDetails>
          ))}
        </section>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- listings tab

const EMPTY_TEXT: Record<MyListingState, string> = {
  active: 'Зараз у магазині немає товарів на продажу.',
  draft: 'Немає чернеток на Etsy. Нові товари можна підготувати в програмі — кнопкою «Новий товар» у вашому магазині.',
  inactive: 'Немає вимкнених товарів.',
  expired: 'Немає товарів, у яких минув термін розміщення.',
  sold_out: 'Немає розпроданих товарів.'
}

function ListingsTab(): JSX.Element {
  const [state, setState] = useState<MyListingState>('active')
  const [rows, setRows] = useState<MyListing[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<MyListing | null>(null)
  const [reload, setReload] = useState(0)
  const [moreBusy, setMoreBusy] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    void window.api.getMyListings(state, 0).then((res) => {
      if (!alive) return
      setLoading(false)
      if (!res.ok) {
        setError(res.error)
        setRows([])
        setTotal(0)
      } else {
        setRows(res.value.listings)
        setTotal(res.value.total)
      }
    })
    return () => {
      alive = false
    }
  }, [state, reload])

  const more = async (): Promise<void> => {
    setMoreBusy(true)
    try {
      const res = await window.api.getMyListings(state, rows.length)
      if (!res.ok) setError(res.error)
      else {
        const seen = new Set(rows.map((r) => r.listingId))
        setRows([...rows, ...res.value.listings.filter((l) => !seen.has(l.listingId))])
        setTotal(res.value.total)
      }
    } finally {
      setMoreBusy(false)
    }
  }

  if (editing) {
    return (
      <ListingEditor
        key={editing.listingId}
        listing={editing}
        onSaved={(l) => {
          setEditing(l)
          setRows((rs) => rs.map((r) => (r.listingId === l.listingId ? l : r)))
        }}
        onClose={() => {
          setEditing(null)
          setReload((n) => n + 1)
        }}
      />
    )
  }

  const stateLabel = MY_LISTING_STATES.find((s) => s.value === state)?.label ?? ''
  return (
    <div data-testid="my-listings" className="my-listings-tab">
      <div className="my-toolbar">
        <Segmented
          label="Показати"
          size="sm"
          value={state}
          onChange={setState}
          options={MY_LISTING_STATES.map((s) => ({ value: s.value, label: s.label, hint: GLOSSARY[STATE_GLOSSARY[s.value]].short }))}
        />
        {!loading && !error && (
          <span className="my-count num" aria-live="polite">
            {total === 0 ? '' : `${stateLabel}: ${total}`}
          </span>
        )}
      </div>
      {loading ? (
        <Loading>Завантаження товарів з Etsy…</Loading>
      ) : error ? (
        <Callout
          tone="error"
          title="Не вдалося завантажити товари"
          action={
            <Button size="sm" icon="refresh" onClick={() => setReload((n) => n + 1)}>
              Спробувати ще
            </Button>
          }
        >
          {error}
        </Callout>
      ) : rows.length === 0 ? (
        <EmptyState icon="box" title="Тут немає товарів" compact>
          {EMPTY_TEXT[state]}
        </EmptyState>
      ) : (
        <>
          <ul className="my-listings my-rows">
            {rows.map((l) => (
              <li key={l.listingId} className="my-row">
                <Thumb src={l.imageUrl} />
                <div className="my-listing-text my-row-main">
                  <div className="my-listing-title my-row-title truncate" title={l.title}>
                    {l.title || '(без назви)'}
                  </div>
                  <div className="my-meta">
                    {/* The filter above already says the state; a chip only when this one differs. */}
                    {l.state !== state && <StateBadge state={l.state} />}
                    <Price listing={l} />
                    <Quantity listing={l} />
                  </div>
                </div>
                <Button size="sm" icon="edit" onClick={() => setEditing(l)}>
                  Редагувати
                </Button>
              </li>
            ))}
          </ul>
          {rows.length < total && (
            <div className="my-more-row">
              <Button icon="chevron-down" busy={moreBusy} onClick={() => void more()}>
                {`Показати ще (${total - rows.length})`}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- shop profile tab

const SHOP_FIELD_INFO: Record<keyof MyShopPatch, { glossary: GlossaryKey; hint: string; rows: number }> = {
  title: { glossary: 'myshop.shopTitle', hint: 'Один рядок під назвою магазину, наприклад «Зручні таблиці для планування бюджету».', rows: 1 },
  announcement: { glossary: 'myshop.announcement', hint: 'Видно вгорі сторінки магазину.', rows: 3 },
  saleMessage: { glossary: 'myshop.saleMessage', hint: 'Покупець отримає його після оплати фізичного товару.', rows: 3 },
  digitalSaleMessage: { glossary: 'myshop.digitalSaleMessage', hint: 'Покупець побачить його поруч із файлами для завантаження.', rows: 3 },
  policyAdditional: { glossary: 'myshop.policyAdditional', hint: '', rows: 4 }
}

const SHOP_GROUPS: ReadonlyArray<{ title: string; keys: ReadonlyArray<keyof MyShopPatch> }> = [
  { title: 'Сторінка магазину', keys: ['title', 'announcement'] },
  { title: 'Повідомлення покупцям', keys: ['saleMessage', 'digitalSaleMessage'] },
  { title: 'Правила магазину', keys: ['policyAdditional'] }
]

function ProfileTab(): JSX.Element {
  const [profile, setProfile] = useState<MyShopProfile | null>(null)
  const [form, setForm] = useState<Record<keyof MyShopPatch, string> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  const fill = (p: MyShopProfile): void => {
    setProfile(p)
    setForm({
      title: p.title,
      announcement: p.announcement,
      saleMessage: p.saleMessage,
      digitalSaleMessage: p.digitalSaleMessage,
      policyAdditional: p.policyAdditional
    })
  }

  useEffect(() => {
    let alive = true
    void window.api.getMyShop().then((res) => {
      if (!alive) return
      if (res.ok) fill(res.value)
      else setError(res.error)
    })
    return () => {
      alive = false
    }
  }, [])

  const patch = profile && form ? shopPatch(profile, form) : {}
  const changed = Object.keys(patch).length > 0
  useUnsaved(changed ? 'Тексти магазину, які ви змінили, ще не збережено на Etsy — ці зміни пропадуть.' : null)

  if (!profile || !form) {
    return error ? (
      <Callout tone="error" title="Не вдалося завантажити магазин">
        {error}
      </Callout>
    ) : (
      <Loading>Завантаження текстів магазину…</Loading>
    )
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const res = await window.api.saveMyShop(patch)
      if (!res.ok) setError(res.error)
      else {
        fill(res.value)
        setSaved(true)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-testid="my-profile" className="my-profile">
      <p className="my-muted">Тексти, які покупці бачать на сторінці вашого магазину та в повідомленнях після покупки.</p>
      {SHOP_GROUPS.map((g) => (
        <section className="my-card" key={g.title}>
          <h3 className="my-card-title">{g.title}</h3>
          {g.keys.map((key) => {
            const f = SHOP_FIELDS.find((x) => x.key === key)
            if (!f) return null
            const info = SHOP_FIELD_INFO[key]
            const disabled = key === 'policyAdditional' && !profile.inEu
            const id = `shop-${key}`
            const set = (v: string): void => {
              setForm({ ...form, [key]: v })
              setSaved(false)
              setError(null)
            }
            return (
              <Field key={key} label={f.label} glossary={info.glossary} hint={disabled ? 'Etsy дозволяє це поле лише магазинам у ЄС.' : info.hint || undefined}>
                {f.multiline ? (
                  <textarea id={id} rows={info.rows} value={form[key]} disabled={disabled} onChange={(e) => set(e.target.value)} />
                ) : (
                  <input id={id} value={form[key]} disabled={disabled} onChange={(e) => set(e.target.value)} />
                )}
              </Field>
            )
          })}
        </section>
      ))}
      <SaveBar
        status={saved ? <Saved /> : changed ? 'Є незбережені зміни.' : 'Змін ще немає.'}
        error={error ? { title: 'Не вдалося зберегти на Etsy', text: error } : null}
      >
        <Button variant="primary" icon="upload" busy={busy} disabled={!changed} onClick={() => void save()}>
          Зберегти на Etsy
        </Button>
      </SaveBar>
    </div>
  )
}

// ---------------------------------------------------------------- the window

/** Built-in and feature tabs: icon, a one-line explanation, and their place in the list. */
const TAB_META: Record<string, { icon: IconName; hint: string }> = {
  listings: { icon: 'box', hint: 'Усі ваші товари на Etsy (там їх звуть «лістингами»): на продажу, чернетки, вимкнені. Тут їх можна змінити.' },
  inventory: { icon: 'tag', hint: 'Ціни й кількість усіх товарів та їхніх варіантів в одному списку.' },
  orders: { icon: 'receipt', hint: 'Хто що купив, куди відправити, позначки про відправлення.' },
  'orders-finance': { icon: 'wallet', hint: 'Баланс, платежі покупців і всі нарахування та списання Etsy.' },
  profile: { icon: 'store', hint: 'Тексти магазину: заголовок, оголошення, повідомлення покупцям.' },
  'shopConfig-sections': { icon: 'folder', hint: 'Групи товарів на сторінці магазину, наприклад «Новинки».' },
  'shopConfig-shipping': { icon: 'truck', hint: 'Профілі доставки: куди, скільки коштує і як довго.' },
  'shopConfig-processing': { icon: 'clock', hint: 'Скільки часу потрібно, щоб підготувати замовлення до відправлення.' },
  'shopConfig-returns': { icon: 'history', hint: 'Чи можна повернути або обміняти товар і протягом скількох днів.' },
  'shopConfig-holidays': { icon: 'calendar', hint: 'Чи обробляє магазин замовлення у державні свята (лише США й Канада).' },
  'shopConfig-partners': { icon: 'layers', hint: 'Майстерні й компанії, які допомагають виготовляти ваші товари.' },
  account: { icon: 'user', hint: 'Ваш акаунт Etsy: ім’я, email, адреси й надані дозволи.' }
}
/** The order a seller thinks in: products, sales, the shop's settings, the account. */
const TAB_ORDER = Object.keys(TAB_META)

export function myShopTabs(): TabItem[] {
  const all = [
    { id: 'listings', label: 'Товари' },
    { id: 'profile', label: 'Профіль магазину' },
    ...MY_SHOP_TABS.map((t) => ({ id: t.id, label: t.label }))
  ]
  const rank = (id: string): number => {
    const i = TAB_ORDER.indexOf(id)
    return i < 0 ? TAB_ORDER.length : i
  }
  return all
    .map((t, i) => ({ t, i }))
    .sort((a, b) => rank(a.t.id) - rank(b.t.id) || a.i - b.i)
    .map(({ t }) => ({ ...t, icon: TAB_META[t.id]?.icon, hint: TAB_META[t.id]?.hint }))
}

/** Signed in: who, until when, sign out. */
function SignedInBar({ st, onLogout }: { st: EtsyAuthStatus; onLogout: () => void }): JSX.Element {
  return (
    <div className="my-signedin signed-in" data-testid="etsy-signed-in">
      <span className="my-dot" aria-hidden="true" />
      <div className="my-signedin-text">
        <div className="truncate">
          Ви увійшли: <b>{st.shopName ?? `магазин ${st.shopId ?? '—'}`}</b>
        </div>
        <div className="my-signedin-meta">
          {st.reloginBy && (
            <span className="my-inline" title={formatDateTime(st.reloginBy)}>
              вхід дійсний до {new Date(st.reloginBy).toLocaleDateString('uk-UA')}
              <InfoTip glossary="myshop.signedInUntil" size={13} />
            </span>
          )}
          {!st.encrypted && <span className="my-warn-text">вхід збережено без шифрування</span>}
        </div>
      </div>
      <Button size="sm" icon="logout" onClick={onLogout}>
        Вийти
      </Button>
    </div>
  )
}

/** One line: what happens to a change (the full text also in the tooltip when a narrow window cuts it). */
const TABBED_SUBTITLE = 'Зміни одразу зберігаються на Etsy, а в даних програми з’являться після наступного сканування.'

/**
 * "Мій магазин": sign in to Etsy (OAuth), then edit the user's own listings
 * (any state) and shop texts, plus every feature tab. Changes reach the
 * tracked data with the next scan.
 */
export function MyShopModal(): JSX.Element | null {
  const { showMyShop, setShowMyShop, etsyAuth: st, setEtsyAuth, requestConfirm } = useStore()
  const [tab, setTab] = useState<string>('listings')
  const tabs = useMemo(myShopTabs, [])
  // What the open editor would lose; every exit of the window asks first (canLeave).
  const unsaved = useRef<string | null>(null)
  const close = (): void => leaveThen(unsaved, () => setShowMyShop(false))
  const switchTab = (id: string): void => {
    if (id !== tab) leaveThen(unsaved, () => setTab(id))
  }

  useEffect(() => {
    if (!showMyShop) return
    void window.api
      .getEtsyAuth()
      .then(setEtsyAuth)
      .catch(() => undefined)
  }, [showMyShop, setEtsyAuth])

  if (!showMyShop) return null
  const missing = st?.loggedIn ? missingScopes(st.scopes, ALL_SCOPES) : []
  const tabbed = !!(st?.loggedIn && st.shopId)

  const logout = async (): Promise<void> => {
    if (!(await canLeave(unsaved))) return
    if (!(await requestConfirm('Вийти з Etsy?\nЩоб знову редагувати магазин, доведеться увійти ще раз. На Etsy нічого не зміниться.'))) return
    setEtsyAuth(await window.api.logoutEtsy())
  }

  const Feature = MY_SHOP_TABS.find((t) => t.id === tab)?.Component
  return (
    <Modal
      title="Мій магазин Etsy"
      subtitle={tabbed ? <span className="my-subtitle" title={TABBED_SUBTITLE}>{TABBED_SUBTITLE}</span> : 'Керуйте своїм магазином на Etsy прямо з програми.'}
      size={tabbed ? 'xl' : 'lg'}
      onClose={close}
      className={'my-shop-modal' + (tabbed ? ' is-tabbed' : '')}
      bodyClassName={tabbed ? 'my-shop-body--tabs' : undefined}
      headerExtra={st?.loggedIn ? <SignedInBar st={st} onLogout={() => void logout()} /> : undefined}
    >
      {!st?.loggedIn ? (
        <SignIn st={st} />
      ) : (
        <>
          {!st.shopId ? (
            <EmptyState icon="store" title="У цього акаунта Etsy немає магазину.">
              Відкрийте магазин на Etsy або вийдіть і ввійдіть під акаунтом, якому належить магазин.
            </EmptyState>
          ) : (
            <>
              {missing.length > 0 && (
                <div data-testid="missing-scopes">
                  <Callout tone="warn" compact title="Бракує дозволів" role="note">
                    Вхід не має дозволів: {missing.map(scopeText).join(', ')}. Щоб ними користуватися, вийдіть і
                    увійдіть в Etsy ще раз.
                  </Callout>
                </div>
              )}
              <UnsavedContext.Provider value={unsaved}>
                <Tabs
                  label="Розділи магазину"
                  orientation="vertical"
                  value={tab}
                  onChange={switchTab}
                  tabs={tabs}
                  className="my-shop-tabs"
                  idBase="my-shop"
                >
                  {tab === 'listings' ? <ListingsTab /> : tab === 'profile' ? <ProfileTab /> : Feature ? <Feature /> : null}
                </Tabs>
              </UnsavedContext.Provider>
            </>
          )}
        </>
      )}
    </Modal>
  )
}
