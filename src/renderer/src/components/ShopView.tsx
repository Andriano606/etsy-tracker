import { useMemo } from 'react'
import type { ImageCounts, ImageSyncState, ReviewSyncState, ShopSummary } from '@shared/types'
import { formatAgo, formatCount, formatDateTime, formatDelta, formatRating, isStale } from '@shared/format'
import { ownShopId, useStore, type SortMode } from '../store'
import { SHOP_PANELS } from '../features/registry'
import { filterListings } from '@shared/listingFilter'
import { ExternalLink } from './ExternalLink'
import { ListingCard } from './ListingCard'
import { ScanHistory } from './ScanHistory'
import { ScanResults } from './ScanResults'
import { UNREADABLE_KEY_MESSAGE } from './SettingsModal'
import { ShopIcon } from './ShopIcon'

/** Sold / rating / favorers of the shop with growth since the previous scan. */
export function ShopStatsLine({ shop }: { shop: ShopSummary }): JSX.Element | null {
  const s = shop.stats
  if (!s) return null
  const d = shop.statsDelta
  const delta = (v: number | null | undefined, digits = 0): JSX.Element | null => {
    const t = formatDelta(v, digits)
    return t ? <span className={`delta ${v! > 0 ? 'up' : 'down'}`}> {t}</span> : null
  }
  const parts: JSX.Element[] = []
  if (s.transactionSoldCount != null) {
    parts.push(
      <span key="sold" title="Продано (transaction_sold_count)">
        Продано: {formatCount(s.transactionSoldCount)}
        {delta(d?.transactionSoldCount)}
      </span>
    )
  }
  if (s.reviewAverage != null || s.reviewCount != null) {
    parts.push(
      <span key="reviews" title="Середня оцінка та кількість відгуків">
        ★ {s.reviewAverage != null ? s.reviewAverage.toLocaleString('uk-UA', { maximumFractionDigits: 2 }) : '—'}
        {delta(d?.reviewAverage, 2)} ({formatCount(s.reviewCount)} відгуків{delta(d?.reviewCount)})
      </span>
    )
  }
  if (s.numFavorers != null) {
    parts.push(
      <span key="fav" title="Додали магазин в обране">
        ❤ {formatCount(s.numFavorers)}
        {delta(d?.numFavorers)}
      </span>
    )
  }
  if (!parts.length) return null
  return (
    <div className="shop-stats" data-testid="shop-stats">
      {parts}
    </div>
  )
}

/** "Фото: 120/430 · помилок: 2" + the MinIO sync state and a manual retry. */
export function ImageSyncLine({
  counts,
  sync,
  onSync
}: {
  counts: ImageCounts | null
  sync: ImageSyncState | null
  onSync: () => void
}): JSX.Element | null {
  if (!counts || counts.total === 0) return null
  const running = !!sync?.running
  return (
    <div className="image-sync" data-testid="image-sync">
      <span title="Скільки фото активних товарів скопійовано в MinIO">
        Фото: {formatCount(counts.stored)}/{formatCount(counts.total)}
      </span>
      {counts.error > 0 && <span className="err"> · помилок: {formatCount(counts.error)}</span>}
      {running && (
        <span className="scan-progress">
          {' '}
          · синхронізація {sync!.done}/{sync!.total}
        </span>
      )}
      {!running && sync?.disabled && <span className="dim"> · MinIO вимкнено в Налаштуваннях</span>}
      {!running && sync?.lastError && (
        <span className="err" title={sync.lastError}>
          {' '}
          · {sync.lastError}
        </span>
      )}
      {!running && !sync?.disabled && counts.stored < counts.total && (
        <button className="btn subtle small" onClick={onSync}>
          Синхронізувати фото
        </button>
      )}
    </div>
  )
}

/**
 * "Відгуки: 3 200 / ~9 300 · ⭐ 4,87 · фото відгуків: 12/40" + the running sync,
 * its error and "Синхронізувати відгуки".
 */
