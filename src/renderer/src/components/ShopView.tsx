import { useMemo } from 'react'
import type { ImageCounts, ImageSyncState, ReviewSyncState, ScanProgress, ShopSummary } from '@shared/types'
import { formatAgo, formatCount, formatDateTime, formatRating, isStale } from '@shared/format'
import { GLOSSARY } from '@shared/glossary'
import { ownShopId, useStore, type SortMode } from '../store'
import { SHOP_PANELS } from '../features/registry'
import { filterListings } from '@shared/listingFilter'
import { MARK_FILTERS } from '@shared/marks'
import { storeImageRef } from '@shared/claudeRef'
import { ActionBar, Badge, Button, Callout, EmptyState, Icon, InfoTip, Segmented, Select, Spinner, Stat, Term, Toggle, type Action } from '../ui'
import { countOf } from './ChangeList'
import { ExternalLink } from './ExternalLink'
import { ListingCard } from './ListingCard'
import { ScanHistory } from './ScanHistory'
import { ScanResults } from './ScanResults'
import { UNREADABLE_KEY_MESSAGE } from './SettingsModal'
import { ShopIcon } from './ShopIcon'

const DELTA_HINT = 'Зміна з попереднього сканування'

/** A change worth showing: null for unknown / 0 (a calm tile without "0"). */
const changeOf = (v: number | null | undefined): number | null =>
  v == null || v === 0 || !Number.isFinite(v) ? null : v

/** The grid's sort options, in plain words. */
export const SORT_OPTIONS: ReadonlyArray<{ value: SortMode; label: string }> = [
  { value: 'newest', label: 'Спершу новіші' },
  { value: 'price-asc', label: 'Спершу дешевші' },
  { value: 'price-desc', label: 'Спершу дорожчі' },
  { value: 'favorites', label: 'Найбільше в обраному' },
  { value: 'views', label: 'Найбільше переглядів' },
  { value: 'favorites-growth', label: 'Найшвидше ростуть в обраному' },
  { value: 'reviews', label: 'Найбільше відгуків' },
  { value: 'reviews-growth', label: 'Найбільше нових відгуків' },
  { value: 'discount', label: 'Найбільша знижка' },
  { value: 'marked', label: 'Спершу з міткою' }
]

/**
 * What a running scan is doing, in plain words — main's labels ("Деталі 100/430")
 * are internal. The scan button keeps a stable "Сканування…"; this goes beside it.
 */
export function scanProgressText(p: ScanProgress | null | undefined): string {
  if (!p) return 'Сканування…'
  const of = p.total > 0 && p.done > 0 ? `: ${formatCount(p.done)} з ${formatCount(p.total)}` : '…'
  switch (p.phase) {
    case 'pages':
      return p.total > 1 && p.done > 0 ? `Читаю список товарів: сторінка ${formatCount(p.done)} з ${formatCount(p.total)}` : 'Читаю список товарів…'
    case 'details':
      return `Читаю фото й деталі товарів${of}`
    case 'verify':
      return 'Перевіряю товари, яких не стало в списку…'
    case 'saving':
      return 'Зберігаю результати…'
    default:
      return 'Сканування…'
  }
}

/** The photo store's error (MinIO's technical text) as plain words; the raw text stays in the details tip. */
export function imageErrorText(raw: string): { lead: string; rest: string } {
  if (/місце/i.test(raw)) return { lead: 'У сховищі фото', rest: ' закінчилось місце на диску — звільніть місце, і фото докопіюються пізніше.' }
  if (/облікові дані|access key|secret key/i.test(raw))
    return { lead: 'Сховище фото', rest: ' не прийняло логін і пароль — перевірте їх у Налаштуваннях. Поки що фото показуються прямо з Etsy.' }
  if (/недоступн|ECONN|ENOTFOUND|EHOST|тайм-аут|timeout/i.test(raw))
    return { lead: 'Сховище фото', rest: ' на цьому комп’ютері не відповідає — поки що фото показуються прямо з Etsy.' }
  return { lead: 'Не вдалося скопіювати фото у сховище', rest: ' на цьому комп’ютері — поки що фото показуються прямо з Etsy.' }
}

