import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  CreateListingProgress,
  DraftEtsyLink,
  DraftEtsyState,
  DraftFields,
  DraftMediaRef,
  DraftPullSummary,
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
  etsyListingEditUrl,
  etsyListingUrl,
  missingScopes,
  newListingProblems,
  splitList
} from '@shared/myShop'
import { formatDateTime } from '@shared/format'
import { GLOSSARY, type GlossaryKey } from '@shared/glossary'
import { draftPhotoRef } from '@shared/claudeRef'
import { ownShopId, useStore, type ViewerImage } from '../store'
import {
  Badge,
  Button,
  Callout,
  EmptyState,
  Field,
  Icon,
  InfoTip,
  Menu,
  Modal,
  Segmented,
  Term,
  Toggle,
  Tooltip,
  ZoomImage,
  buttonClass,
  type BadgeTone
} from '../ui'
import { LISTING_FEE, SaveBar, UnsavedContext, confirmDiscard, leaveThen, useUnsaved } from './MyShopModal'

/** How many category matches the search shows. */
export const TAXONOMY_RESULTS = 30

const kb = (n: number): string =>
  n >= 1024 * 1024
    ? `${(n / 1024 / 1024).toLocaleString('uk-UA', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} МБ`
    : `${Math.max(1, Math.round(n / 1024))} КБ`

/** A media slot in the form: stored with the draft (with a preview for photos) or freshly picked. */
interface Slot {
  key: string
  name: string
  size: number
  ref: DraftMediaRef
  preview: string | null
  /** A buyer file that exists only on Etsy (pulled from an Etsy draft): no bytes here, no download. */
  remote: boolean
}

/** A stored photo of a draft, as the app serves it (the original bytes — its biggest size). */
const draftPhotoSrc = (mediaId: number): string => `etsyimg://draft/${mediaId}`

const stored = (d: ListingDraft, kind: 'photos' | 'files'): Slot[] =>
  d[kind].map((m) => ({
    key: `m${m.id}`,
    name: m.name,
    size: m.size,
    ref: { mediaId: m.id },
    preview: kind === 'photos' ? draftPhotoSrc(m.id) : null,
    remote: !!m.remote
  }))

/** The id of a slot already stored with the draft (null = freshly picked, not in the app yet). */
const storedId = (s: Slot): number | null => ('mediaId' in s.ref ? s.ref.mediaId : null)

/** What a draft's state chip says: where it is (only here / on Etsy in which state) and whether it is in sync. */
export interface DraftStatusView {
  label: string
  tone: BadgeTone
  hint: string
}

const ETSY_STATE_LABEL: Record<DraftEtsyState, string> = {
  active: 'на Etsy: опубліковано',
  draft: 'на Etsy: чернетка',
  inactive: 'на Etsy: вимкнено',
  expired: 'на Etsy: термін минув',
  sold_out: 'на Etsy: розпродано',
  removed: 'видалено на Etsy'
}
const ETSY_STATE_TONE: Record<DraftEtsyState, BadgeTone> = {
  active: 'accent',
  draft: 'info',
  inactive: 'neutral',
  expired: 'warn',
  sold_out: 'warn',
  removed: 'danger'
}
const ETSY_STATE_HINT: Record<DraftEtsyState, string> = {
  active: 'Товар продається на Etsy. Змініть чернетку тут і натисніть «Оновити на Etsy», щоб змінити й товар.',
  draft: 'На Etsy це чернетка: покупці її не бачать. Її можна оновити звідси або опублікувати.',
  inactive: 'Товар на Etsy вимкнено: покупці його не бачать. Увімкнути знову можна безкоштовно.',
  expired: 'Термін розміщення товару на Etsy минув. Опублікувати знову можна за звичайну плату.',
  sold_out: 'Товар на Etsy розпродано (кількість 0). Опублікувати знову можна за звичайну плату.',
  removed: GLOSSARY['myshop.removedOnEtsy'].short
}

/** The chip of a draft in the list and in the editor's Etsy strip. */
export function draftStatus(d: ListingDraft): DraftStatusView {
  const e = d.etsy
  if (!e) {
    return d.status === 'error'
      ? { label: 'не вдалося надіслати', tone: 'danger', hint: 'Остання спроба надіслати не вдалася. Відкрийте чернетку, щоб побачити причину й спробувати ще раз.' }
      : { label: 'лише в програмі', tone: 'neutral', hint: 'Збережено лише в програмі. На Etsy ще нічого не надіслано — відкрийте, перевірте й надішліть.' }
  }
  if (e.removed || e.state === 'removed') return { label: ETSY_STATE_LABEL.removed, tone: 'danger', hint: ETSY_STATE_HINT.removed }
  if (d.status === 'error')
    return { label: 'не вдалося надіслати', tone: 'danger', hint: 'Остання спроба оновити товар на Etsy не вдалася. Відкрийте чернетку, щоб побачити причину й спробувати ще раз.' }
  if (e.changedOnEtsy) return { label: 'змінено на Etsy', tone: 'warn', hint: GLOSSARY['myshop.changedOnEtsy'].short }
  if (e.dirty || d.status === 'changed')
    return { label: 'є зміни, не надіслані на Etsy', tone: 'warn', hint: 'Чернетку змінено в програмі. Натисніть «Оновити на Etsy», щоб перенести зміни в товар на Etsy.' }
  if (e.state) return { label: ETSY_STATE_LABEL[e.state], tone: ETSY_STATE_TONE[e.state], hint: ETSY_STATE_HINT[e.state] }
  return { label: 'надіслано на Etsy', tone: 'accent', hint: 'Товар уже є на Etsy. Змініть чернетку тут і натисніть «Оновити на Etsy», щоб змінити й його.' }
}

