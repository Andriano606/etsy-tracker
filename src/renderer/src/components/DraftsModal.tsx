import { useEffect, useMemo, useState } from 'react'
import type {
  CreateListingProgress,
  DraftFields,
  DraftMediaRef,
  ListingDraft,
  ShippingOption,
  TaxonomyOption
} from '@shared/types'
import {
  EMPTY_DRAFT_FIELDS,
  MAX_DIGITAL_FILES,
  MAX_IMAGES,
  MAX_TAGS,
  TITLE_MAX,
  WHEN_MADE,
  WHO_MADE,
  draftInput,
  newListingProblems,
  splitList
} from '@shared/myShop'
import { formatDateTime } from '@shared/format'
import { ownShopId, useStore } from '../store'
import { useEscape } from './useEscape'

/** How many category matches the search shows. */
export const TAXONOMY_RESULTS = 30

const kb = (n: number): string => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} МБ` : `${Math.max(1, Math.round(n / 1024))} КБ`)

/** A media slot in the form: stored with the draft (with a preview for photos) or freshly picked. */
interface Slot {
  key: string
  name: string
  size: number
  ref: DraftMediaRef
  preview: string | null
}

const stored = (d: ListingDraft, kind: 'photos' | 'files'): Slot[] =>
  d[kind].map((m) => ({
    key: `m${m.id}`,
    name: m.name,
    size: m.size,
    ref: { mediaId: m.id },
    preview: kind === 'photos' ? `etsyimg://draft/${m.id}` : null
  }))

export const DRAFT_STATUS: Record<ListingDraft['status'], string> = {
  draft: 'чекає перевірки',
  sent: 'надіслано на Etsy',
  error: 'не вдалося надіслати'
}

/** Picked/stored files with reorder (the first photo is the main one) and remove. */
function SlotList({
  items,
  onChange,
  ordered,
  readOnly
}: {
  items: Slot[]
  onChange: (v: Slot[]) => void
  ordered: boolean
  readOnly: boolean
}): JSX.Element | null {
  if (!items.length) return null
  const move = (i: number): void => {
    const v = [...items]
    ;[v[i - 1], v[i]] = [v[i], v[i - 1]]
    onChange(v)
  }
  return (
    <ol className="picked-files">
      {items.map((f, i) => (
        <li key={f.key}>
          {f.preview && <img className="draft-thumb" src={f.preview} alt="" />}
          <span className="picked-name">
            {f.name}
            {ordered && i === 0 && <span className="dim"> — головне фото</span>}
          </span>
          <span className="dim">{kb(f.size)}</span>
          {!readOnly && ordered && i > 0 && (
            <button className="btn small" aria-label={`Вище: ${f.name}`} onClick={() => move(i)}>
              ↑
            </button>
          )}
          {!readOnly && (
            <button className="btn small" aria-label={`Прибрати: ${f.name}`} onClick={() => onChange(items.filter((x) => x !== f))}>
              ✕
            </button>
          )}
        </li>
      ))}
    </ol>
  )
}

/**
 * One draft: edited here, saved in the app, then sent to Etsy (as an Etsy
 * draft or published). A sent draft is shown read-only.
 */
