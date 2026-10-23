import { useEffect, useMemo, useState } from 'react'
import type { EtsyAuthStatus, MyListing, MyListingState, MyShopPatch, MyShopProfile } from '@shared/types'
import {
  MAX_MATERIALS,
  MAX_TAGS,
  MY_LISTING_STATES,
  SHOP_FIELDS,
  SCOPE_LABEL,
  STATE_LABEL,
  TITLE_MAX,
  missingScopes,
  listingPatch,
  listingPatchProblems,
  shopPatch,
  splitList
} from '@shared/myShop'
import { formatDateTime, formatPrice } from '@shared/format'
import { useStore } from '../store'
import { useEscape } from './useEscape'
import { LazyDetails } from '../features/LazyDetails'
import { MY_SHOP_TABS, OWN_LISTING_SECTIONS } from '../features/registry'

export const DEV_APPS_URL = 'https://www.etsy.com/developers/your-apps'

/** Every scope the app asks for at sign-in (main/etsyAuth.ts OAUTH_SCOPES). */
export const ALL_SCOPES = Object.keys(SCOPE_LABEL)

/** Not signed in: the redirect URI, "Увійти через Etsy", then paste the URL the browser landed on. */
function SignIn({ st }: { st: EtsyAuthStatus | null }): JSX.Element {
  const setEtsyAuth = useStore((s) => s.setEtsyAuth)
  const [redirect, setRedirect] = useState(st?.redirectUri ?? '')
  const [pasted, setPasted] = useState('')
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const waiting = !!url || !!st?.pending

  useEffect(() => {
    if (st?.redirectUri && !redirect) setRedirect(st.redirectUri)
  }, [st?.redirectUri, redirect])

  const begin = async (): Promise<void> => {
    setError(null)
    const res = await window.api.beginEtsyLogin(redirect.trim())
    if (!res.ok) setError(res.error)
    else setUrl(res.value)
  }

  const complete = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const res = await window.api.completeEtsyLogin(pasted)
      if (!res.ok) setError(res.error)
      else setEtsyAuth(res.value)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="settings-section" data-testid="etsy-signin">
      <p className="hint">
        Щоб змінювати свій магазин (лістинги, оголошення, повідомлення покупцям), увійдіть в Etsy. Програма
        попросить дозвіл лише на лістинги й магазин; токен зберігається зашифрованим, як API-ключ.
      </p>
      {st?.unreadable && (
        <div className="hint warn">Збережений вхід не вдалося розшифрувати — увійдіть ще раз.</div>
      )}
      <div className="field">
        <label htmlFor="etsy-redirect">Адреса повернення</label>
        <input id="etsy-redirect" spellCheck={false} value={redirect} onChange={(e) => setRedirect(e.target.value)} />
        <div className="hint">
          Має точно збігатися з адресою в налаштуваннях вашого застосунку на{' '}
          <a
            className="ext-link"
            href={DEV_APPS_URL}
            onClick={(e) => {
              e.preventDefault()
              void window.api.openExternal(DEV_APPS_URL)
            }}
          >
            etsy.com/developers/your-apps
          </a>
          .
        </div>
      </div>
      <div className="settings-actions">
        <button className="btn primary" onClick={() => void begin()}>
          {waiting ? 'Відкрити сторінку Etsy ще раз' : 'Увійти через Etsy'}
        </button>
      </div>
      {waiting && (
        <div className="signin-paste" data-testid="etsy-paste">
          <ol className="hint">
            <li>У браузері відкрилася сторінка Etsy — натисніть «Allow Access» (Дозволити).</li>
            <li>
              Браузер перейде на <code>{redirect || st?.redirectUri}</code> і покаже помилку «сайт недоступний» — так і
              має бути.
            </li>
            <li>Скопіюйте адресу з адресного рядка (вона містить <code>code=…</code>) і вставте нижче.</li>
          </ol>
          <div className="field">
            <label htmlFor="etsy-pasted">Адреса з браузера</label>
            <textarea
              id="etsy-pasted"
              rows={3}
              spellCheck={false}
              value={pasted}
              placeholder="https://localhost:3003/callback?code=…&state=…"
              onChange={(e) => setPasted(e.target.value)}
            />
          </div>
          <button className="btn primary" disabled={busy || !pasted.trim()} onClick={() => void complete()}>
            {busy ? 'Входжу…' : 'Завершити вхід'}
          </button>
        </div>
      )}
      {error && (
        <div className="test-result err" role="alert">
          {error}
        </div>
      )}
    </section>
  )
}