export function ReviewSyncLine({
  shop,
  live,
  canSync,
  onSync
}: {
  shop: ShopSummary
  live: ReviewSyncState | undefined
  canSync: boolean
  onSync: () => void
}): JSX.Element | null {
  const all = shop.reviews ?? null
  const running = !!live?.running
  // Only failed runs so far (e.g. 403): show "not synced" + the error, no counts.
  const info = all?.synced ? all : null
  const lastError = all?.lastError ?? null
  if (!all && !running && !shop.lastOkScan) return null
  const stored = running ? live!.stored : (info?.stored ?? 0)
  const estimate = running ? (live!.estimate ?? info?.estimate ?? null) : (info?.estimate ?? null)
  const complete = running ? live!.backfillComplete : !!info?.backfillComplete
  const error = running ? null : lastError
  return (
    <div className="review-sync" data-testid="review-sync">
      {info || running ? (
        <span title="Відгуки магазину, збережені в базі (з GET /shops/{id}/reviews)">
          Відгуки: {formatCount(stored)}
          {!complete && estimate != null && estimate > stored && ` / ~${formatCount(estimate)}`}
          {info?.average != null && ` · ⭐ ${formatRating(info.average)}`}
        </span>
      ) : (
        <span className="dim">Відгуки ще не синхронізовано</span>
      )}
      {!running && info && !complete && (
        <span className="dim" title="Історію відгуків завантажено не повністю — продовжиться з наступним скануванням">
          {' '}
          · історія завантажується
        </span>
      )}
      {info && info.photos.total > 0 && (
        <span className="dim">
          {' '}
          · фото відгуків: {formatCount(info.photos.stored)}/{formatCount(info.photos.total)}
        </span>
      )}
      {running && (
        <span className="scan-progress">
          {' '}
          · синхронізація ({live!.phase === 'incremental' ? 'нові' : 'історія'}, запитів: {live!.requests})
        </span>
      )}
      {error && (
        <span className="err" title={error}>
          {' '}
          · {error}
        </span>
      )}
      {!running && (
        <button className="btn subtle small" disabled={!canSync} onClick={onSync}>
          Синхронізувати відгуки
        </button>
      )}
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
    syncImages,
    newReviews,
    reviewSync,
    syncReviews,
    openStats,
    scanPromotions,
    discountOnly,
    setDiscountOnly,
    buyerCountry,
    etsyAuth,
    setShowMyShop,
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
    () => filterListings(listings, search, sort, { discountOnly }),
    [listings, search, sort, discountOnly]
  )

  if (!shop) return null
  const busy = !!scanning[shop.id]
  const p = progress[shop.id]
  const lastOk = shop.lastOkScan
  const failed = shop.lastScan?.status === 'error' ? shop.lastScan : null
  const mine = shop.id === ownShopId({ etsyAuth })
  const pendingDrafts = drafts.filter((d) => d.status !== 'sent').length

  return (
    <div className="shop-view">
      <header className="shop-header">
        <ShopIcon url={shop.iconUrl} name={shop.shopName} size={44} />
        <div className="shop-header-text">
          <h1>
            {shop.shopName}{' '}
            {mine && (
              <span className="mine-badge" title="Ваш магазин (ви увійшли в Etsy)">
                мій
              </span>
            )}{' '}
            <ExternalLink href={shop.url} className="ext-link small">
              на Etsy ↗
            </ExternalLink>
          </h1>
          {shop.title && <div className="shop-title">{shop.title}</div>}
          <div className="meta">
            {lastOk
              ? `Скановано ${formatDateTime(lastOk.finishedAt)} (${formatAgo(lastOk.finishedAt)}) · активних товарів: ${shop.activeCount}`
              : 'Ще не скановано'}
          </div>
          <ShopStatsLine shop={shop} />
          <ImageSyncLine counts={imageCounts} sync={imageSync} onSync={() => void syncImages()} />
          <ReviewSyncLine
            shop={shop}
            live={reviewSync[shop.id]}
            canSync={!!keyStatus?.hasKey && !busy}
            onSync={() => void syncReviews()}
          />
        </div>
        <div className="shop-actions">
          {mine && (
            <>
              <button className="btn" onClick={() => openDrafts({ draftId: null })} title="Підготувати новий лістинг (чернетка в програмі)">
                ＋ Новий лістинг
              </button>
              <button
                className="btn"
                onClick={() => openDrafts('list')}
                title="Лістинги, підготовлені в програмі (вами чи Claude) — перевірте й надішліть на Etsy"
              >
                📝 Чернетки
                {pendingDrafts > 0 && <span className="count-badge">{pendingDrafts}</span>}
              </button>
              <button className="btn" onClick={() => setShowMyShop(true)} title="Редагувати лістинги й тексти магазину на Etsy">
                ✏️ Керувати
              </button>
            </>
          )}
          {SHOP_PANELS.length > 0 && (
            <button className="btn" onClick={() => openShopPanels(shop.id)} title="Живі дані з Etsy: розділи, рекомендовані, політики…">
              ℹ️ Більше
            </button>
          )}
          <button className="btn" onClick={() => openStats(shop.id)} title="Графіки між скануваннями">
            📊 Статистика
          </button>
          <button
            className="btn primary"
            disabled={busy || !keyStatus?.hasKey}
            onClick={() => void scanShop(shop.id)}
          >
            {busy ? (p?.label ?? 'Сканування…') : lastOk ? 'Сканувати повторно' : 'Сканувати'}
          </button>
          <button className="btn danger" disabled={busy} onClick={() => void removeShop(shop.id)}>
            Видалити
          </button>
        </div>
      </header>

      <div className="shop-scroll">
        {!keyStatus?.hasKey && (
          <div className="banner warn">
            {keyStatus?.unreadable
              ? `${UNREADABLE_KEY_MESSAGE} Відкрийте Налаштування.`
              : 'API-ключ Etsy не задано — сканування недоступне. Відкрийте Налаштування.'}
          </div>
        )}
        {failed && !busy && (
          <div className="banner err" role="alert">
            Останнє сканування ({formatDateTime(failed.startedAt)}) не вдалося: {failed.error}
            {lastOk && ' Показано результати попереднього успішного сканування.'}
          </div>
        )}
        {lastOk && !busy && isStale(lastOk.finishedAt) && (
          <div className="banner">
            Дані старші за 6 годин — проскануйте повторно, щоб побачити актуальні товари й ціни.
          </div>
        )}
        {!lastOk && !busy && (
          <div className="banner">
            Натисніть «Сканувати», щоб зберегти всі поточні товари магазину (на Etsy їх{' '}
            {shop.etsyActiveCount}).
          </div>
        )}

        {lastOk?.buyerPrices === 'unavailable' && !busy && (
          <div className="banner" data-testid="buyer-prices-unavailable">
            Etsy не віддав ціни для покупця (з ПДВ і знижками) під час останнього сканування — де
            ціна для покупця невідома, показано базові ціни продавця.
          </div>
        )}
        {lastOk && buyerCountry && lastOk.buyerPrices === 'ok' && lastOk.buyerCountry && lastOk.buyerCountry !== buyerCountry && !busy && (
          <div className="banner" data-testid="buyer-country-pending">
            Ціни показано для покупця з {lastOk.buyerCountry}; нова країна ({buyerCountry}) застосується
            з наступного сканування.
          </div>
        )}

        <ScanResults
          shop={shop}
          changes={lastChanges}
          newReviews={newReviews}
          promotions={scanPromotions}
          onOpen={openListing}
        />

        {listings.length > 0 && (
          <section className="all-listings">
            <div className="toolbar">
              <h2>Усі активні товари ({listings.length})</h2>
              <input
                className="search"
                type="search"
                placeholder="Пошук за назвою або тегом"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select
                className="sort"
                value={sort}
                onChange={(e) => setSort(e.target.value as SortMode)}
                aria-label="Сортування"
              >
                <option value="newest">Новіші</option>
                <option value="price-asc">Ціна ↑</option>
                <option value="price-desc">Ціна ↓</option>
                <option value="favorites">Найпопулярніші (обране)</option>
                <option value="views">Перегляди</option>
                <option value="favorites-growth">Ріст обраного</option>
                <option value="reviews">Найбільше відгуків</option>
                <option value="reviews-growth">Ріст відгуків</option>
                <option value="discount">Найбільша знижка</option>
              </select>
              <label className="check discount-toggle" title="Лише товари з активною знижкою (за ціною для покупця)">
                <input
                  type="checkbox"
                  checked={discountOnly}
                  onChange={(e) => setDiscountOnly(e.target.checked)}
                />{' '}
                Зі знижкою
              </label>
            </div>
            {visible.length === 0 ? (
              <div className="hint">Нічого не знайдено.</div>
            ) : (
              <div className="grid">
                {visible.map((l) => (
                  <ListingCard
                    key={l.listingId}
                    listing={l}
                    isNew={newIds.has(l.listingId)}
                    onOpen={openListing}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        <ScanHistory scans={scans} />
      </div>
    </div>
  )
}