function StatusBadge({ draft }: { draft: ListingDraft }): JSX.Element {
  const v = draftStatus(draft)
  return (
    <Badge tone={v.tone} hint={v.hint}>
      {v.label}
    </Badge>
  )
}

/** "Додано 2, оновлено 1, …" — what the last pull of Etsy's drafts did (and whether some products failed). */
export function pullSummaryText(s: DraftPullSummary): string {
  const failed = s.errors.length > 0
  if (!s.imported && !s.updated && !s.removed && !s.conflicts) {
    return failed ? 'Нічого нового не підтягнуто — з деякими товарами не вийшло (див. нижче).' : 'Нічого нового — усе вже синхронізовано.'
  }
  const parts = [`Додано ${s.imported}`, `оновлено ${s.updated}`]
  if (s.removed) parts.push(`видалено на Etsy ${s.removed}`)
  if (s.conflicts) parts.push(`змінено і тут, і на Etsy ${s.conflicts}`)
  return parts.join(', ') + '.' + (failed ? ' З деякими товарами не вийшло (див. нижче).' : '')
}

function ClaudeBadge(): JSX.Element {
  return (
    <Badge tone="info" icon="sparkle" hint={GLOSSARY['myshop.fromClaude'].short}>
      від Claude
    </Badge>
  )
}

