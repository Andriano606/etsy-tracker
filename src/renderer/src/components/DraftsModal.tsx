import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
  MAX_MATERIALS,
  MAX_TAGS,
  TITLE_MAX,
  WHEN_MADE,
  WHO_MADE,
  draftInput,
  newListingProblems,
  splitList
} from '@shared/myShop'
import { formatDateTime } from '@shared/format'
import { GLOSSARY, type GlossaryKey } from '@shared/glossary'
import { ownShopId, useStore } from '../store'
import { Badge, Button, Callout, EmptyState, Field, Icon, InfoTip, Modal, Segmented, Term, Toggle, Tooltip, type BadgeTone } from '../ui'
import { LISTING_FEE, SaveBar, UnsavedContext, confirmDiscard, leaveThen, useUnsaved } from './MyShopModal'

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

const STATUS_TONE: Record<ListingDraft['status'], BadgeTone> = { draft: 'info', sent: 'accent', error: 'danger' }
const STATUS_HINT: Record<ListingDraft['status'], string> = {
  draft: 'Збережено лише в програмі. На Etsy ще нічого не надіслано — відкрийте, перевірте й надішліть.',
  sent: 'Товар уже створено на Etsy. Тут лишилась копія для довідки.',
  error: 'Остання спроба надіслати не вдалася. Відкрийте чернетку, щоб побачити причину й спробувати ще раз.'
}

function ClaudeBadge(): JSX.Element {
  return (
    <Badge tone="info" icon="sparkle" hint={GLOSSARY['myshop.fromClaude'].short}>
      від Claude
    </Badge>
  )
}

/**
 * A label row like Field's, for a block that is not a single control (photos, files, a switch group).
 * `heading`: the label is the card's title (a card holding just this block — no second "Фото" above it).
 */
function BlockHead({ label, glossary, aside, heading }: { label: string; glossary?: GlossaryKey; aside?: ReactNode; heading?: boolean }): JSX.Element {
  return (
    <div className={'ui-field-head' + (heading ? ' my-card-head' : '')}>
      {heading ? <h3 className="my-card-title">{label}</h3> : <span className="ui-field-label">{label}</span>}
      {glossary && <InfoTip glossary={glossary} />}
      {aside && <span className="ui-field-aside">{aside}</span>}
    </div>
  )
}