/** A review-sync error in plain words (no HTTP codes); the raw text stays in the details tip. */
export function reviewErrorText(raw: string): string {
  if (/HTTP 40[13]/.test(raw)) return 'Etsy не дає читати відгуки цього магазину з вашим ключем. Товари скануються як і раніше.'
  if (/HTTP 404/.test(raw)) return 'Etsy зараз не показує відгуки цього магазину. Товари скануються як і раніше.'
  return raw
    .replace(/^Відгуки: /, 'Не вдалося завантажити відгуки: ')
    .replace(/\s*\(HTTP \d+\)/g, '')
}

/** "ⓘ" with the raw error text, for whoever needs the details (support, a technical friend). */
function ErrorDetails({ raw }: { raw: string }): JSX.Element {
  return <InfoTip term="Технічні деталі" text={raw} label="Технічні деталі помилки" size={13} />
}

/** Sales / rating / reviews / shop favourites as compact tiles, each explained, with growth since the previous scan. */
export function ShopStatsLine({ shop }: { shop: ShopSummary }): JSX.Element | null {
  const s = shop.stats
  if (!s) return null
  const d = shop.statsDelta
  const tiles: JSX.Element[] = []
  if (s.transactionSoldCount != null) {
    tiles.push(
      <Stat
        key="sold"
        compact
        icon="receipt"
        label="Продажі"
        glossary="salesCount"
        value={formatCount(s.transactionSoldCount)}
        delta={changeOf(d?.transactionSoldCount)}
        deltaHint={DELTA_HINT}
        caption="за весь час"
      />
    )
  }
  if (s.reviewAverage != null) {
    tiles.push(
      <Stat
        key="rating"
        compact
        icon="star"
        label="Рейтинг"
        glossary="rating"
        value={s.reviewCount === 0 ? '—' : formatRating(s.reviewAverage)}
        delta={changeOf(d?.reviewAverage)}
        deltaHint={DELTA_HINT}
        caption={s.reviewCount === 0 ? 'ще немає оцінок' : 'середня оцінка з 5'}
      />
    )
  }
  if (s.reviewCount != null) {
    tiles.push(
      <Stat
        key="reviews"
        compact
        icon="review"
        label="Відгуки"
        glossary="reviews"
        value={formatCount(s.reviewCount)}
        delta={changeOf(d?.reviewCount)}
        deltaHint={DELTA_HINT}
        caption="за весь час"
      />
    )
  }
  if (s.numFavorers != null) {
    tiles.push(
      <Stat
        key="fav"
        compact
        icon="heart"
        label="Обране"
        glossary="shopFavorers"
        value={formatCount(s.numFavorers)}
        delta={changeOf(d?.numFavorers)}
        deltaHint={DELTA_HINT}
        caption="додали магазин в обране"
      />
    )
  }
  if (!tiles.length) return null
  return (
    <div className="shop-kpis" data-testid="shop-stats">
      {tiles}
    </div>
  )
}

/**
 * "Фото товарів: збережено 120 з 430 · не вдалося: 2" + the copy state. No
 * button of its own: "Сканувати повторно" refreshes photos too (failed ones retried).
 */
export function ImageSyncLine({
  counts,
  sync,
  onOpenSettings
}: {
  counts: ImageCounts | null
  sync: ImageSyncState | null
  /** Shown as "Відкрити Налаштування" next to a store error. */
  onOpenSettings?: () => void
}): JSX.Element | null {
  if (!counts || counts.total === 0) return null
  const running = !!sync?.running
  const done = counts.stored >= counts.total
  const storeError = !running && sync?.lastError ? sync.lastError : null
  const plain = storeError ? imageErrorText(storeError) : null
  return (
    <div className="sync-line" data-testid="image-sync">
      <span className="sync-label">
        <Icon name="photo" size={15} />
        Фото товарів
        <InfoTip glossary="photoSync" />
      </span>
      <span className="sync-parts">
        <span className={done ? 'ok' : undefined}>
          {done && <Icon name="check" size={13} />} збережено {formatCount(counts.stored)} з {formatCount(counts.total)}
        </span>
        {counts.error > 0 && <span className="err">не вдалося: {formatCount(counts.error)}</span>}
        {running && (
          <span className="sync-progress">
            <Spinner decorative size={12} /> копіюються {sync!.done} з {sync!.total}
          </span>
        )}
        {!running && sync?.disabled && <span className="dim">копіювання вимкнено в Налаштуваннях</span>}
        {storeError && plain && (
          <span className="err sync-error" data-testid="image-sync-error" title={storeError}>
            <Term glossary="minio">{plain.lead}</Term>
            {plain.rest} <ErrorDetails raw={storeError} />
          </span>
        )}
      </span>
      {storeError && onOpenSettings && (
        <Button size="sm" variant="ghost" icon="settings" onClick={onOpenSettings} tooltip="Перевірити налаштування сховища фото">
          Відкрити Налаштування
        </Button>
      )}
    </div>
  )
}