function EtsyBadge(): JSX.Element {
  return (
    <Badge tone="neutral" icon="store" hint={GLOSSARY['myshop.fromEtsy'].short}>
      з Etsy
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

/**
 * Picked/stored photos as cards (the first is the main one; ↑ moves one up) with remove.
 * `draftId` = the stored draft they belong to: its stored photos carry a "Копіювати для Claude"
 * reference in the viewer (a freshly picked one isn't in the app yet — none).
 */
function PhotoList({
  items,
  onChange,
  readOnly,
  draftId
}: {
  items: Slot[]
  onChange: (v: Slot[]) => void
  readOnly: boolean
  draftId: number | null
}): JSX.Element | null {
  if (!items.length) return null
  const move = (i: number): void => {
    const v = [...items]
    ;[v[i - 1], v[i]] = [v[i], v[i - 1]]
    onChange(v)
  }
  // Every photo with a preview opens in the viewer, as a gallery of the draft's photos.
  const shown = items.filter((f) => f.preview)
  const gallery: ViewerImage[] = shown.map((f) => {
    const mediaId = storedId(f)
    return { src: f.preview!, alt: f.name, caption: f.name, ref: draftId != null && mediaId != null ? draftPhotoRef(draftId, mediaId) : undefined }
  })
  return (
    <ol className="my-photos picked-files">
      {items.map((f, i) => (
        <li key={f.key} className="my-photo">
          {f.preview ? (
            <ZoomImage
              src={f.preview}
              alt={f.name}
              gallery={gallery}
              index={shown.indexOf(f)}
              className="draft-photo-zoom"
              imgClassName="my-photo-img draft-thumb"
            />
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

/** How long "Збережено: …" stays under the files. */
export const DOWNLOAD_NOTE_MS = 8000

/**
 * The buyer's files (digital listings) as rows: a stored file can be saved to
 * the computer (download — the app keeps the bytes); in the editor each can be
 * removed (`onChange`; absent = read-only). A freshly picked file is still on
 * the disk, so it has no download; a file pulled from an Etsy draft exists only
 * on Etsy (Etsy's API gives no download of buyer files) — "лише на Etsy".
 */
function FileList({ items, onChange }: { items: Slot[]; onChange?: (v: Slot[]) => void }): JSX.Element | null {
  const [busy, setBusy] = useState<number | null>(null)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => {
    if (!note?.ok) return
    const t = setTimeout(() => setNote(null), DOWNLOAD_NOTE_MS)
    return () => clearTimeout(t)
  }, [note])
  if (!items.length) return null
  const downloads = items.some((f) => storedId(f) != null && !f.remote)

  const download = async (id: number): Promise<void> => {
    setBusy(id)
    try {
      const res = await window.api.saveDraftMedia(id)
      if (!res.ok) setNote({ ok: false, text: `Не вдалося зберегти файл: ${res.error}` })
      else if (res.value) setNote({ ok: true, text: `Збережено: ${res.value.path}` })
      // null = the save dialog was cancelled: nothing to say.
    } catch (e) {
      setNote({ ok: false, text: `Не вдалося зберегти файл: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="draft-files">
      <ul className="my-files picked-files">
        {items.map((f) => {
          const id = storedId(f)
          return (
            <li key={f.key} className="my-file">
              <Icon name="file" size={16} />
              <span className="picked-name truncate" title={f.name}>
                {f.name}
              </span>
              {f.remote && (
                <Badge tone="info" icon="store" hint={GLOSSARY['myshop.remoteFile'].short}>
                  лише на Etsy
                </Badge>
              )}
              <span className="dim num my-file-size">{kb(f.size)}</span>
              {/* Keeps the sizes and × in one column when some rows have a download and others don't. */}
              {(id == null || f.remote) && downloads && <span className="my-file-slot" aria-hidden="true" />}
              {id != null && !f.remote && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon="download"
                  iconOnly
                  label={`Завантажити файл «${f.name}»`}
                  busy={busy === id}
                  disabled={busy != null && busy !== id}
                  onClick={() => void download(id)}
                />
              )}
              {onChange && (
                <Button size="sm" variant="ghost" icon="close" iconOnly label={`Прибрати: ${f.name}`} onClick={() => onChange(items.filter((x) => x !== f))} />
              )}
            </li>
          )
        })}
      </ul>
      {note &&
        (note.ok ? (
          <p className="draft-dl-note" role="status">
            <Icon name="check" size={14} />
            <span>{note.text}</span>
          </p>
        ) : (
          <p className="draft-dl-note is-error" role="alert">
            <Icon name="error" size={14} />
            <span>{note.text}</span>
          </p>
        ))}
    </div>
  )
}

/**
 * Where the linked listing is on Etsy. The public page exists only while it is
 * published; the seller's listing editor (drafts too) opens for the owner.
 */
function EtsyLinks({ link }: { link: DraftEtsyLink }): JSX.Element {
  const open = (url: string) => () => void window.api.openExternal(url)
  const page = link.state === 'active' ? (link.url ?? etsyListingUrl(link.listingId)) : null
  return (
    <div className="draft-next" data-testid="draft-etsy-links">
      <div className="ui-row draft-next-actions">
        {page && (
          <Button size="sm" icon="external" tooltip="Сторінка товару на Etsy — так його бачать покупці." onClick={open(page)}>
            Відкрити на Etsy
          </Button>
        )}
        <Button
          size="sm"
          icon="edit"
          tooltip="Редактор товару в кабінеті продавця на Etsy: там можна змінити будь-що й опублікувати."
          onClick={open(link.editUrl || etsyListingEditUrl(link.listingId))}
        >
          Редагувати на Etsy
        </Button>
      </div>
      <p className="ui-field-hint draft-next-hint">
        Відкривається в браузері. Редактор Etsy покаже товар, якщо на etsy.com ви увійшли як власник цього магазину.
      </p>
    </div>
  )
}

/** The editor's strip about the linked Etsy listing: its state, links, whether this draft is ahead of it. */
function DraftLinkStrip({ draft, unsent, otherShop }: { draft: ListingDraft; unsent: boolean; otherShop: boolean }): JSX.Element {
  const link = draft.etsy!
  const removed = link.removed || link.state === 'removed'
  return (
    <section className="my-card draft-link" data-testid="draft-link" aria-label="Товар на Etsy">
      <div className="draft-link-head">
        <Icon name="store" size={16} />
        <span className="draft-link-title">
          Товар на Etsy <span className="num">№ {link.listingId}</span>
        </span>
        <InfoTip glossary="myshop.linkedDraft" />
        <StatusBadge draft={draft} />
        {draft.source === 'etsy' && <EtsyBadge />}
      </div>
      {(link.syncedAt != null || (unsent && !removed)) && (
        <div className="my-meta draft-link-meta">
          {link.syncedAt != null && <span className="dim">синхронізовано {formatDateTime(link.syncedAt)}</span>}
          {unsent && !removed && (
            <span className="my-warn-text" data-testid="draft-unsent">
              є незбережені на Etsy зміни
            </span>
          )}
        </div>
      )}
      {!removed && link.unverified && (
        <p className="ui-field-hint" data-testid="draft-unverified">
          Цю чернетку надіслала старіша версія програми, тож її ще не порівнювали з товаром на Etsy. Перше «Оновити на Etsy» спершу
          спитає, чи перезаписати товар на Etsy — раптом його там змінювали.
        </p>
      )}
      {!removed && link.incomplete && (
        <p className="ui-field-hint" data-testid="draft-incomplete">
          Не всі фото чи файли цього товару вдалося підтягнути з Etsy. Під час оновлення їх не буде видалено з Etsy, а наступна
          синхронізація спробує підтягнути їх ще раз.
        </p>
      )}
      {otherShop && (
        <Callout tone="warn" compact title="Товар іншого магазину">
          Цей товар належить іншому магазину Etsy{link.shopId != null ? ` (№ ${link.shopId})` : ''}, ніж той, у який ви зараз увійшли.
          Оновити чи видалити його на Etsy звідси не вийде — увійдіть в акаунт того магазину.
        </Callout>
      )}
      {!removed && <EtsyLinks link={link} />}
    </section>
  )
}

/** What a send does: a new Etsy draft / a new published listing (or, linked, update + publish) / update the linked listing. */
type SendMode = 'draft' | 'publish' | 'update'

interface SendResultView {
  listingId: number
  published: boolean
  /** The linked listing was updated (no new one). */
  updated: boolean
  /** The listing's state on Etsy after the send (null = not known). */
  state: DraftEtsyState | null
  /** This send published it (it wasn't active before). */
  publishedNow: boolean
  /** This send switched an inactive listing back on. */
  reactivated: boolean
}

const HIDDEN_STATE_TEXT: Partial<Record<DraftEtsyState, string>> = {
  inactive: 'вимкнений',
  expired: 'з терміном, що минув',
  sold_out: 'розпроданий'
}

/** Right after a successful send: what happened on Etsy, and (published) a rescan to see it in the app. */
function SendResult({ result, onScan }: { result: SendResultView; onScan: (() => void) | null }): JSX.Element {
  const title = result.updated
    ? result.publishedNow
      ? result.reactivated
        ? 'Товар на Etsy оновлено й увімкнено'
        : 'Товар на Etsy оновлено й опубліковано'
      : 'Товар на Etsy оновлено'
    : result.published
      ? 'Товар опубліковано'
      : 'Чернетку створено на Etsy'
  const hidden = result.state ? HIDDEN_STATE_TEXT[result.state] : undefined
  const where = result.published
    ? 'У списку товарів магазину в програмі зміни з’являться після наступного сканування.'
    : hidden
      ? `На Etsy це ${hidden} товар: покупці його не бачать. Його видно в кабінеті продавця на Etsy («Редагувати на Etsy»).`
      : result.state === 'draft' || (!result.updated && result.state == null)
        ? 'Цю чернетку видно у вікні «Мій магазин» → «Товари» → «Чернетки» і в кабінеті продавця на Etsy.'
        : 'Його видно в кабінеті продавця на Etsy («Редагувати на Etsy»).'
  return (
    <div data-testid="draft-sent" className="draft-result">
      <Callout tone="success" role="status" title={title}>
        {result.updated
          ? `Товар № ${result.listingId} на Etsy тепер такий, як ця чернетка.`
          : `Надіслано на Etsy: товар № ${result.listingId} (${result.published ? 'опубліковано' : 'чернетка на Etsy'}).`}{' '}
        {where}
      </Callout>
      {result.published && onScan && (
        <div className="ui-row">
          <Button size="sm" icon="refresh" onClick={onScan}>
            Сканувати магазин зараз
          </Button>
        </div>
      )}
    </div>
  )
}

const TYPE_TEXT: Record<DraftFields['type'], string> = {
  download: 'Покупець отримає файли (шаблон, PDF, картинку) одразу після оплати. Нічого не треба пересилати.',
  physical: 'Річ, яку ви запакуєте й відправите поштою. Потрібен профіль доставки — він налаштовується на Etsy.'
}

/**
 * One draft: edited here, saved in the app, then sent to Etsy (as an Etsy
 * draft or published). A sent draft stays linked to its Etsy listing and stays
 * editable: "Оновити на Etsy" makes that listing match the draft again.
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
  const [busy, setBusy] = useState<null | 'save' | SendMode | 'delete'>(null)
  // The last failure of this session, said in the save bar next to the clicked button.
  const [error, setError] = useState<{ title: string; text: string } | null>(null)
  const [savedNote, setSavedNote] = useState<string | null>(null)
  // What the last send did (shown next to the save bar) and what it couldn't fully do.
  const [result, setResult] = useState<SendResultView | null>(null)
  const [notes, setNotes] = useState<string[]>([])
  // The notes and the send result sit above the save bar, below the whole form: bring them into view when they
  // appear, or a send started from the top of a long draft would say nothing visible (e.g. a kept conflict).
  const outcome = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (notes.length || result) outcome.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [notes, result])
  // Did the user change anything since the draft was opened / last saved? (Auto-picked profiles don't count.)
  const [edited, setEdited] = useState(false)
  // The latest known link state and status of this draft: from main's answers (save, send, unlink) and from
  // drafts:changed pushes (e.g. a pull from Etsy while it is open) — whichever came last. Kept apart from
  // `current` so a push never resets the form's "unsaved" baseline.
  const [live, setLive] = useState<ListingDraft | null>(draft)
  const liveId = live?.id ?? null
  const pushed = useStore((s) => (liveId != null ? s.drafts.find((d) => d.id === liveId) : undefined))
  useEffect(() => {
    if (!pushed) return
    setLive(pushed)
    // Changed meanwhile (a pull from Etsy, Claude) while the form holds nothing of the user's own:
    // show the new version — a send must never go out with the old one.
    if (current && !busy && !formChanged && pushed.updatedAt !== current.updatedAt) reload(pushed)
  }, [pushed])
  const link = live?.etsy ?? null
  const removed = !!link && (link.removed || link.state === 'removed')
  const active = link?.state === 'active'
  const inactive = link?.state === 'inactive'
  const signedInShop = etsyAuth?.loggedIn ? (etsyAuth.shopId ?? null) : null
  // The listing belongs to another shop than the signed-in one (signed in with another account).
  const otherShop = !!link && link.shopId != null && signedInShop != null && link.shopId !== signedInShop

  useEffect(() => {
    void window.api.getTaxonomy().then((r) => (r.ok ? setTaxonomy(r.value) : setTaxonomyError(r.error)))
    return window.api.onCreateListingProgress(setProgress)
  }, [])

  useEffect(() => {
    if (type !== 'physical' || shipping) return
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
  }, [type, shipping, shippingId, readinessId])

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
  // The form differs from the stored draft (also an auto-picked profile): a send saves it first.
  const formChanged = snapshot !== baseline
  const dirty = edited && formChanged
  // The draft changed in the app while the user edits it (e.g. a pull from Etsy): saving asks first.
  const changedMeanwhile = dirty && !!current && !!live && live.updatedAt !== current.updatedAt
  const saveLabel = link ? 'Зберегти в програмі' : 'Зберегти чернетку'
  const lost = dirty
    ? current
      ? `Зміни в чернетці ще не збережено в програмі — вони пропадуть. Щоб їх зберегти, натисніть «${saveLabel}».`
      : 'Нову чернетку ще не збережено — усе, що ви заповнили, пропаде. Щоб її зберегти, натисніть «Зберегти чернетку».'
    : null
  useUnsaved(lost)
  const sendProblems = newListingProblems(draftInput(fields(), keys(photos), keys(files), false))
  const publishProblems = newListingProblems(draftInput(fields(), keys(photos), keys(files), true))
  // Updating a published listing has to keep it publishable (main checks the same).
  const updateProblems = active ? publishProblems : sendProblems
  // Local edits that the Etsy listing doesn't have yet (saved here, or still in the form).
  const unsent = !!link && (dirty || link.dirty || live?.status === 'changed')

  /** Clears the "saved" note, the last error and the last send's result (a new attempt, or the user changed something). */
  const clearNotes = (): void => {
    setSavedNote(null)
    setError(null)
    setResult(null)
    setNotes([])
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
    const slots = picked.map((p) => ({ key: `t${p.token}`, name: p.name, size: p.size, ref: { token: p.token }, preview: null, remote: false }))
    if (kind === 'images') setPhotos((v) => [...v, ...slots])
    else setFiles((v) => [...v, ...slots])
    touched()
  }

  /** Shows a draft main returned (after a save, a send, an unlink): the stored media replace the picked slots. */
  const show = (d: ListingDraft): void => {
    setEdited(false)
    setCurrent(d)
    setLive(d)
    setPhotos(stored(d, 'photos'))
    setFiles(stored(d, 'files'))
  }

  /** Shows another stored version of the draft (e.g. pulled from Etsy meanwhile): every field of the form, its media, its link. */
  const reload = (d: ListingDraft): void => {
    const f = d.fields
    setType(f.type)
    setTitle(f.title)
    setDescription(f.description)
    setPrice(f.price)
    setQuantity(String(f.quantity))
    setCategory(f.taxonomyId != null ? { id: f.taxonomyId, path: f.taxonomyPath ?? `Категорія #${f.taxonomyId}` } : null)
    setWhoMade(f.whoMade)
    setWhenMade(f.whenMade)
    setIsSupply(f.isSupply)
    setTags(f.tags.join(', '))
    setMaterials(f.materials.join(', '))
    setAutoRenew(f.shouldAutoRenew)
    setShippingId(f.shippingProfileId)
    setReadinessId(f.readinessStateId)
    show(d)
  }

  /**
   * Save in the app; the stored media replace the picked slots. A draft changed
   * since it was opened (e.g. a pull brought Etsy's changes) is not overwritten
   * unless the user agrees.
   */
  const save = async (): Promise<ListingDraft | null> => {
    const input = {
      ...(current ? { id: current.id } : {}),
      fields: fields(),
      photos: photos.map((p) => p.ref),
      files: files.map((f) => f.ref)
    }
    let res = await window.api.saveDraft(current ? { ...input, expectedUpdatedAt: current.updatedAt } : input)
    if (!res.ok && res.stale) {
      const overwrite = await requestConfirm(
        'Записати ваші зміни поверх?\nПоки чернетка була відкрита, її змінили — наприклад, синхронізація з Etsy підтягнула зміни, зроблені на Etsy. Якщо записати, у чернетці буде те, що зараз у формі, а ті зміни пропадуть (і з Etsy теж, коли ви оновите товар).',
        { title: 'Чернетку змінили', confirmLabel: 'Записати мої зміни', danger: true }
      )
      if (!overwrite) {
        setError({
          title: 'Чернетку не збережено',
          text: 'Ваші зміни лишились у формі. Щоб побачити нову версію, поверніться до списку чернеток і відкрийте її знову (зміни у формі тоді пропадуть).'
        })
        return null
      }
      res = await window.api.saveDraft(input)
    }
    if (!res.ok) {
      setError({ title: 'Не вдалося зберегти чернетку', text: res.error })
      return null
    }
    show(res.value)
    return res.value
  }

  /** Re-reads the draft after a send (its link, status, error); null = it is gone. */
  const refresh = async (id: number): Promise<void> => {
    const fresh = (await window.api.listDrafts()).find((x) => x.id === id)
    if (fresh) show(fresh)
  }

  const onSave = async (): Promise<void> => {
    setBusy('save')
    clearNotes()
    try {
      if (await save()) setSavedNote(link && !removed ? 'Збережено в програмі. Щоб змінити й товар на Etsy, натисніть «Оновити на Etsy».' : 'Чернетку збережено в програмі.')
    } finally {
      setBusy(null)
    }
  }

  /**
   * One send to Etsy and what it answered: a conflict asks whether to overwrite
   * Etsy's changes (and sends again with overwrite), notes are shown, the draft re-read.
   */
  const send = async (id: number, mode: SendMode, wasLinked: boolean, expectedUpdatedAt?: number): Promise<void> => {
    const publish = mode === 'publish'
    const wasInactive = link?.state === 'inactive'
    const unverified = !!link?.unverified
    let res = await window.api.sendDraft(id, publish, expectedUpdatedAt != null ? { expectedUpdatedAt } : undefined)
    if (!res.ok && res.stale) {
      setError({ title: 'Чернетку змінили', text: res.error })
      await refresh(id)
      return
    }
    if (!res.ok && res.conflict) {
      const overwrite = await requestConfirm(
        unverified ? `Перезаписати товар на Etsy?\n${res.error}` : `Перезаписати зміни, зроблені на Etsy?\n${res.error}`,
        {
          title: unverified ? 'Товар ще не порівнювали з Etsy' : 'Товар змінили на Etsy',
          confirmLabel: 'Перезаписати на Etsy',
          danger: true
        }
      )
      if (!overwrite) {
        setNotes(['Товар на Etsy не змінено: зміни, зроблені там, лишились. Перегляньте їх на Etsy й перенесіть потрібне в чернетку.'])
        await refresh(id)
        return
      }
      res = await window.api.sendDraft(id, publish, { overwrite: true })
    }
    const said = [...(res.ok ? res.warnings : []), ...(res.notes ?? [])]
    setNotes(said)
    if (!res.ok) {
      setError({
        title: res.removedOnEtsy
          ? 'Товару на Etsy більше немає'
          : wasLinked
            ? 'Не вдалося оновити товар на Etsy'
            : publish
              ? 'Не вдалося опублікувати на Etsy'
              : 'Не вдалося надіслати на Etsy',
        text: res.error
      })
    } else {
      setResult({
        listingId: res.listingId,
        published: res.published,
        updated: !!res.updated || wasLinked,
        state: res.state ?? null,
        publishedNow: publish && res.published,
        reactivated: publish && res.published && wasInactive
      })
    }
    await refresh(id)
  }

  const confirmSend = (mode: SendMode): Promise<boolean> => {
    if (!link) {
      return requestConfirm(
        mode === 'publish'
          ? `Надіслати й опублікувати на Etsy?\nТовар одразу побачать покупці, а Etsy стягне звичайну плату за публікацію (${LISTING_FEE} за 4 місяці).`
          : 'Надіслати на Etsy як чернетку?\nПокупці її не побачать, доки ви не опублікуєте. Плати за це немає.'
      )
    }
    if (mode === 'update') {
      return requestConfirm(
        `Оновити товар на Etsy?\nНазва, опис, ціна, фото й файли товару № ${link.listingId} на Etsy стануть такими, як у цій чернетці.${active ? ' Покупці одразу побачать зміни.' : ''} Плати за це немає.`,
        { title: 'Оновити на Etsy', confirmLabel: 'Оновити на Etsy' }
      )
    }
    return requestConfirm(
      link.state === 'inactive'
        ? 'Оновити й знову ввімкнути товар?\nТовар на Etsy стане таким, як ця чернетка, і знову з’явиться в магазині. Увімкнути вимкнений товар безкоштовно, поки не минув термін розміщення.'
        : `Оновити й опублікувати товар?\nТовар на Etsy стане таким, як ця чернетка, і його одразу побачать покупці. Etsy стягне звичайну плату за публікацію (${LISTING_FEE} за 4 місяці).`,
      link.state === 'inactive'
        ? { title: 'Оновити й увімкнути', confirmLabel: 'Оновити й увімкнути' }
        : { title: 'Оновити й опублікувати', confirmLabel: 'Оновити й опублікувати' }
    )
  }

  const onSend = async (mode: SendMode): Promise<void> => {
    if (!(await confirmSend(mode))) return
    setBusy(mode)
    clearNotes()
    setProgress(null)
    try {
      // Nothing changed in the form: send the stored draft as it is (a save would rewrite it with what the form
      // shows) — and only if it is still the version on screen.
      const d = current && !formChanged ? current : await save()
      if (!d) return
      await send(d.id, mode, d.etsy != null || link != null, d.updatedAt)
    } finally {
      setBusy(null)
      setProgress(null)
    }
  }

  /** The Etsy listing is gone: forget the link, then send the draft as a new listing (an Etsy draft — free). */
  const onSendAsNew = async (): Promise<void> => {
    if (!current || !link) return
    if (
      !(await requestConfirm(
        `Надіслати як новий товар?\nТовару № ${link.listingId} на Etsy більше немає. Програма забуде старий зв’язок і створить на Etsy новий товар — як чернетку, без плати. Опублікувати його можна буде потім.`,
        { title: 'Надіслати як новий товар', confirmLabel: 'Надіслати як новий' }
      ))
    ) {
      return
    }
    setBusy('draft')
    clearNotes()
    setProgress(null)
    try {
      const d = await save()
      if (!d) return
      const un = await window.api.unlinkDraft(d.id)
      if (!un.ok) {
        setError({ title: 'Не вдалося від’єднати чернетку від Etsy', text: un.error })
        return
      }
      show(un.value)
      if (un.value.problems.length) {
        // E.g. the buyer files that existed only on Etsy are gone with the link.
        setNotes([...(un.value.notes ?? []), 'Чернетку від’єднано від Etsy, але щоб надіслати її, ще потрібно: ' + un.value.problems.join(' ')])
        return
      }
      const unlinkNotes = un.value.notes ?? []
      await send(d.id, 'draft', false, un.value.updatedAt)
      if (unlinkNotes.length) setNotes((n) => [...unlinkNotes, ...n])
    } finally {
      setBusy(null)
      setProgress(null)
    }
  }

  /** Deletes the draft in the app, or (onEtsy) the Etsy listing too; failures stay in the save bar. */
  const remove = async (onEtsy: boolean): Promise<void> => {
    if (!current) return onBack()
    const n = link?.listingId
    const ok = onEtsy
      ? await requestConfirm(
          `Видалити товар і на Etsy?\nТовар № ${n} зникне з вашого магазину на Etsy разом із фото й файлами, а чернетка — з програми. Цього не можна скасувати.`,
          { title: 'Видалити і на Etsy', confirmLabel: 'Видалити назавжди', danger: true }
        )
      : link && !removed
        ? await requestConfirm(
            `Видалити чернетку лише з програми?\nТовар № ${n} на Etsy лишиться як є. Якщо на Etsy це чернетка, наступна синхронізація з Etsy знову додасть її сюди.`,
            { title: 'Видалити з програми', confirmLabel: 'Видалити з програми', danger: true }
          )
        : await requestConfirm('Видалити цю чернетку з програми?\nЇї поля, фото й файли зникнуть звідси. На Etsy нічого не зміниться.', {
            title: 'Видалити чернетку',
            confirmLabel: 'Видалити чернетку',
            danger: true
          })
    if (!ok) return
    setBusy('delete')
    clearNotes()
    try {
      const res = onEtsy ? await window.api.deleteDraft(current.id, { onEtsy: true }) : await window.api.deleteDraft(current.id)
      if (!res.ok) {
        setError({ title: onEtsy ? 'Не вдалося видалити товар на Etsy' : 'Не вдалося видалити чернетку', text: res.error })
        return
      }
      onBack()
    } finally {
      setBusy(null)
    }
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

  // Why "Видалити і на Etsy" can't work with this sign-in (main would refuse after the red confirm).
  const deleteOnEtsyBlocked = !etsyAuth?.loggedIn
    ? 'Щоб видалити товар на Etsy, спершу увійдіть в Etsy у вікні «Мій магазин».'
    : otherShop
      ? 'Товар належить іншому магазину Etsy — увійдіть в акаунт того магазину.'
      : missingScopes(etsyAuth.scopes, ['listings_d']).length
        ? 'Вхід в Etsy не має дозволу видаляти товари — вийдіть і увійдіть в Etsy ще раз («Керувати» → «Вийти»).'
        : null
  const deleteControl = !current ? null : link && !removed ? (
    <Menu
      label="Видалити"
      buttonClassName={buttonClass('danger', 'sm', 'draft-delete-menu')}
      disabled={!!busy}
      trigger={
        <>
          <Icon name="trash" size={14} />
          <span className="ui-btn-text">Видалити</span>
        </>
      }
      items={[
        {
          id: 'local',
          icon: 'trash',
          label: 'Видалити лише в програмі',
          hint: 'Товар на Etsy лишиться як є.',
          onSelect: () => void remove(false)
        },
        {
          id: 'etsy',
          icon: 'trash',
          danger: true,
          label: 'Видалити і на Etsy',
          disabled: !!deleteOnEtsyBlocked,
          hint: deleteOnEtsyBlocked ?? GLOSSARY['myshop.deleteOnEtsy'].short,
          onSelect: () => void remove(true)
        }
      ]}
    />
  ) : (
    <Button variant="danger" size="sm" icon="trash" disabled={!!busy} tooltip="Видалити чернетку з програми (на Etsy нічого не зміниться)" onClick={() => void remove(false)}>
      Видалити
    </Button>
  )

  const currency = shop?.currency
  return (
    <div className="create-listing my-editor" data-testid="draft-form">
      <div className="my-back">
        {back}
        {deleteControl}
      </div>
      {live && link && <DraftLinkStrip draft={live} unsent={unsent} otherShop={otherShop} />}
      {changedMeanwhile && (
        <Callout tone="warn" title="Чернетку змінили, поки ви її редагували">
          Наприклад, синхронізація з Etsy підтягнула зміни, зроблені на Etsy. Збереження спершу спитає, чи записати ваші зміни поверх.
        </Callout>
      )}
      {current?.source === 'etsy' && !link && (
        <Callout tone="info" icon="store" role="note" compact>
          Цю чернетку створили на сайті Etsy, а програма підтягнула її під час синхронізації.
        </Callout>
      )}
      {removed && (
        <Callout
          tone="error"
          title="Цей товар видалено на Etsy"
          action={
            <Button variant="primary" size="sm" icon="upload" busy={busy === 'draft'} disabled={!!busy || sendProblems.length > 0} onClick={() => void onSendAsNew()}>
              Надіслати як новий товар
            </Button>
          }
        >
          Оновити його вже не вийде. Чернетку можна надіслати на Etsy як новий товар (спершу як чернетку, без плати) або видалити.
        </Callout>
      )}
      {!removed && link?.changedOnEtsy && (
        <Callout tone="warn" title="Товар змінили і на Etsy">
          Після останньої синхронізації товар змінили на Etsy, а тут є зміни, ще не надіслані туди. «Оновити на Etsy» спершу спитає, чи
          перезаписати зміни, зроблені на Etsy. Подивитись їх можна кнопкою «Редагувати на Etsy».
        </Callout>
      )}
      {current?.source === 'mcp' && (
        <Callout tone="info" icon="sparkle" role="note" title="Цю чернетку підготував Claude — перевірте перед надсиланням.">
          Помічник заповнив поля на ваше прохання. Прогляньте кожне поле й фото: на Etsy нічого не потрапить, доки ви не
          натиснете «Надіслати».
        </Callout>
      )}
      {live?.lastError && !error && !removed && (
        <Callout tone="error" title="Минулого разу не вдалося надіслати">
          Минула спроба надіслати: {live.lastError}
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
          <PhotoList items={photos} onChange={(v) => (setPhotos(v), touched())} readOnly={false} draftId={current?.id ?? null} />
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

      {(active ? publishProblems : sendProblems).length > 0 ? (
        <div data-testid="create-problems">
          <Callout tone="warn" role="note" title={active ? 'Щоб оновити опублікований товар на Etsy, ще потрібно:' : 'Щоб надіслати на Etsy, ще потрібно:'}>
            <ul className="my-bullets">
              {(active ? publishProblems : sendProblems).map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </Callout>
        </div>
      ) : publishProblems.length > 0 ? (
        <div data-testid="publish-problems">
          <Callout tone="info" role="note" title={link ? 'Можна оновити на Etsy без публікації.' : 'Можна надіслати як чернетку.'}>
            {publishProblems.join(' ')}
          </Callout>
        </div>
      ) : (
        <Callout tone="success" role="note" compact>
          {!link ? 'Усе заповнено — товар можна одразу опублікувати.' : active ? 'Усе заповнено — товар на Etsy можна оновити.' : 'Усе заповнено — товар можна оновити й опублікувати.'}
        </Callout>
      )}
      <div ref={outcome} className="draft-outcome">
        {notes.length > 0 && (
          <div data-testid="draft-notes">
            <Callout tone="info" role="note" title="Зверніть увагу">
              <ul className="my-bullets">
                {notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </Callout>
          </div>
        )}
        {result && (
          <SendResult
            result={result}
            onScan={
              shop
                ? () => {
                    void scanShop(shop.id)
                    openDrafts(null)
                  }
                : null
            }
          />
        )}
      </div>
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
          {saveLabel}
        </Button>
        {!link ? (
          <>
            <Button
              icon="draft"
              busy={busy === 'draft'}
              disabled={!!busy || sendProblems.length > 0}
              tooltip={sendProblems.length ? 'Спершу заповніть те, що вказано вище.' : GLOSSARY['myshop.sendAsDraft'].short}
              onClick={() => void onSend('draft')}
            >
              Надіслати на Etsy як чернетку
            </Button>
            <Button
              variant="primary"
              icon="upload"
              busy={busy === 'publish'}
              disabled={!!busy || publishProblems.length > 0}
              tooltip={publishProblems.length && !sendProblems.length ? publishProblems.join(' ') : GLOSSARY['myshop.publish'].short}
              onClick={() => void onSend('publish')}
            >
              Надіслати й опублікувати
            </Button>
          </>
        ) : removed ? null : (
          <>
            <Button
              variant={active ? 'primary' : 'secondary'}
              icon="upload"
              busy={busy === 'update'}
              disabled={!!busy || updateProblems.length > 0 || otherShop}
              tooltip={updateProblems.length ? 'Спершу заповніть те, що вказано вище.' : GLOSSARY['myshop.updateOnEtsy'].short}
              onClick={() => void onSend('update')}
            >
              Оновити на Etsy
            </Button>
            {!active && (
              <Button
                variant="primary"
                icon="upload"
                busy={busy === 'publish'}
                disabled={!!busy || publishProblems.length > 0 || otherShop}
                tooltip={
                  publishProblems.length && !sendProblems.length
                    ? publishProblems.join(' ')
                    : inactive
                      ? 'Оновить товар і знову ввімкне його в магазині. Увімкнути вимкнений товар безкоштовно.'
                      : GLOSSARY['myshop.publish'].short
                }
                onClick={() => void onSend('publish')}
              >
                {inactive ? 'Оновити й увімкнути' : 'Оновити й опублікувати'}
              </Button>
            )}
          </>
        )}
      </SaveBar>
    </div>
  )
}

/** "Синхронізувати з Etsy": pulls the own shop's Etsy drafts in; says what the last pull did. */
function PullBar(): JSX.Element {
  const { draftPull, pullDrafts, etsyAuth } = useStore()
  const signedIn = ownShopId({ etsyAuth }) != null
  const noScope = signedIn && missingScopes(etsyAuth?.scopes ?? [], ['listings_r']).length > 0
  const { running, lastAt, lastSummary, error } = draftPull
  return (
    <div className="draft-pull" data-testid="draft-pull">
      <div className="draft-pull-row">
        <Button
          size="sm"
          icon="refresh"
          busy={running}
          disabled={!signedIn || noScope}
          tooltip={
            !signedIn
              ? 'Спершу увійдіть в Etsy у вікні «Мій магазин».'
              : noScope
                ? 'Вхід в Etsy не має дозволу читати товари — вийдіть і увійдіть в Etsy ще раз («Керувати» → «Вийти»).'
                : GLOSSARY['myshop.syncDrafts'].short
          }
          onClick={() => void pullDrafts()}
        >
          Синхронізувати з Etsy
        </Button>
        <span className="draft-pull-status" role="status">
          {running
            ? 'Синхронізація з Etsy…'
            : lastSummary && !error
              ? `${pullSummaryText(lastSummary)}${lastAt != null ? ` (${formatDateTime(lastAt)})` : ''}`
              : null}
        </span>
      </div>
      {!running && error && (
        <Callout tone="error" title="Не вдалося синхронізувати з Etsy" compact>
          {error}
        </Callout>
      )}
      {!running && !error && lastSummary && lastSummary.errors.length > 0 && (
        <Callout tone="warn" title="Деякі товари не вдалося синхронізувати" compact>
          <ul className="my-bullets">
            {lastSummary.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Callout>
      )}
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
        Заготовки <Term glossary="listing">товарів</Term> вашого магазину. Їх готуєте ви, помічник <Term glossary="claude" />, або
        програма підтягує їх із чернеток на сайті Etsy. Перевірте й надішліть на Etsy — як чернетку або одразу з публікацією. Надіслану
        чернетку можна змінити тут і оновити товар на Etsy.
      </p>
      <PullBar />
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
                  <ZoomImage
                    src={draftPhotoSrc(d.photos[0].id)}
                    alt={d.fields.title || d.photos[0].name}
                    gallery={d.photos.map((m) => ({
                      src: draftPhotoSrc(m.id),
                      alt: m.name,
                      caption: d.fields.title ? `${d.fields.title} — ${m.name}` : m.name,
                      ref: draftPhotoRef(d.id, m.id)
                    }))}
                    className="draft-row-zoom"
                    imgClassName="my-thumb my-thumb--md"
                  />
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
                    {d.source === 'etsy' && <EtsyBadge />}
                  </div>
                  <div className="my-meta">
                    <StatusBadge draft={d} />
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
                <div className="draft-row-actions">
                  {d.etsy?.url && d.etsy.state === 'active' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="external"
                      iconOnly
                      label={`Відкрити на Etsy: ${d.fields.title || `товар № ${d.etsy.listingId}`}`}
                      onClick={() => void window.api.openExternal(d.etsy!.url!)}
                    />
                  )}
                  <Button size="sm" icon="edit" onClick={() => openDrafts({ draftId: d.id })}>
                    Відкрити
                  </Button>
                </div>
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
 * prepared here, by Claude over MCP, or pulled from Etsy drafts; reviewed and
 * sent to Etsy, and once linked, updated there.
 */
export function DraftsModal(): JSX.Element | null {
  const { draftsView, openDrafts, drafts, setDraftPull } = useStore()
  // What the open editor would lose; closing the window asks first.
  const unsaved = useRef<string | null>(null)
  // The pull of Etsy's drafts (after a scan of the own shop, or the button): main pushes its state.
  // (Optional calls: the dev-only UI harness's fake api may not have them.)
  useEffect(() => {
    void window.api
      .getDraftsPullState?.()
      .then((s) => s && setDraftPull(s))
      .catch(() => undefined)
    return window.api.onDraftsPull?.(setDraftPull)
  }, [setDraftPull])
  const close = (): void => leaveThen(unsaved, () => openDrafts(null))
  if (draftsView == null) return null
  const editing = draftsView !== 'list'
  const draft = editing && draftsView.draftId != null ? (drafts.find((d) => d.id === draftsView.draftId) ?? null) : null
  return (
    <Modal
      title={!editing ? 'Чернетки товарів' : draft ? 'Чернетка товару' : 'Новий товар'}
      subtitle={
        !editing
          ? 'Зберігаються в програмі. Надіслані на Etsy можна змінювати й оновлювати там.'
          : draft?.etsy
            ? 'Пов’язано з товаром на Etsy: змінюйте тут, а «Оновити на Etsy» перенесе зміни туди.'
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