function DraftEditor({ draft, onBack }: { draft: ListingDraft | null; onBack: () => void }): JSX.Element {
  const { requestConfirm, shops, etsyAuth, scanShop, openDrafts } = useStore()
  const shop = shops.find((s) => s.id === ownShopId({ etsyAuth }))
  const [current, setCurrent] = useState<ListingDraft | null>(draft)
  const init: DraftFields = draft?.fields ?? EMPTY_DRAFT_FIELDS
  const [type, setType] = useState(init.type)
  const [title, setTitle] = useState(init.title)
  const [description, setDescription] = useState(init.description)
  const [price, setPrice] = useState(init.price)
  const [quantity, setQuantity] = useState(String(init.quantity))
  const [category, setCategory] = useState<TaxonomyOption | null>(
    init.taxonomyId != null ? { id: init.taxonomyId, path: init.taxonomyPath ?? `Категорія #${init.taxonomyId}` } : null
  )
  const [whoMade, setWhoMade] = useState(init.whoMade)
  const [whenMade, setWhenMade] = useState(init.whenMade)
  const [isSupply, setIsSupply] = useState(init.isSupply)
  const [tags, setTags] = useState(init.tags.join(', '))
  const [materials, setMaterials] = useState(init.materials.join(', '))
  const [autoRenew, setAutoRenew] = useState(init.shouldAutoRenew)
  const [shippingId, setShippingId] = useState(init.shippingProfileId)
  const [readinessId, setReadinessId] = useState(init.readinessStateId)
  const [photos, setPhotos] = useState<Slot[]>(draft ? stored(draft, 'photos') : [])
  const [files, setFiles] = useState<Slot[]>(draft ? stored(draft, 'files') : [])
  const [taxonomy, setTaxonomy] = useState<TaxonomyOption[] | null>(null)
  const [taxonomyError, setTaxonomyError] = useState<string | null>(null)
  const [catQuery, setCatQuery] = useState('')
  const [shipping, setShipping] = useState<ShippingOption[] | null>(null)
  const [processing, setProcessing] = useState<ShippingOption[] | null>(null)
  const [physicalError, setPhysicalError] = useState<string | null>(null)
  const [progress, setProgress] = useState<CreateListingProgress | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedNote, setSavedNote] = useState<string | null>(null)
  const readOnly = current?.sentListingId != null

  useEffect(() => {
    void window.api.getTaxonomy().then((r) => (r.ok ? setTaxonomy(r.value) : setTaxonomyError(r.error)))
    return window.api.onCreateListingProgress(setProgress)
  }, [])

  useEffect(() => {
    if (type !== 'physical' || shipping || readOnly) return
    void Promise.all([window.api.getShippingProfiles(), window.api.getProcessingProfiles()]).then(([s, p]) => {
      if (!s.ok) setPhysicalError(s.error)
      else {
        setShipping(s.value)
        if (s.value.length === 1 && shippingId == null) setShippingId(s.value[0].id)
      }
      if (p.ok) {
        setProcessing(p.value)
        if (p.value.length === 1 && readinessId == null) setReadinessId(p.value[0].id)
      }
    })
  }, [type, shipping, readOnly, shippingId, readinessId])

  const matches = useMemo(() => {
    const q = catQuery.trim().toLowerCase()
    if (!taxonomy || q.length < 2) return []
    return taxonomy.filter((t) => t.path.toLowerCase().includes(q)).slice(0, TAXONOMY_RESULTS)
  }, [taxonomy, catQuery])

  const fields = (): DraftFields => ({
    type,
    title,
    description,
    price,
    quantity: Number(quantity),
    taxonomyId: category?.id ?? null,
    taxonomyPath: category?.path ?? null,
    whoMade,
    whenMade,
    isSupply,
    tags: splitList(tags),
    materials: splitList(materials),
    shouldAutoRenew: autoRenew,
    shippingProfileId: shippingId,
    readinessStateId: readinessId
  })
  const keys = (v: Slot[]): string[] => v.map((s) => s.key)
  const sendProblems = newListingProblems(draftInput(fields(), keys(photos), keys(files), false))
  const publishProblems = newListingProblems(draftInput(fields(), keys(photos), keys(files), true))

  const touched = (): void => {
    setSavedNote(null)
    setError(null)
  }

  const pick = async (kind: 'images' | 'files'): Promise<void> => {
    const picked = await window.api.pickListingFiles(kind)
    const slots = picked.map((p) => ({ key: `t${p.token}`, name: p.name, size: p.size, ref: { token: p.token }, preview: null }))
    if (kind === 'images') setPhotos((v) => [...v, ...slots])
    else setFiles((v) => [...v, ...slots])
    touched()
  }

  /** Save in the app; the stored media replace the picked slots. */
  const save = async (): Promise<ListingDraft | null> => {
    const res = await window.api.saveDraft({
      ...(current ? { id: current.id } : {}),
      fields: fields(),
      photos: photos.map((p) => p.ref),
      files: type === 'download' ? files.map((f) => f.ref) : files.map((f) => f.ref)
    })
    if (!res.ok) {
      setError(res.error)
      return null
    }
    setCurrent(res.value)
    setPhotos(stored(res.value, 'photos'))
    setFiles(stored(res.value, 'files'))
    return res.value
  }

  const onSave = async (): Promise<void> => {
    setBusy(true)
    touched()
    try {
      if (await save()) setSavedNote('Чернетку збережено в програмі.')
    } finally {
      setBusy(false)
    }
  }

  const onSend = async (publish: boolean): Promise<void> => {
    if (
      !(await requestConfirm(
        publish
          ? 'Надіслати й опублікувати на Etsy? Etsy стягне звичайну плату за публікацію ($0.20).'
          : 'Надіслати на Etsy як чернетку? Покупці її не побачать, доки ви не опублікуєте.'
      ))
    ) {
      return
    }
    setBusy(true)
    touched()
    setProgress(null)
    try {
      const d = await save()
      if (!d) return
      const res = await window.api.sendDraft(d.id, publish)
      if (!res.ok) setError(res.error)
      const fresh = (await window.api.listDrafts()).find((x) => x.id === d.id)
      if (fresh) setCurrent(fresh)
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const onDelete = async (): Promise<void> => {
    if (!current) return onBack()
    if (!(await requestConfirm('Видалити цю чернетку з програми? На Etsy вона не впливає.'))) return
    await window.api.deleteDraft(current.id)
    onBack()
  }

  if (readOnly && current) {
    return (
      <div data-testid="draft-sent">
        <div className={`test-result ${current.lastError ? 'err' : 'ok'}`} role="status">
          {current.lastError
            ? current.lastError
            : `Надіслано на Etsy: лістинг #${current.sentListingId} (${current.sentPublished ? 'опубліковано' : 'чернетка на Etsy'}).`}
        </div>
        <p className="hint">
          {current.sentPublished
            ? 'Він з’явиться серед товарів магазину після наступного сканування.'
            : 'Далі його видно в «✏️ Керувати» → «Чернетки» і в Shop Manager на Etsy.'}
        </p>
        <h3 className="draft-title">{current.fields.title || '(без назви)'}</h3>
        <SlotList items={photos} onChange={() => undefined} ordered readOnly />
        <div className="settings-actions">
          {current.sentPublished && shop && (
            <button
              className="btn primary"
              onClick={() => {
                void scanShop(shop.id)
                openDrafts(null)
              }}
            >
              Сканувати магазин зараз
            </button>
          )}
          <button className="btn" onClick={() => void onDelete()}>
            Прибрати з чернеток
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="create-listing" data-testid="draft-form">
      {current?.source === 'mcp' && <div className="hint mcp-note">🤖 Цю чернетку підготував Claude — перевірте перед надсиланням.</div>}
      {current?.lastError && (
        <div className="test-result err" role="alert">
          Минула спроба надіслати: {current.lastError}
        </div>
      )}
      <div className="field">
        <label>Тип товару</label>
        <div className="radio-row">
          <label className="check">
            <input
              type="radio"
              name="type"
              checked={type === 'download'}
              onChange={() => {
                setType('download')
                touched()
              }}
            />{' '}
            Цифровий (файли)
          </label>
          <label className="check">
            <input
              type="radio"
              name="type"
              checked={type === 'physical'}
              onChange={() => {
                setType('physical')
                if (quantity === '999') setQuantity('1')
                touched()
              }}
            />{' '}
            Фізичний
          </label>
        </div>
      </div>
      <div className="field">
        <label htmlFor="new-title">
          Назва <span className="dim">({title.trim().length}/{TITLE_MAX})</span>
        </label>
        <input id="new-title" value={title} onChange={(e) => (setTitle(e.target.value), touched())} />
      </div>
      <div className="field">
        <label htmlFor="new-desc">Опис</label>
        <textarea id="new-desc" rows={6} value={description} onChange={(e) => (setDescription(e.target.value), touched())} />
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="new-price">Ціна{shop?.currency ? `, ${shop.currency}` : ''}</label>
          <input id="new-price" inputMode="decimal" placeholder="5.99" value={price} onChange={(e) => (setPrice(e.target.value), touched())} />
        </div>
        <div className="field">
          <label htmlFor="new-qty">Кількість</label>
          <input id="new-qty" inputMode="numeric" value={quantity} onChange={(e) => (setQuantity(e.target.value), touched())} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="new-cat">Категорія</label>
        {category ? (
          <div className="chosen-cat">
            <span>{category.path}</span>
            <button className="btn small" onClick={() => (setCategory(null), touched())}>
              Змінити
            </button>
          </div>
        ) : (
          <>
            <input
              id="new-cat"
              placeholder={taxonomy ? 'Почніть вводити, напр. planner або spreadsheet' : 'Завантаження категорій…'}
              disabled={!taxonomy}
              value={catQuery}
              onChange={(e) => setCatQuery(e.target.value)}
            />
            {taxonomyError && <div className="hint err">{taxonomyError}</div>}
            {matches.length > 0 && (
              <ul className="cat-results" role="listbox" aria-label="Категорії">
                {matches.map((t) => (
                  <li key={t.id}>
                    <button
                      role="option"
                      aria-selected={false}
                      onClick={() => {
                        setCategory(t)
                        setCatQuery('')
                        touched()
                      }}
                    >
                      {t.path}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="new-who">Хто виготовив</label>
          <select id="new-who" value={whoMade} onChange={(e) => (setWhoMade(e.target.value), touched())}>
            {WHO_MADE.map((w) => (
              <option key={w.value} value={w.value}>
                {w.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="new-when">Коли виготовлено</label>
          <select id="new-when" value={whenMade} onChange={(e) => (setWhenMade(e.target.value), touched())}>
            {WHEN_MADE.map((w) => (
              <option key={w.value} value={w.value}>
                {w.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label className="check">
          <input type="checkbox" checked={isSupply} onChange={(e) => (setIsSupply(e.target.checked), touched())} /> Це матеріал
          чи інструмент для творчості (supply)
        </label>
      </div>
      <div className="field">
        <label htmlFor="new-tags">
          Теги через кому <span className="dim">({splitList(tags).length}/{MAX_TAGS})</span>
        </label>
        <input id="new-tags" value={tags} onChange={(e) => (setTags(e.target.value), touched())} />
      </div>
      <div className="field">
        <label htmlFor="new-materials">Матеріали через кому</label>
        <input id="new-materials" value={materials} onChange={(e) => (setMaterials(e.target.value), touched())} />
      </div>
      {type === 'physical' && (
        <div className="field-row">
          <div className="field">
            <label htmlFor="new-shipping">Профіль доставки</label>
            {physicalError ? (
              <div className="hint err">{physicalError}</div>
            ) : (
              <select
                id="new-shipping"
                value={shippingId ?? ''}
                onChange={(e) => (setShippingId(e.target.value ? Number(e.target.value) : null), touched())}
              >
                <option value="">{shipping ? (shipping.length ? 'Виберіть…' : 'Немає профілів — створіть на Etsy') : 'Завантаження…'}</option>
                {shipping?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="field">
            <label htmlFor="new-readiness">Час обробки</label>
            <select
              id="new-readiness"
              value={readinessId ?? ''}
              onChange={(e) => (setReadinessId(e.target.value ? Number(e.target.value) : null), touched())}
            >
              <option value="">{processing ? 'Не вказано' : 'Завантаження…'}</option>
              {processing?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
      <div className="field">
        <label className="check">
          <input type="checkbox" checked={autoRenew} onChange={(e) => (setAutoRenew(e.target.checked), touched())} /> Автоматично
          продовжувати
        </label>
      </div>
      <div className="field">
        <label>
          Фото <span className="dim">(до {MAX_IMAGES}; JPG, PNG, GIF; перше — головне)</span>
        </label>
        <SlotList items={photos} onChange={(v) => (setPhotos(v), touched())} ordered readOnly={false} />
        <button className="btn small add-files" disabled={photos.length >= MAX_IMAGES} onClick={() => void pick('images')}>
          ＋ Додати фото
        </button>
      </div>
      {type === 'download' && (
        <div className="field">
          <label>
            Файли для покупця <span className="dim">(до {MAX_DIGITAL_FILES}, кожен до 20 МБ)</span>
          </label>
          <SlotList items={files} onChange={(v) => (setFiles(v), touched())} ordered={false} readOnly={false} />
          <button className="btn small add-files" disabled={files.length >= MAX_DIGITAL_FILES} onClick={() => void pick('files')}>
            ＋ Додати файли
          </button>
        </div>
      )}
      {sendProblems.length > 0 ? (
        <div className="hint problems" data-testid="create-problems">
          Щоб надіслати на Etsy, ще потрібно:
          <ul>
            {sendProblems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      ) : (
        publishProblems.length > 0 && (
          <div className="hint" data-testid="publish-problems">
            Можна надіслати як чернетку. {publishProblems.join(' ')}
          </div>
        )
      )}
      {error && (
        <div className="test-result err" role="alert">
          {error}
        </div>
      )}
      {savedNote && <div className="test-result ok">{savedNote}</div>}
      {busy && progress && (
        <div className="hint" role="status">
          {progress.label}
        </div>
      )}
      <div className="settings-actions wrap">
        <button className="btn" disabled={busy} onClick={() => void onSave()}>
          Зберегти чернетку
        </button>
        <button className="btn" disabled={busy || sendProblems.length > 0} onClick={() => void onSend(false)}>
          Надіслати на Etsy як чернетку
        </button>
        <button
          className="btn primary"
          disabled={busy || publishProblems.length > 0}
          title={publishProblems.length && !sendProblems.length ? publishProblems.join(' ') : undefined}
          onClick={() => void onSend(true)}
        >
          {busy ? 'Надсилаю…' : 'Надіслати й опублікувати'}
        </button>
        {current && (
          <button className="btn danger" disabled={busy} onClick={() => void onDelete()}>
            Видалити
          </button>
        )}
      </div>
    </div>
  )
}

function DraftList(): JSX.Element {
  const { drafts, openDrafts } = useStore()
  return (
    <div data-testid="draft-list">
      <p className="hint">
        Лістинги, підготовлені в програмі — вами або Claude (через MCP). Перевірте й надішліть на Etsy: як чернетку
        або одразу з публікацією.
      </p>
      <div className="settings-actions">
        <button className="btn primary" onClick={() => openDrafts({ draftId: null })}>
          ＋ Нова чернетка
        </button>
      </div>
      {drafts.length === 0 ? (
        <div className="hint">Чернеток ще немає.</div>
      ) : (
        <ul className="my-listings">
          {drafts.map((d) => (
            <li key={d.id}>
              {d.photos[0] ? <img src={`etsyimg://draft/${d.photos[0].id}`} alt="" /> : <span className="thumb-empty" />}
              <div className="my-listing-text">
                <div className="my-listing-title">
                  {d.fields.title || '(без назви)'}
                  {d.source === 'mcp' && <span className="mcp-badge">від Claude</span>}
                </div>
                <div className="dim">
                  {DRAFT_STATUS[d.status]}
                  {d.sentListingId != null && ` (#${d.sentListingId})`}
                  {d.status !== 'sent' && d.problems.length > 0 && ` · ще потрібно: ${d.problems.length}`}
                  {` · ${formatDateTime(d.updatedAt)}`}
                </div>
              </div>
              <button className="btn small" onClick={() => openDrafts({ draftId: d.id })}>
                {d.status === 'sent' ? 'Переглянути' : 'Відкрити'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * "📝 Чернетки" / "＋ Новий лістинг" (own shop): listing drafts kept in the
 * app, prepared here or by Claude over MCP, reviewed and sent to Etsy.
 */
export function DraftsModal(): JSX.Element | null {
  const { draftsView, openDrafts, drafts } = useStore()
  const close = (): void => openDrafts(null)
  useEscape(close, draftsView != null)
  if (draftsView == null) return null
  const editing = draftsView !== 'list'
  const draft = editing && draftsView.draftId != null ? (drafts.find((d) => d.id === draftsView.draftId) ?? null) : null
  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal my-shop-modal" role="dialog" aria-labelledby="drafts-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="drafts-title">{!editing ? 'Чернетки лістингів' : draft ? 'Чернетка' : 'Новий лістинг'}</h2>
        {editing ? (
          <>
            <div className="editor-head">
              <button className="btn small" onClick={() => openDrafts('list')}>
                ← До чернеток
              </button>
            </div>
            <DraftEditor key={draft?.id ?? 'new'} draft={draft} onBack={() => openDrafts('list')} />
          </>
        ) : (
          <DraftList />
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