/** Picked/stored photos as cards (the first is the main one; ↑ moves one up) with remove. */
function PhotoList({ items, onChange, readOnly }: { items: Slot[]; onChange: (v: Slot[]) => void; readOnly: boolean }): JSX.Element | null {
  if (!items.length) return null
  const move = (i: number): void => {
    const v = [...items]
    ;[v[i - 1], v[i]] = [v[i], v[i - 1]]
    onChange(v)
  }
  return (
    <ol className="my-photos picked-files">
      {items.map((f, i) => (
        <li key={f.key} className="my-photo">
          {f.preview ? (
            <img className="my-photo-img draft-thumb" src={f.preview} alt="" />
          ) : (
            <span className="my-photo-img my-photo-img--empty" aria-hidden="true">
              <Icon name="image" size={22} />
            </span>
          )}
          {i === 0 && (
            <span className="my-photo-main">
              <Badge tone="accent" solid hint={GLOSSARY['myshop.mainPhoto'].short}>
                головне
              </Badge>
            </span>
          )}
          <div className="my-photo-foot">
            <div className="my-photo-text">
              <span className="picked-name truncate" title={f.name}>
                {f.name}
              </span>
              <span className="dim num">{kb(f.size)}</span>
            </div>
            {!readOnly && (
              <div className="my-photo-actions">
                {i > 0 && <Button size="sm" variant="ghost" icon="arrow-up" iconOnly label={`Вище: ${f.name}`} onClick={() => move(i)} />}
                <Button size="sm" variant="ghost" icon="close" iconOnly label={`Прибрати: ${f.name}`} onClick={() => onChange(items.filter((x) => x !== f))} />
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}

/** The buyer's files (digital listings) as rows with remove. */
function FileList({ items, onChange }: { items: Slot[]; onChange: (v: Slot[]) => void }): JSX.Element | null {
  if (!items.length) return null
  return (
    <ul className="my-files picked-files">
      {items.map((f) => (
        <li key={f.key} className="my-file">
          <Icon name="file" size={16} />
          <span className="picked-name truncate" title={f.name}>
            {f.name}
          </span>
          <span className="dim num">{kb(f.size)}</span>
          <Button size="sm" variant="ghost" icon="close" iconOnly label={`Прибрати: ${f.name}`} onClick={() => onChange(items.filter((x) => x !== f))} />
        </li>
      ))}
    </ul>
  )
}

const TYPE_TEXT: Record<DraftFields['type'], string> = {
  download: 'Покупець отримає файли (шаблон, PDF, картинку) одразу після оплати. Нічого не треба пересилати.',
  physical: 'Річ, яку ви запакуєте й відправите поштою. Потрібен профіль доставки — він налаштовується на Etsy.'
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
  const [busy, setBusy] = useState<null | 'save' | 'draft' | 'publish'>(null)
  // The last failure of this session, said in the save bar next to the clicked button.
  const [error, setError] = useState<{ title: string; text: string } | null>(null)
  const [savedNote, setSavedNote] = useState<string | null>(null)
  // Did the user change anything since the draft was opened / last saved? (Auto-picked profiles don't count.)
  const [edited, setEdited] = useState(false)
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
  const snapshot = JSON.stringify([fields(), keys(photos), keys(files)])
  const [baseline, setBaseline] = useState(snapshot)
  // A save (or a send) stored the form: what is on screen now is the saved state.
  useEffect(() => {
    setBaseline(snapshot)
  }, [current])
  const dirty = !readOnly && edited && snapshot !== baseline
  const lost = dirty
    ? current
      ? 'Зміни в чернетці ще не збережено в програмі — вони пропадуть. Щоб їх зберегти, натисніть «Зберегти чернетку».'
      : 'Нову чернетку ще не збережено — усе, що ви заповнили, пропаде. Щоб її зберегти, натисніть «Зберегти чернетку».'
    : null
  useUnsaved(lost)
  const sendProblems = newListingProblems(draftInput(fields(), keys(photos), keys(files), false))
  const publishProblems = newListingProblems(draftInput(fields(), keys(photos), keys(files), true))

  /** Clears the "saved" note and the last error (a new attempt, or the user changed something). */
  const clearNotes = (): void => {
    setSavedNote(null)
    setError(null)
  }
  /** The user changed the form. */
  const touched = (): void => {
    clearNotes()
    setEdited(true)
  }
  /** An input handler that also clears the "saved" note and the last error. */
  const on = (set: (v: string) => void) => (e: { target: { value: string } }) => {
    set(e.target.value)
    touched()
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
      files: files.map((f) => f.ref)
    })
    if (!res.ok) {
      setError({ title: 'Не вдалося зберегти чернетку', text: res.error })
      return null
    }
    setEdited(false)
    setCurrent(res.value)
    setPhotos(stored(res.value, 'photos'))
    setFiles(stored(res.value, 'files'))
    return res.value
  }

  const onSave = async (): Promise<void> => {
    setBusy('save')
    clearNotes()
    try {
      if (await save()) setSavedNote('Чернетку збережено в програмі.')
    } finally {
      setBusy(null)
    }
  }

  const onSend = async (publish: boolean): Promise<void> => {
    if (
      !(await requestConfirm(
        publish
          ? `Надіслати й опублікувати на Etsy?\nТовар одразу побачать покупці, а Etsy стягне звичайну плату за публікацію (${LISTING_FEE} за 4 місяці).`
          : 'Надіслати на Etsy як чернетку?\nПокупці її не побачать, доки ви не опублікуєте. Плати за це немає.'
      ))
    ) {
      return
    }
    setBusy(publish ? 'publish' : 'draft')
    clearNotes()
    setProgress(null)
    try {
      const d = await save()
      if (!d) return
      const res = await window.api.sendDraft(d.id, publish)
      if (!res.ok) setError({ title: publish ? 'Не вдалося опублікувати на Etsy' : 'Не вдалося надіслати на Etsy', text: res.error })
      const fresh = (await window.api.listDrafts()).find((x) => x.id === d.id)
      if (fresh) setCurrent(fresh)
    } finally {
      setBusy(null)
      setProgress(null)
    }
  }

  const onDelete = async (): Promise<void> => {
    if (!current) return onBack()
    if (!(await requestConfirm('Видалити цю чернетку з програми?\nЇї поля, фото й файли зникнуть звідси. На Etsy нічого не зміниться.'))) return
    await window.api.deleteDraft(current.id)
    onBack()
  }

  /** "До чернеток": asks first when something is unsaved. */
  const leave = async (): Promise<void> => {
    if (lost && !(await confirmDiscard(lost))) return
    onBack()
  }
  const back = (
    <Button variant="ghost" size="sm" icon="chevron-left" onClick={() => void leave()}>
      До чернеток
    </Button>
  )

  if (readOnly && current) {
    return (
      <div data-testid="draft-sent" className="my-sent">
        <div className="my-back">{back}</div>
        <Callout
          tone={current.lastError ? 'error' : 'success'}
          role="status"
          title={current.lastError ? 'Надіслано з проблемою' : current.sentPublished ? 'Товар опубліковано' : 'Чернетку створено на Etsy'}
        >
          {current.lastError
            ? current.lastError
            : `Надіслано на Etsy: товар № ${current.sentListingId} (${current.sentPublished ? 'опубліковано' : 'чернетка на Etsy'}).`}
        </Callout>
        <p className="my-muted">
          {current.sentPublished
            ? 'Він з’явиться серед товарів магазину в програмі після наступного сканування.'
            : 'Далі її видно у вікні «Мій магазин» → «Товари» → «Чернетки» і в кабінеті продавця на Etsy. Опублікувати можна там.'}
        </p>
        <section className="my-card">
          <h3 className="my-card-title draft-title">{current.fields.title || '(без назви)'}</h3>
          <PhotoList items={photos} onChange={() => undefined} readOnly />
        </section>
        <div className="ui-row my-sent-actions">
          {current.sentPublished && shop && (
            <Button
              variant="primary"
              icon="refresh"
              onClick={() => {
                void scanShop(shop.id)
                openDrafts(null)
              }}
            >
              Сканувати магазин зараз
            </Button>
          )}
          <Button icon="trash" onClick={() => void onDelete()}>
            Прибрати з чернеток
          </Button>
        </div>
      </div>
    )
  }

  const currency = shop?.currency
  return (
    <div className="create-listing my-editor" data-testid="draft-form">
      <div className="my-back">
        {back}
        {current && (
          <Button variant="danger" size="sm" icon="trash" disabled={!!busy} tooltip="Видалити чернетку з програми (на Etsy нічого не зміниться)" onClick={() => void onDelete()}>
            Видалити
          </Button>
        )}
      </div>
      {current?.source === 'mcp' && (
        <Callout tone="info" icon="sparkle" role="note" title="Цю чернетку підготував Claude — перевірте перед надсиланням.">
          Помічник заповнив поля на ваше прохання. Прогляньте кожне поле й фото: на Etsy нічого не потрапить, доки ви не
          натиснете «Надіслати».
        </Callout>
      )}
      {current?.lastError && !error && (
        <Callout tone="error" title="Минулого разу не вдалося надіслати">
          Минула спроба надіслати: {current.lastError}
        </Callout>
      )}

      <section className="my-card">
        <BlockHead label="Тип товару" />
        <Segmented
          label="Тип товару"
          value={type}
          onChange={(v) => {
            setType(v)
            if (v === 'physical' && quantity === '999') setQuantity('1')
            touched()
          }}
          options={[
            { value: 'download', label: 'Цифровий', icon: 'download' },
            { value: 'physical', label: 'Фізичний', icon: 'box' }
          ]}
        />
        <p className="ui-field-hint my-type-note">
          <Term glossary={type === 'physical' ? 'physicalProduct' : 'digitalProduct'} />: {TYPE_TEXT[type]}
        </p>
      </section>

      <section className="my-card">
        <h3 className="my-card-title">Основне</h3>
        <Field label="Назва" glossary="myshop.title" aside={<span className="num">{`${title.trim().length}/${TITLE_MAX}`}</span>}>
          <input id="new-title" value={title} onChange={on(setTitle)} />
        </Field>
        <Field label="Опис" glossary="myshop.description" hint="Що це, з чого, які розміри, що саме отримає покупець.">
          <textarea id="new-desc" rows={6} value={description} onChange={on(setDescription)} />
        </Field>
        <div className="ui-form-grid">
          <Field
            label={`Ціна${currency ? `, ${currency}` : ''}`}
            glossary="basePrice"
            hint="Наприклад 5,99 — можна з комою або крапкою. Без податку: Etsy сам додасть його для покупців."
          >
            <input id="new-price" inputMode="decimal" placeholder="5,99" value={price} onChange={on(setPrice)} />
          </Field>
          <Field
            label="Кількість"
            glossary="quantity"
            hint={type === 'physical' ? 'Скільки штук є в наявності.' : 'Скільки разів товар можна купити. Для цифрових зазвичай 999.'}
          >
            <input id="new-qty" inputMode="numeric" value={quantity} onChange={on(setQuantity)} />
          </Field>
        </div>
      </section>

      <section className="my-card">
        <h3 className="my-card-title">Як покупці знайдуть товар</h3>
        <Field
          label="Категорія"
          glossary="category"
          id="new-cat"
          hint={category ? undefined : 'Почніть вводити англійською — назви категорій Etsy англійські, наприклад planner або spreadsheet.'}
          error={taxonomyError ?? undefined}
        >
          {(p) =>
            category ? (
              <div className="chosen-cat my-chosen">
                <Icon name="folder" size={15} />
                <span className="my-chosen-path">{category.path}</span>
                <Button size="sm" onClick={() => (setCategory(null), touched())}>
                  Змінити
                </Button>
              </div>
            ) : (
              <>
                <input
                  {...p}
                  placeholder={taxonomy ? 'Наприклад, planner' : taxonomyError ? 'Категорії недоступні' : 'Завантаження категорій…'}
                  disabled={!taxonomy}
                  value={catQuery}
                  onChange={(e) => setCatQuery(e.target.value)}
                />
                {matches.length > 0 && (
                  <ul className="cat-results my-cat-results" role="listbox" aria-label="Категорії">
                    {matches.map((t) => (
                      <li key={t.id}>
                        <button
                          type="button"
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
                {taxonomy && catQuery.trim().length >= 2 && matches.length === 0 && (
                  <div className="ui-field-hint">Нічого не знайдено. Спробуйте інше слово англійською.</div>
                )}
              </>
            )
          }
        </Field>
        <div className="ui-form-grid">
          <Field label="Теги" glossary="tags" aside={<span className="num">{`${splitList(tags).length}/${MAX_TAGS}`}</span>} hint={GLOSSARY['myshop.tagRules'].short}>
            <input id="new-tags" value={tags} onChange={on(setTags)} />
          </Field>
          <Field
            label="Матеріали"
            glossary="materials"
            aside={<span className="num">{`${splitList(materials).length}/${MAX_MATERIALS}`}</span>}
            hint="Через кому: з чого зроблено товар. Необов’язково."
          >
            <input id="new-materials" value={materials} onChange={on(setMaterials)} />
          </Field>
        </div>
      </section>

      <section className="my-card">
        <h3 className="my-card-title">Про виготовлення</h3>
        <div className="ui-form-grid">
          <Field label="Хто виготовив" glossary="whoMade">
            <select id="new-who" value={whoMade} onChange={on(setWhoMade)}>
              {WHO_MADE.map((w) => (
                <option key={w.value} value={w.value}>
                  {w.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Коли виготовлено" glossary="whenMade" hint="Для цифрових і нових речей — «Виготовляю на замовлення» або нинішні роки.">
            <select id="new-when" value={whenMade} onChange={on(setWhenMade)}>
              {WHEN_MADE.map((w) => (
                <option key={w.value} value={w.value}>
                  {w.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Toggle
          label="Це матеріал чи інструмент для творчості"
          glossary="supply"
          hint="Увімкніть, якщо продаєте не готову річ, а те, з чого її роблять: намистини, тканину, схеми."
          checked={isSupply}
          onChange={(v) => (setIsSupply(v), touched())}
        />
      </section>

      {type === 'physical' && (
        <section className="my-card">
          <h3 className="my-card-title">Доставка</h3>
          {physicalError ? (
            <Callout tone="error" title="Не вдалося прочитати профілі доставки">
              {physicalError}
            </Callout>
          ) : (
            <div className="ui-form-grid">
              <Field
                label="Профіль доставки"
                glossary="shippingProfile"
                hint={shipping && shipping.length === 0 ? 'Профілів ще немає — створіть його на Etsy або у вкладці «Доставка» вікна «Мій магазин».' : undefined}
              >
                <select id="new-shipping" value={shippingId ?? ''} onChange={(e) => (setShippingId(e.target.value ? Number(e.target.value) : null), touched())}>
                  <option value="">{shipping ? (shipping.length ? 'Виберіть…' : 'Немає профілів') : 'Завантаження…'}</option>
                  {shipping?.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Час на підготовку" glossary="processingProfile" hint="Скільки днів вам потрібно, щоб підготувати й відправити замовлення.">
                <select id="new-readiness" value={readinessId ?? ''} onChange={(e) => (setReadinessId(e.target.value ? Number(e.target.value) : null), touched())}>
                  <option value="">{processing ? 'Не вказано' : 'Завантаження…'}</option>
                  {processing?.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}
        </section>
      )}

      <section className="my-card">
        {type === 'download' && <h3 className="my-card-title">Фото і файли</h3>}
        <div className="my-block">
          <BlockHead
            label="Фото"
            heading={type !== 'download'}
            glossary="myshop.photos"
            aside={<span className="num">{`${photos.length}/${MAX_IMAGES}`}</span>}
          />
          <div className="ui-field-hint">JPG, PNG або GIF. Перше фото — головне: його видно в пошуку. Стрілка ↑ піднімає фото вище.</div>
          <PhotoList items={photos} onChange={(v) => (setPhotos(v), touched())} readOnly={false} />
          <div className="ui-row">
            <Button size="sm" icon="plus" disabled={photos.length >= MAX_IMAGES} onClick={() => void pick('images')}>
              Додати фото
            </Button>
          </div>
        </div>
        {type === 'download' && (
          <div className="my-block">
            <BlockHead label="Файли для покупця" glossary="myshop.digitalFiles" aside={<span className="num">{`${files.length}/${MAX_DIGITAL_FILES}`}</span>} />
            <div className="ui-field-hint">До {MAX_DIGITAL_FILES} файлів, кожен до 20 МБ. Покупець завантажить їх одразу після оплати.</div>
            <FileList items={files} onChange={(v) => (setFiles(v), touched())} />
            <div className="ui-row">
              <Button size="sm" icon="plus" disabled={files.length >= MAX_DIGITAL_FILES} onClick={() => void pick('files')}>
                Додати файли
              </Button>
            </div>
          </div>
        )}
      </section>

      <section className="my-card">
        <h3 className="my-card-title">Продаж</h3>
        <Toggle
          label="Автоматично продовжувати"
          glossary="autoRenew"
          hint={`Коли 4 місяці розміщення минуть, Etsy сам поновить товар і візьме ${LISTING_FEE}.`}
          checked={autoRenew}
          onChange={(v) => (setAutoRenew(v), touched())}
        />
      </section>

      {sendProblems.length > 0 ? (
        <div data-testid="create-problems">
          <Callout tone="warn" role="note" title="Щоб надіслати на Etsy, ще потрібно:">
            <ul className="my-bullets">
              {sendProblems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </Callout>
        </div>
      ) : publishProblems.length > 0 ? (
        <div data-testid="publish-problems">
          <Callout tone="info" role="note" title="Можна надіслати як чернетку.">
            {publishProblems.join(' ')}
          </Callout>
        </div>
      ) : (
        <Callout tone="success" role="note" compact>
          Усе заповнено — товар можна одразу опублікувати.
        </Callout>
      )}
      <SaveBar
        error={error}
        status={
          busy && progress ? (
            <span role="status">{progress.label}</span>
          ) : savedNote ? (
            <span className="my-saved">
              <Icon name="check" size={15} />
              <span>{savedNote}</span>
            </span>
          ) : dirty ? (
            'Є незбережені зміни.'
          ) : current ? (
            'Усе збережено в програмі.'
          ) : null
        }
      >
        <Button icon="check" busy={busy === 'save'} disabled={!!busy} tooltip="Зберегти лише в програмі. На Etsy нічого не надсилається." onClick={() => void onSave()}>
          Зберегти чернетку
        </Button>
        <Button
          icon="draft"
          busy={busy === 'draft'}
          disabled={!!busy || sendProblems.length > 0}
          tooltip={sendProblems.length ? 'Спершу заповніть те, що вказано вище.' : GLOSSARY['myshop.sendAsDraft'].short}
          onClick={() => void onSend(false)}
        >
          Надіслати на Etsy як чернетку
        </Button>
        <Button
          variant="primary"
          icon="upload"
          busy={busy === 'publish'}
          disabled={!!busy || publishProblems.length > 0}
          tooltip={publishProblems.length && !sendProblems.length ? publishProblems.join(' ') : GLOSSARY['myshop.publish'].short}
          onClick={() => void onSend(true)}
        >
          Надіслати й опублікувати
        </Button>
      </SaveBar>
    </div>
  )
}

function DraftList(): JSX.Element {
  const { drafts, openDrafts } = useStore()
  const add = (
    <Button variant="primary" icon="plus" onClick={() => openDrafts({ draftId: null })}>
      Нова чернетка
    </Button>
  )
  return (
    <div data-testid="draft-list" className="my-drafts">
      <p className="my-lead">
        Заготовки нових <Term glossary="listing">товарів</Term>, які зберігаються лише на цьому комп’ютері. Їх готуєте ви або
        помічник <Term glossary="claude" />. Перевірте й надішліть на Etsy — як чернетку або одразу з публікацією.
      </p>
      {drafts.length === 0 ? (
        <EmptyState icon="draft" title="Чернеток ще немає" action={add}>
          Створіть першу — заповніть назву, ціну й фото, а надіслати на Etsy можна будь-коли пізніше.
        </EmptyState>
      ) : (
        <>
          <div className="my-toolbar">
            <span className="my-count num">Чернеток: {drafts.length}</span>
            {add}
          </div>
          <ul className="my-listings my-rows">
            {drafts.map((d) => (
              <li key={d.id} className="my-row">
                {d.photos[0] ? (
                  <img className="my-thumb my-thumb--md" src={`etsyimg://draft/${d.photos[0].id}`} alt="" />
                ) : (
                  <span className="my-thumb my-thumb--md my-thumb--empty" aria-hidden="true">
                    <Icon name="image" size={20} />
                  </span>
                )}
                <div className="my-listing-text my-row-main">
                  <div className="my-row-titleline">
                    <span className="my-listing-title my-row-title truncate" title={d.fields.title}>
                      {d.fields.title || '(без назви)'}
                    </span>
                    {d.source === 'mcp' && <ClaudeBadge />}
                  </div>
                  <div className="my-meta">
                    <Badge tone={STATUS_TONE[d.status]} hint={STATUS_HINT[d.status]}>
                      {DRAFT_STATUS[d.status]}
                    </Badge>
                    {d.sentListingId != null && <span className="dim num">товар № {d.sentListingId}</span>}
                    {d.status !== 'sent' && d.problems.length > 0 && (
                      <Tooltip content={d.problems.join(' ')}>
                        <span className="my-warn-text" tabIndex={0}>
                          ще потрібно: {d.problems.length}
                        </span>
                      </Tooltip>
                    )}
                    <span className="dim">змінено {formatDateTime(d.updatedAt)}</span>
                  </div>
                </div>
                <Button size="sm" icon={d.status === 'sent' ? 'eye' : 'edit'} onClick={() => openDrafts({ draftId: d.id })}>
                  {d.status === 'sent' ? 'Переглянути' : 'Відкрити'}
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

/**
 * "Чернетки" / "Новий товар" (own shop): listing drafts kept in the app,
 * prepared here or by Claude over MCP, reviewed and sent to Etsy.
 */
export function DraftsModal(): JSX.Element | null {
  const { draftsView, openDrafts, drafts } = useStore()
  // What the open editor would lose; closing the window asks first.
  const unsaved = useRef<string | null>(null)
  const close = (): void => leaveThen(unsaved, () => openDrafts(null))
  if (draftsView == null) return null
  const editing = draftsView !== 'list'
  const draft = editing && draftsView.draftId != null ? (drafts.find((d) => d.id === draftsView.draftId) ?? null) : null
  return (
    <Modal
      title={!editing ? 'Чернетки нових товарів' : draft ? 'Чернетка товару' : 'Новий товар'}
      subtitle={
        !editing
          ? 'Зберігаються в програмі, поки ви не надішлете їх на Etsy.'
          : 'Заповніть поля — підказки ⓘ пояснюють кожне. Зберегти можна будь-коли, навіть неповну.'
      }
      size="lg"
      onClose={close}
      className="my-shop-modal drafts-modal"
    >
      <UnsavedContext.Provider value={unsaved}>
        {editing ? <DraftEditor key={draft?.id ?? 'new'} draft={draft} onBack={() => openDrafts('list')} /> : <DraftList />}
      </UnsavedContext.Provider>
    </Modal>
  )
}