/**
 * "Відгуки покупців: завантажено 3 200 з ~9 300 · середня оцінка 4,87 · фото
 * відгуків: 12 з 40" + the running sync and its error. No button of its own:
 * every successful scan loads new reviews and continues the history.
 */
export function ReviewSyncLine({
  shop,
  live
}: {
  shop: ShopSummary
  live: ReviewSyncState | undefined
}): JSX.Element | null {
  const all = shop.reviews ?? null
  const running = !!live?.running
  // Only failed runs so far (e.g. 403): show "not loaded" + the error, no counts.
  const info = all?.synced ? all : null
  const lastError = all?.lastError ?? null
  if (!all && !running && !shop.lastOkScan) return null
  const stored = running ? live!.stored : (info?.stored ?? 0)
  const estimate = running ? (live!.estimate ?? info?.estimate ?? null) : (info?.estimate ?? null)
  const complete = running ? live!.backfillComplete : !!info?.backfillComplete
  const error = running ? null : lastError
  return (
    <div className="sync-line" data-testid="review-sync">
      <span className="sync-label">
        <Icon name="review" size={15} />
        Відгуки покупців
        <InfoTip glossary="shop.reviewSync" />
      </span>
      <span className="sync-parts">
        {info || running ? (
          <span>
            завантажено {formatCount(stored)}
            {!complete && estimate != null && estimate > stored && ` з ~${formatCount(estimate)}`}
          </span>
        ) : (
          <span className="dim">ще не завантажено</span>
        )}
        {info?.average != null && <span>середня оцінка {formatRating(info.average)}</span>}
        {!running && info && !complete && (
          <span className="dim">
            <Term glossary="reviewsPartial">історія ще завантажується</Term>
          </span>
        )}
        {info && info.photos.total > 0 && (
          <span className="dim">
            фото відгуків: {formatCount(info.photos.stored)} з {formatCount(info.photos.total)}
          </span>
        )}
        {running && (
          <span className="sync-progress">
            <Spinner decorative size={12} /> завантажуються ({live!.phase === 'incremental' ? 'нові' : 'історія'}, запитів: {live!.requests})
          </span>
        )}
        {error && (
          <span className="err sync-error" data-testid="review-sync-error" title={error}>
            {reviewErrorText(error)}
            {reviewErrorText(error) !== error && (
              <>
                {' '}
                <ErrorDetails raw={error} />
              </>
            )}
          </span>
        )}
      </span>
    </div>
  )
}