const price = (l: MyListing): string =>
  l.priceAmount != null && l.priceDivisor && l.currency ? formatPrice(l.priceAmount, l.priceDivisor, l.currency) : '—'

/** One listing's editor: only changed fields go to Etsy. */
function ListingEditor({
  listing,
  onSaved,
  onClose
}: {
  listing: MyListing
  onSaved: (l: MyListing) => void
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
  const problems = listingPatchProblems(patch)
  const changed = Object.keys(patch).length > 0
  const tagCount = splitList(tags).length
  const canToggle = ['active', 'inactive', 'draft', 'expired', 'sold_out'].includes(listing.state)

  const save = async (): Promise<void> => {
    if (patch.state === 'active' && listing.state !== 'active') {
      const ok = await requestConfirm(
        listing.state === 'inactive'
          ? 'Увімкнути лістинг? Він знову з’явиться в магазині.'
          : 'Опублікувати лістинг? Etsy стягне звичайну плату за публікацію ($0.20), а для чернетки потрібне хоча б одне фото.'
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

  return (
    <div className="listing-editor" data-testid="listing-editor">
      <div className="editor-head">
        <button className="btn small" onClick={onClose}>
          ← До списку
        </button>
        <span className="dim">
          #{listing.listingId} · {STATE_LABEL[listing.state] ?? listing.state} · {price(listing)}
        </span>
      </div>
      <div className="field">
        <label htmlFor="ed-title">
          Назва <span className="dim">({title.trim().length}/{TITLE_MAX})</span>
        </label>
        <input id="ed-title" value={title} onChange={(e) => touch(setTitle)(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="ed-desc">Опис</label>
        <textarea id="ed-desc" rows={8} value={description} onChange={(e) => touch(setDescription)(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="ed-tags">
          Теги через кому <span className="dim">({tagCount}/{MAX_TAGS})</span>
        </label>
        <input id="ed-tags" value={tags} onChange={(e) => touch(setTags)(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="ed-materials">
          Матеріали через кому <span className="dim">({splitList(materials).length}/{MAX_MATERIALS})</span>
        </label>
        <input id="ed-materials" value={materials} onChange={(e) => touch(setMaterials)(e.target.value)} />
      </div>
      <div className="field">
        <label className="check">
          <input type="checkbox" checked={autoRenew} onChange={(e) => touch(setAutoRenew)(e.target.checked)} />{' '}
          Автоматично продовжувати
        </label>
      </div>
      {canToggle && (
        <div className="field">
          <label htmlFor="ed-state">Стан</label>
          <select id="ed-state" value={state} onChange={(e) => touch(setState)(e.target.value)}>
            <option value={listing.state}>{STATE_LABEL[listing.state] ?? listing.state} (як зараз)</option>
            {listing.state !== 'active' && (
              <option value="active">{listing.state === 'inactive' ? 'увімкнути (активний)' : 'опублікувати (активний)'}</option>
            )}
            {listing.state === 'active' && <option value="inactive">вимкнути (неактивний)</option>}
          </select>
        </div>
      )}
      {problems.length > 0 && (
        <ul className="hint err" role="alert">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {error && (
        <div className="test-result err" role="alert">
          {error}
        </div>
      )}
      {saved && <div className="test-result ok">Збережено на Etsy.</div>}
      <div className="settings-actions">
        <button className="btn primary" disabled={busy || !changed || problems.length > 0} onClick={() => void save()}>
          {busy ? 'Зберігаю…' : 'Зберегти на Etsy'}
        </button>
        <button className="btn" onClick={onClose}>
          Скасувати
        </button>
      </div>
      {OWN_LISTING_SECTIONS.map((sec) => (
        <LazyDetails key={sec.id} label={sec.label} testId={`own-section-${sec.id}`}>
          {() => (
            <sec.Component
              listing={listing}
              // A listing passed = it changed on Etsy; none = it is gone (deleted): back to the reloaded list.
              onChanged={(l) => (l ? onSaved({ ...l, imageUrl: l.imageUrl ?? listing.imageUrl }) : onClose())}
            />
          )}
        </LazyDetails>
      ))}
    </div>
  )
}

function ListingsTab(): JSX.Element {
  const [state, setState] = useState<MyListingState>('active')
  const [rows, setRows] = useState<MyListing[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<MyListing | null>(null)
  const [reload, setReload] = useState(0)

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
    const res = await window.api.getMyListings(state, rows.length)
    if (!res.ok) setError(res.error)
    else {
      const seen = new Set(rows.map((r) => r.listingId))
      setRows([...rows, ...res.value.listings.filter((l) => !seen.has(l.listingId))])
      setTotal(res.value.total)
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

  return (
    <div data-testid="my-listings">
      <div className="field my-listings-filter">
        <label htmlFor="my-state">Показати</label>
        <select id="my-state" value={state} onChange={(e) => setState(e.target.value as MyListingState)}>
          {MY_LISTING_STATES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      {loading ? (
        <div className="hint">Завантаження…</div>
      ) : error ? (
        <div className="test-result err" role="alert">
          {error}
        </div>
      ) : rows.length === 0 ? (
        <div className="hint">Тут немає лістингів.</div>
      ) : (
        <>
          <ul className="my-listings">
            {rows.map((l) => (
              <li key={l.listingId}>
                {l.imageUrl ? <img src={l.imageUrl} alt="" /> : <span className="thumb-empty" />}
                <div className="my-listing-text">
                  <div className="my-listing-title">{l.title || '(без назви)'}</div>
                  <div className="dim">
                    {STATE_LABEL[l.state] ?? l.state} · {price(l)}
                    {l.quantity != null && ` · к-сть ${l.quantity}`}
                  </div>
                </div>
                <button className="btn small" onClick={() => setEditing(l)}>
                  Редагувати
                </button>
              </li>
            ))}
          </ul>
          {rows.length < total && (
            <button className="btn" onClick={() => void more()}>
              Показати ще ({total - rows.length})
            </button>
          )}
        </>
      )}
    </div>
  )
}

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

  if (!profile || !form) {
    return error ? (
      <div className="test-result err" role="alert">
        {error}
      </div>
    ) : (
      <div className="hint">Завантаження…</div>
    )
  }

  const patch = shopPatch(profile, form)
  const changed = Object.keys(patch).length > 0

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
    <div data-testid="my-profile">
      {SHOP_FIELDS.map((f) => {
        const disabled = f.key === 'policyAdditional' && !profile.inEu
        const id = `shop-${f.key}`
        const set = (v: string): void => {
          setForm({ ...form, [f.key]: v })
          setSaved(false)
          setError(null)
        }
        return (
          <div className="field" key={f.key}>
            <label htmlFor={id}>{f.label}</label>
            {f.multiline ? (
              <textarea id={id} rows={3} value={form[f.key]} disabled={disabled} onChange={(e) => set(e.target.value)} />
            ) : (
              <input id={id} value={form[f.key]} disabled={disabled} onChange={(e) => set(e.target.value)} />
            )}
            {disabled && <div className="hint">Etsy дозволяє це поле лише магазинам у ЄС.</div>}
          </div>
        )
      })}
      {error && (
        <div className="test-result err" role="alert">
          {error}
        </div>
      )}
      {saved && <div className="test-result ok">Збережено на Etsy.</div>}
      <div className="settings-actions">
        <button className="btn primary" disabled={busy || !changed} onClick={() => void save()}>
          {busy ? 'Зберігаю…' : 'Зберегти на Etsy'}
        </button>
      </div>
    </div>
  )
}

/**
 * "Мій магазин": sign in to Etsy (OAuth), then edit the user's own listings
 * (any state) and shop texts. Changes reach the tracked data with the next scan.
 */
export function MyShopModal(): JSX.Element | null {
  const { showMyShop, setShowMyShop, etsyAuth: st, setEtsyAuth, requestConfirm } = useStore()
  const [tab, setTab] = useState<string>('listings')
  const close = (): void => setShowMyShop(false)
  useEscape(close, showMyShop)

  useEffect(() => {
    if (!showMyShop) return
    void window.api
      .getEtsyAuth()
      .then(setEtsyAuth)
      .catch(() => undefined)
  }, [showMyShop, setEtsyAuth])

  if (!showMyShop) return null
  const missing = st?.loggedIn ? missingScopes(st.scopes, ALL_SCOPES) : []

  const logout = async (): Promise<void> => {
    if (!(await requestConfirm('Вийти з Etsy? Щоб знову редагувати магазин, доведеться увійти ще раз.'))) return
    setEtsyAuth(await window.api.logoutEtsy())
  }

  return (
    <div className="modal-backdrop" onClick={close}>
      <div
        className="modal my-shop-modal"
        role="dialog"
        aria-labelledby="my-shop-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="my-shop-title">Мій магазин Etsy</h2>
        {!st?.loggedIn ? (
          <SignIn st={st} />
        ) : (
          <>
            <div className="signed-in" data-testid="etsy-signed-in">
              <span>
                <span className="ok">●</span> Ви увійшли: <b>{st.shopName ?? `магазин ${st.shopId ?? '—'}`}</b>
                {st.reloginBy && <span className="dim"> · вхід дійсний до {formatDateTime(st.reloginBy)}</span>}
              </span>
              <button className="btn small" onClick={() => void logout()}>
                Вийти
              </button>
            </div>
            {!st.shopId ? (
              <div className="hint warn">У цього акаунта Etsy немає магазину.</div>
            ) : (
              <>
                <div className="tabs" role="tablist">
                  <button role="tab" aria-selected={tab === 'listings'} className={tab === 'listings' ? 'active' : ''} onClick={() => setTab('listings')}>
                    Лістинги
                  </button>
                  <button role="tab" aria-selected={tab === 'profile'} className={tab === 'profile' ? 'active' : ''} onClick={() => setTab('profile')}>
                    Профіль магазину
                  </button>
                  {MY_SHOP_TABS.map((t) => (
                    <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
                      {t.label}
                    </button>
                  ))}
                </div>
                {missing.length > 0 && (
                  <div className="hint warn" data-testid="missing-scopes">
                    Вхід не має дозволів: {missing.map((x) => SCOPE_LABEL[x] ?? x).join(', ')}. Щоб ними користуватися, вийдіть і
                    увійдіть в Etsy ще раз.
                  </div>
                )}
                {tab === 'listings' ? (
                  <ListingsTab />
                ) : tab === 'profile' ? (
                  <ProfileTab />
                ) : (
                  (() => {
                    const T = MY_SHOP_TABS.find((t) => t.id === tab)
                    return T ? <T.Component /> : null
                  })()
                )}
                <p className="hint">Зміни потрапляють на Etsy одразу; у даних стеження вони з’являться після наступного сканування магазину.</p>
              </>
            )}
          </>
        )}
        <div className="modal-actions">
          <button className="btn" onClick={close}>
            Закрити
          </button>
        </div>
      </div>
    </div>
  )
}