export function ShopView(): JSX.Element | null {
  const {
    shops,
    activeShopId,
    listings,
    lastChanges,
    scans,
    scanning,
    progress,
    search,
    sort,
    keyStatus,
    imageCounts,
    imageSync,
    setSearch,
    setSort,
    scanShop,
    removeShop,
    openListing,
    newReviews,
    reviewSync,
    openStats,
    scanPromotions,
    discountOnly,
    setDiscountOnly,
    markFilter,
    setMarkFilter,
    buyerCountry,
    etsyAuth,
    setShowMyShop,
    setShowSettings,
    openDrafts,
    drafts,
    openShopPanels
  } = useStore()
  const shop = shops.find((s) => s.id === activeShopId)

  const newIds = useMemo(
    () => new Set(lastChanges.filter((c) => c.kind === 'added').map((c) => c.listingId)),
    [lastChanges]
  )
  const visible = useMemo(
    () => filterListings(listings, search, sort, { discountOnly, mark: markFilter }),
    [listings, search, sort, discountOnly, markFilter]
  )

  if (!shop) return null
  const busy = !!scanning[shop.id]
  const p = progress[shop.id]
  const lastOk = shop.lastOkScan
  const failed = shop.lastScan?.status === 'error' ? shop.lastScan : null
  const mine = shop.id === ownShopId({ etsyAuth })
  const pendingDrafts = drafts.filter((d) => d.status !== 'sent').length
  const hasKey = !!keyStatus?.hasKey
  const searching = !!search.trim()
  const marking = markFilter !== 'any'
  const filtered = searching || discountOnly || marking
  // "Nothing found": name only the filters that are really on.
  const markName = MARK_FILTERS.find((f) => f.value === markFilter)?.label ?? ''
  const emptyHint = marking
    ? searching || discountOnly
      ? { text: `Серед товарів з міткою «${markName}» таких немає. Змініть пошук чи фільтри.`, reset: 'Скинути пошук і фільтри' }
      : {
          text:
            markFilter === 'none'
              ? 'Усі товари магазину вже мають мітку.'
              : `Жоден товар магазину не має мітки «${markName}». Мітку ставлять у вікні товару або кнопкою на картці.`,
          reset: 'Показати всі товари'
        }
    : searching && discountOnly
      ? { text: 'Зараз жоден такий товар не має знижки. Спробуйте інше слово або вимкніть «Зі знижкою».', reset: 'Скинути пошук і фільтр' }
      : discountOnly
        ? { text: 'Зараз жоден товар магазину не має знижки — вимкніть «Зі знижкою», щоб побачити всі.', reset: 'Вимкнути «Зі знижкою»' }
        : { text: 'Жоден товар не має такого слова в назві чи тегах. Спробуйте інше слово.', reset: 'Скинути пошук' }

  const actions: Array<Action | false> = [
    {
      id: 'scan',
      // A stable label while running (the progress is in the status line), so the bar doesn't reflow.
      label: busy ? 'Сканування…' : lastOk ? 'Сканувати повторно' : 'Сканувати',
      icon: 'refresh',
      variant: 'primary',
      busy,
      disabled: !hasKey,
      hint: busy
        ? scanProgressText(p)
        : hasKey
          ? 'Оновити все з Etsy: товари, ціни, популярність, відгуки й фото — і показати, що змінилось з минулого разу'
          : 'Спершу додайте ключ доступу до Etsy в Налаштуваннях',
      onClick: () => void scanShop(shop.id)
    },
    // Your own shop: managing it is the main thing besides scanning.
    mine && {
      id: 'manage',
      label: 'Керувати',
      icon: 'edit',
      pinned: true,
      hint: 'Редагувати товари й тексти свого магазину на Etsy',
      onClick: () => setShowMyShop(true)
    },
    {
      id: 'stats',
      label: 'Статистика',
      icon: 'stats',
      hint: 'Графіки продажів, відгуків і обраного між скануваннями',
      onClick: () => openStats(shop.id)
    },
    mine && {
      id: 'drafts',
      label: pendingDrafts > 0 ? `Чернетки (${pendingDrafts})` : 'Чернетки',
      icon: 'draft',
      hint: 'Товари, підготовлені в програмі (вами чи Claude): перевірте й надішліть на Etsy',
      onClick: () => openDrafts('list')
    },
    mine && {
      id: 'new-listing',
      label: 'Новий товар',
      icon: 'plus',
      hint: 'Підготувати новий товар (спершу — чернетка в програмі)',
      onClick: () => openDrafts({ draftId: null })
    },
    SHOP_PANELS.length > 0 && {
      id: 'more',
      label: 'Більше',
      icon: 'info',
      hint: 'Живі дані з Etsy: розділи магазину, рекомендовані товари, правила…',
      onClick: () => openShopPanels(shop.id)
    },
    {
      id: 'delete',
      label: 'Видалити',
      icon: 'trash',
      variant: 'danger',
      disabled: busy,
      hint: 'Прибрати магазин з програми разом зі збереженою історією. На Etsy нічого не зміниться.',
      onClick: () => void removeShop(shop.id)
    }
  ]

  return (
    <div className="shop-view">
      <header className="shop-header">
        <div className="shop-head-row">
          <ShopIcon url={shop.iconUrl} name={shop.shopName} size={40} zoomable claudeRef={storeImageRef(shop.id, 'logo')} />
          <h1 className="shop-name">
            <span className="truncate" title={shop.shopName}>
              {shop.shopName}
            </span>
            {mine && (
              <Badge tone="accent" hint={GLOSSARY['shop.mine'].short}>
                мій
              </Badge>
            )}
          </h1>
          <ActionBar label="Дії з магазином" align="end" actions={actions} />
        </div>
        <div className="shop-head-meta">
          {shop.title && (
            <span className="shop-subtitle truncate" title={shop.title}>
              {shop.title}
            </span>
          )}
          <span className="shop-status">
            {busy && (
              <span className="shop-status-item scan-progress" role="status" data-testid="scan-progress">
                <Spinner decorative size={12} />
                {scanProgressText(p)}
              </span>
            )}
            <span className="shop-status-item" title={lastOk ? `Останнє сканування: ${formatDateTime(lastOk.finishedAt)}` : undefined}>
              <Icon name="clock" size={13} />
              {lastOk ? (
                <>
                  <Term glossary="shop.lastUpdate">Оновлено</Term> {formatAgo(lastOk.finishedAt)}
                </>
              ) : (
                'Ще не скановано'
              )}
            </span>
            {lastOk && (
              <span className="shop-status-item">
                <Icon name="box" size={13} />
                <Term glossary="shop.activeCount">{countOf(shop.activeCount, 'товар', 'товари', 'товарів')} у продажу</Term>
              </span>
            )}
            <ExternalLink href={shop.url} className="ext-link shop-status-item">
              Відкрити на Etsy
              <Icon name="external" size={13} />
            </ExternalLink>
          </span>
        </div>
      </header>

      <div className="shop-scroll">
        <div className="shop-content">
          {/* Hidden by CSS while empty. */}
          <div className="shop-callouts">
              {!hasKey && (
                <Callout
                  tone="warn"
                  title={keyStatus?.unreadable ? 'Ключ доступу не вдалося прочитати' : 'Немає ключа доступу до Etsy'}
                  action={
                    <Button size="sm" icon="settings" onClick={() => setShowSettings(true)}>
                      Відкрити Налаштування
                    </Button>
                  }
                >
                  {keyStatus?.unreadable
                    ? UNREADABLE_KEY_MESSAGE
                    : 'Ключ доступу до Etsy не задано — без нього програма не може сканувати магазини. Його можна безкоштовно отримати на сайті Etsy; як саме — написано в Налаштуваннях.'}
                </Callout>
              )}
              {failed && !busy && (
                <Callout tone="error" title="Останнє сканування не вдалося">
                  {formatDateTime(failed.startedAt)}: {failed.error}
                  {lastOk && ' Нижче — результати попереднього успішного сканування.'}
                </Callout>
              )}
              {lastOk && !busy && isStale(lastOk.finishedAt) && (
                <Callout tone="warn" title="Дані застаріли">
                  Дані старші за 6 годин — проскануйте магазин повторно, щоб побачити актуальні товари й ціни.
                </Callout>
              )}
              {!lastOk && !busy && (
                <Callout tone="info" title="Магазин ще не скановано">
                  Натисніть «Сканувати» — програма запам’ятає всі товари магазину (на Etsy їх зараз{' '}
                  {formatCount(shop.etsyActiveCount)}). Наступні сканування покажуть, що змінилось.
                </Callout>
              )}
              {lastOk?.buyerPrices === 'unavailable' && !busy && (
                <div data-testid="buyer-prices-unavailable">
                  <Callout tone="info" compact>
                    Etsy не віддав ціни для покупця (з ПДВ і знижками) під час останнього сканування — де ціна для
                    покупця невідома, показано базові ціни продавця.
                  </Callout>
                </div>
              )}
              {lastOk &&
                buyerCountry &&
                lastOk.buyerPrices === 'ok' &&
                lastOk.buyerCountry &&
                lastOk.buyerCountry !== buyerCountry &&
                !busy && (
                  <div data-testid="buyer-country-pending">
                    <Callout tone="info" compact>
                      Ціни показано для покупця з {lastOk.buyerCountry}; нова країна ({buyerCountry}) застосується з
                      наступного сканування.
                    </Callout>
                  </div>
                )}
          </div>

          {(shop.stats || (imageCounts && imageCounts.total > 0) || shop.reviews || lastOk) && (
            <section className="shop-overview" aria-labelledby="shop-overview-title">
              <div className="head-row">
                <h2 className="overview-title" id="shop-overview-title">
                  Магазин зараз
                </h2>
                <InfoTip glossary="shop.overview" />
              </div>
              <ShopStatsLine shop={shop} />
              <div className="shop-sync">
                <ImageSyncLine counts={imageCounts} sync={imageSync} onOpenSettings={() => setShowSettings(true)} />
                <ReviewSyncLine shop={shop} live={reviewSync[shop.id]} />
                <p className="sync-note">
                  <Icon name="refresh" size={13} /> Фото й відгуки оновлюються самі після кожного сканування — окремо нічого
                  натискати не треба.
                </p>
              </div>
            </section>
          )}

          <ScanResults
            shop={shop}
            changes={lastChanges}
            newReviews={newReviews}
            promotions={scanPromotions}
            onOpen={openListing}
          />

          {listings.length > 0 ? (
            <section className="all-listings" aria-labelledby="all-listings-title">
              <div className="grid-head">
                <div className="head-row">
                  <h2 className="grid-title" id="all-listings-title">
                    Усі товари магазину
                    <span className="grid-count num">{formatCount(listings.length)}</span>
                  </h2>
                  <InfoTip glossary="shop.allListings" />
                </div>
                {filtered && visible.length > 0 && visible.length < listings.length && (
                  <span className="grid-shown">
                    показано {formatCount(visible.length)} з {formatCount(listings.length)}
                  </span>
                )}
              </div>
              <div className="grid-toolbar" role="search">
                <label className="grid-search">
                  <Icon name="search" size={15} />
                  <input
                    type="search"
                    placeholder="Пошук за назвою або тегом"
                    aria-label="Пошук товарів за назвою або тегом"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <span className="grid-sort">
                  <Icon name="sort" size={15} />
                  <Select
                    value={sort}
                    onChange={(v) => setSort(v as SortMode)}
                    aria-label="Сортування"
                    title="Порядок товарів"
                    options={SORT_OPTIONS}
                  />
                </span>
                <Toggle
                  className="grid-discount"
                  size="sm"
                  switchFirst
                  label="Зі знижкою"
                  glossary="shop.discountOnly"
                  checked={discountOnly}
                  onChange={setDiscountOnly}
                />
                <span className="grid-mark">
                  <Segmented
                    options={MARK_FILTERS}
                    value={markFilter}
                    onChange={setMarkFilter}
                    label="Фільтр за міткою"
                    size="sm"
                  />
                  <InfoTip glossary="shop.markFilter" size={13} />
                </span>
              </div>
              {visible.length === 0 ? (
                <EmptyState
                  compact
                  icon="search"
                  title="Нічого не знайдено."
                  action={
                    <Button
                      size="sm"
                      onClick={() => {
                        setSearch('')
                        setDiscountOnly(false)
                        setMarkFilter('any')
                      }}
                    >
                      {emptyHint.reset}
                    </Button>
                  }
                >
                  {emptyHint.text}
                </EmptyState>
              ) : (
                <div className="grid">
                  {visible.map((l) => (
                    <ListingCard key={l.listingId} listing={l} isNew={newIds.has(l.listingId)} onOpen={openListing} />
                  ))}
                </div>
              )}
            </section>
          ) : (
            lastOk && (
              <EmptyState compact icon="box" title="Товарів у продажу немає" className="grid-empty">
                Під час останнього сканування магазин не продавав жодного товару.
              </EmptyState>
            )
          )}

          <ScanHistory scans={scans} />
        </div>
      </div>
    </div>
  )
}
