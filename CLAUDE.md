# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Linux desktop app (Electron + React + TypeScript) that **watches Etsy shops** through the **official Etsy Open API v3**. You paste links to Etsy shops; the app reads every active listing of each shop (title, description, price, tags, quantity, images, dates), stores them in a local SQLite database, and on every rescan ("Сканувати повторно") tells you which listings are **new since the previous scan** — plus which disappeared, came back, or changed price/title. The user's own Etsy API key (keystring + shared secret) is entered in the app's Settings. The UI language is Ukrainian; code and comments are English.

The stack, layout and look mirror `/home/andrii/Documents/conductor-linux` (same electron-vite / Vitest / tsconfig shapes, same dark design tokens and IBM Plex fonts, same `.claude/skills`).

## Commands

```bash
npm install          # Node ≥ 22.13 (node:sqlite unflagged); no native modules — nothing to rebuild for Electron
npm run dev          # run in dev (electron-vite, HMR for renderer)
npm run typecheck    # tsc --noEmit over tsconfig.node.json + tsconfig.web.json
npm run build        # typecheck, then build main/preload/renderer into out/
npm run dist         # build then package AppImage + deb (electron-builder, Linux)
npm test             # run the Vitest suite (shared + main + renderer)
bash scripts/install-desktop.sh   # register dist/*.AppImage as a menu app with icon
```

Correctness gates: `npm test` (Vitest) for behaviour and `npm run build` for types — `build` runs `tsc --noEmit` on both tsconfigs **before** electron-vite, because electron-vite/esbuild and Vitest never typecheck. `tests/` is not typechecked. No linter or formatter is configured.

**Rebuilding the installed app (only when asked).** If the user runs the app from the installed application-menu icon, that runs the packaged `dist/etsy-tracker-<version>.AppImage` — `npm run build` alone only refreshes `out/`. To get a change into the installed app, run the `rebuild-and-restart-app` skill (`npm run dist` → `bash scripts/install-desktop.sh` → kill + relaunch). Do this only when the user asks. See `.claude/skills/rebuild-and-restart-app` for the exact steps and Linux gotchas (pkill self-match, sandbox can't signal the GUI app, stale SingletonLock). Before any commit, follow `.claude/skills/verify-before-commit`.

Sandbox note: inside the Claude Code tool sandbox Electron can't use Chromium's SUID sandbox or the GPU; for a smoke run use `npx electron-vite dev --noSandbox -- --disable-gpu`. The user's own `npm run dev` works without those flags.

## Architecture

Three Electron processes, each a separate electron-vite build target (`electron.vite.config.ts`). Types shared via `src/shared/types.ts`; the renderer imports `src/shared/*` through the `@shared` alias (main/preload use relative `../shared/...`).

- **main** (`src/main/`) — Node side. Owns the database, the API key, and **all** Etsy traffic. Pure functions per concern, wired together in `ipc.ts`:
  - `db.ts` — `node:sqlite` schema, migrations, row mapping, queries. Every function takes the `Db` handle.
  - `etsyApi.ts` — the HTTP client (`createEtsyClient`), errors, quota/Retry-After parsing.
  - `mapEtsy.ts` — Etsy JSON → our records (`mapListing`, `mapImages`, `mapShop`).
  - `scanner.ts` — scan orchestration + the pure diff (`diffListings`, `trackedDiff`, `applyScan`).
  - `shops.ts` — `addShop` (parse link → `findShops` → insert).
  - `settings.ts` — API-key store (`createKeyStore`) with injectable safeStorage.
  - `ipc.ts` — `registerIpc(ctx)` + `testKey`, `scanAll`; `index.ts` builds the context (db path, key store, client, scanner) and the window.
- **preload** (`src/preload/index.ts`) — a single typed `window.api` over `contextBridge` (sandbox on, contextIsolation on, nodeIntegration off). The `Api` type is derived from this object (`src/renderer/src/env.d.ts`).
- **renderer** (`src/renderer/src/`) — React 18 + one `zustand` store (`store.ts`). No Node access, no network except images; everything goes through `window.api`.
- **shared** (`src/shared/`) — `types.ts`, `shopUrl.ts` (link parser), `html.ts` (entity decoding), `format.ts` (price/date/staleness), `externalUrl.ts` (which URLs may open in the browser).

### Database (`src/main/db.ts`)

Built-in **`node:sqlite`** (`DatabaseSync`) — works in Electron 38 and in system Node 22, so there are no native modules and tests use a real SQLite (`openDb(':memory:')`). The module is loaded lazily via `process.getBuiltinModule('node:sqlite')` inside `loadSqlite()`, which temporarily wraps `process.emitWarning` to swallow only the one-time "SQLite is an experimental feature" ExperimentalWarning (a top-level import would be hoisted above any filter in the CJS bundle). Only `import type` from `node:sqlite` elsewhere.

File: `<userData>/etsy-tracker.db` (WAL, `foreign_keys = ON`). `userData` is pinned in `index.ts` to `~/.config/etsy-tracker` (same for dev and packaged builds, independent of productName). `index.ts` also pins `app.setName('etsy-tracker')` (package.json has no `productName`, and electron-builder's `productName` is not written into the packaged package.json): Linux safeStorage names its keyring secret after the app name and X11 uses it as WM_CLASS, which `scripts/install-desktop.sh` matches with `StartupWMClass=etsy-tracker`.

**Migrations:** `MIGRATIONS` is an append-only array of SQL strings; `PRAGMA user_version` holds how many have run. `migrate(db, migrations = MIGRATIONS)` applies each pending one in its own transaction (a failing one rolls back and leaves `user_version` unchanged — tested with an injected list) and refuses a db whose version is newer than the app knows. Never edit a shipped entry — add a new one (and a test in `tests/main/db.test.ts`).

Schema (v1):
- `shops` — `id` = Etsy `shop_id` (PK), `shop_name` (UNIQUE, NOCASE), `title`, `url`, `icon_url`, `currency`, `etsy_active_count`, `added_at`.
- `listings` — `listing_id` (Etsy id, PK), `shop_id` (FK cascade), `title`, `description` (HTML entities already decoded), `price_amount` + `price_divisor` + `currency` (Etsy `Money` kept exactly: value = amount / divisor, no floats), `url`, `tags` (JSON), `quantity`, `etsy_created_at` / `etsy_updated_at` (Etsy epoch **seconds**), `images` (JSON `ListingImage[]` sorted by rank), `first_seen_at`, `last_seen_at`, `removed_at` (our epoch **ms**; `removed_at IS NULL` = active). Rows are never deleted when a listing disappears — only marked.
- `scans` — `status` `running|ok|error`, `error`, `is_baseline`, `truncated`, totals `total/added/removed/changed/returned`.
- `scan_changes` — `(scan_id, listing_id, kind, old_value, new_value)`; kind `added|removed|changed|returned`; old/new are JSON `TrackedFields` holding only the changed fields (`title`, and/or `priceAmount/priceDivisor/currency`).

`upsertListing` with `images: null` keeps the stored images (used when a listing wasn't re-fetched); `[]` replaces them. `deleteShop` removes the shop's listings, scans and changes in one transaction.

### Etsy API client (`src/main/etsyApi.ts`)

- Base `https://openapi.etsy.com`, paths `/v3/application/...`. Header on **every** request: `x-api-key: <keystring>:<shared_secret>` — since 2026-02-09 Etsy rejects the keystring alone, so the app asks for both halves (`composeApiKey` in `settings.ts`). No OAuth: only public endpoints are used.
- Endpoints: `GET /openapi-ping` (key check → `{application_id}`), `GET /shops?shop_name=&limit=100[&offset=]` (findShops — a name *search*, may be fuzzy, so we keep only an exact case-insensitive `shop_name` match and page on, up to `FIND_SHOP_MAX_PAGES` = 5, while it isn't found and `count` says there is more; no match is `count: 0`, not 404), `GET /shops/{id}`, `GET /shops/{id}/listings/active` (paginated, **no `includes`** → no images), `GET /listings/batch?listing_ids=1,2,3&includes=Images` (≤100 ids, comma-separated, no brackets), `GET /listings/{id}?includes=Images` (`getListing`, null on 404). Never `GET /shops/{id}/listings` — it needs OAuth `listings_r`.
- **Batch 404s:** the OAS documents a 404 for `/listings/batch` (likely when an id is unknown — deleted / no longer public; unverified live). `getListingsByIds` therefore bisects a chunk answered 404 or 400 down to single `GET /listings/{id}` calls; a single-id 404 means "gone" (left out of the result), any other error still throws. Without this, a deleted listing would make every rescan of its shop fail forever.
- Paging caps: `limit` ≤ 100, `offset` ≤ 12000 → at most ≈12,100 listings per shop. `getAllActiveListings` loops `offset += 100` until `offset >= count`, an empty page, or past the cap; dedupes by `listing_id`; sets `truncated` when `count > 12100`.
- Requests are serialized through one promise chain with a minimum gap (`minIntervalMs`, default 125 ms). 429 → wait `Retry-After` (seconds or HTTP date) + jitter, else exponential backoff; a `Retry-After` beyond `maxRetryAfterMs` (60 s — the daily quota) fails fast. 5xx and network errors → backoff retry. Up to `maxRetries` (4). Every attempt has a timeout (`requestTimeoutMs`, default 30 s, via `AbortController` covering headers and body); a timeout is retried at most `maxTimeoutRetries` (1) times, then fails as a `network` error "Etsy не відповідає (тайм-аут 30 с)…" — so a stalled connection can't block the serialized queue (ping, findShops, other scans) for minutes. 401/403 → `auth`, 404 → `not_found`, 400 → `bad_request`; each `EtsyApiError` carries a Ukrainian `message`, `kind`, `status`, Etsy's `{"error"}` text as `detail` and `x-etsy-request-uuid` as `requestId`.
- Quota: `x-limit-per-day`, `x-remaining-today`, `x-limit-per-second`, `x-remaining-this-second` are parsed from every response (`parseQuota`) and pushed to the renderer (`quota:changed`, shown in the sidebar footer). Limits are per key and are never hardcoded.
- `fetch`, `sleep`, `random`, `now` are injectable — tests run against a fake Etsy, never the network.
- UNVERIFIED API details are coded defensively: entity decoding of title/description/tags (`shared/html.ts`), fuzzy findShops, what `/listings/batch` does with unknown ids (skip vs 404), the exact `x-remaining-this-second` header name, whether a Seller-App key can read other shops.

### Scan & diff semantics (`src/main/scanner.ts`)

`createScanner({db, client, now, onProgress}).scanShop(shopId)`:
1. Refuses if that shop is already scanning (`busy`), inserts a `running` scan row.
2. `getShop` (refreshes title/icon/count; a vanished shop → 404 error), then pages all active listings.
3. Fetches details (images) via the batch endpoint **only** for listings that are new, returning, image-less, or whose `updated_timestamp` changed — an unchanged rescan costs ~1 request per 100 listings. A listing deleted between paging and this call (404) is still saved from its page data, without images (re-fetched next scan since it's image-less).
4. Listings stored as active but missing from the pages are **re-checked** through the batch endpoint (they may just have shifted between pages); only those not `state: 'active'` in this shop — or unknown to Etsy (404) — count as removed. When the set was `truncated`, removal detection (and this re-check) is skipped entirely and the scan row gets `truncated = 1` (UI warns "≈12 100").
5. One transaction (`applyScan`): update shop info, upsert every current listing, mark removed ones, insert `scan_changes`, finish the scan row `ok` with totals.

Rules:
- **Baseline:** a shop's first successful scan (`!hasOkScan`) saves everything but records no changes (`is_baseline = 1`, counts 0). UI: "Базове сканування: збережено N товарів".
- **added** = `listing_id` never seen before; **returned** = stored with `removed_at` and active again (its own kind — not counted as new, no NEW badge, shown in a separate "Повернулися" group); **removed** = active before, gone now; **changed** = title or price differs (price compared by value: `a1*d2 != a2*d1`, or a currency change).
- **Failure:** all network I/O happens before the transaction, so any error (network, 429 exhaustion, API error mid-pagination or mid-details) leaves listings untouched and only marks the scan row `error` with the Ukrainian message. The shop summary then has `lastScan` (failed) ≠ `lastOkScan`, and the UI shows the error above the previous results.
- Scans left `running` by a crash are closed as `error` when the scanner is created (`failStaleRunningScans`).
- `scanAll` (ipc.ts) scans shops sequentially and stops early on an API-key error.
- Progress events (`scan:progress`): `Сторінка 2/5`, `Деталі 100/430`, `Перевірка зниклих …`, `Збереження…`; `scan:state` brackets each scan.

### API-key storage (`src/main/settings.ts`)

`<userData>/settings.json` (mode 0600) holds `apiKey: {data, encrypted}` — the full `keystring:secret`, encrypted with Electron `safeStorage` when `isEncryptionAvailable()`, otherwise plaintext. The renderer only ever gets `KeyStatus {hasKey, masked: 'abcd…wxyz', encrypted}`; `encrypted` is false for the Linux `basic_text` backend (hardcoded password) too, and the UI then shows a warning. A stored encrypted key that fails to decrypt (keyring locked/unavailable/changed) gives `{hasKey: false, unreadable: true}` — Settings and the shop view then say "Збережений ключ не вдалося розшифрувати… — введіть ключ ще раз" instead of "Ключ не задано". `key:test` can ping with typed-but-unsaved values or with the stored key.

### Security

- All Etsy calls from main; the renderer has no API key and no network access other than images.
- Renderer runs with `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`. The preload must import nothing but `electron` at runtime (type-only imports are fine) — `tests/main/preload.test.ts` enforces it.
- CSP (`src/renderer/index.html`): `img-src 'self' data: https://i.etsystatic.com https://*.etsystatic.com`; scripts self only.
- `setWindowOpenHandler` → deny; `will-navigate` is blocked; external links go through `shell:openExternal`, which only opens `https://` URLs on `etsy.com` / `*.etsy.com` (`shared/externalUrl.ts`).
- Descriptions are rendered as plain text (`white-space: pre-wrap`) — never `dangerouslySetInnerHTML`.
- Etsy API terms: listing data shown should be ≤ 6 h old (`isStale` → a banner suggests rescanning); the required trademark notice is in the footer and Settings → "Про програму"; images are hotlinked from Etsy's CDN, never downloaded.

### UI map (`src/renderer/src/components/`)

- `App.tsx` — layout + event subscriptions; main area: `NoKeyState` (no key and no shops; how-to-get-a-key steps from `KeyHelp`), `NoShopsState`, or `ShopView`; global error banner; trademark footer.
- `Sidebar.tsx` — shop list (icon, name, active count, `+N` new badge, spinner + progress label, "помилка сканування"), "+ Додати магазин", settings gear (red dot without a key), "Сканувати всі", daily quota.
- `ShopView.tsx` — header (icon, name, link to Etsy, last scan time, "Сканувати повторно" / "Видалити" with confirm), banners (no key / failed scan / stale data / never scanned), `ScanResults` (new listings first as cards, then collapsible "Повернулися", "Зникли", "Змінились (ціна/назва)"), the grid of all active listings with search (title/tags) and sort (`listingFilter.ts`: новіші / ціна ↑ / ціна ↓), NEW badge on listings added by the latest scan, and `ScanHistory`.
- `ListingModal.tsx` — gallery, price, facts, tags, plain-text description, "Відкрити на Etsy". `HistoryModal` (in `ScanHistory.tsx`) — one past scan's changes grouped by kind.
- `SettingsModal.tsx` — key status (masked), Keystring + Shared secret (password) inputs that always start empty, Зберегти / Перевірити ключ / Видалити ключ, help, about + trademark notice.
- `AddShopModal.tsx` (validates with `parseShopInput` before calling main), `ConfirmModal.tsx` (in-app confirm; native `confirm()` breaks focus on Linux).
- Every modal closes on Escape through `useEscape(onClose, open)` (`components/useEscape.ts`): one document-level keydown listener and a stack, so only the most recently opened modal closes (focus usually stays on the button outside the modal, so a backdrop `onKeyDown` would never fire). `App` renders `HistoryModal` before `ListingModal` so a listing opened from the history sits on top.
- `store.scanAll` resets only the shops it marked as scanning, never one with its own `scanShop` still in flight (main reports each shop done during scanAll, so the user can rescan it meanwhile).

Shop link parsing (`shared/shopUrl.ts`) treats a link as a listing link only when `listing` is the first path segment (after an optional locale) — a shop may be named "Listing". It accepts `etsy.com/shop/Name` with/without scheme/`www`, `http`, `m.etsy.com`, locale prefixes (`/uk/shop/…`, `/en-gb/shop/…`), query/hash, trailing slash, extra path (`/reviews`), `Name.etsy.com`, or a bare name; rejects listing links, non-Etsy hosts, Etsy's own subdomains and names that aren't letters+digits.

## Testing conventions

Vitest, `tests/` mirrors `src/`: `tests/shared/*`, `tests/main/*`, `tests/renderer/*` (+ `components/`). Renderer tests start with `// @vitest-environment jsdom` (default env is `node`); `tests/setup.ts` adds jest-dom and RTL cleanup.

- **Fake Etsy, never the network:** `tests/helpers/fakeEtsy.ts` (`FakeEtsy`) serves the real endpoint shapes over a mutable `listings` array (paging, batch ≤100, `GET /listings/{id}`, `includes=Images`, 404s) with an `intercept(url, n)` hook for injecting 4xx/5xx/429/network failures; `.client()` returns a client with no-op sleep. `batchUnknown: '404'` makes `/listings/batch` fail with 404 when any id is unknown (splice a listing out of `listings` to "delete" it); the default `'skip'` silently leaves unknown ids out. `tests/helpers/fakeFetch.ts` (`fakeFetch`, `queuedFetch`) for request-level client tests. JSON fixtures in `tests/fixtures/` are shaped exactly like Etsy's responses.
- **Real SQLite:** `tests/helpers/db.ts` (`memDb()`, `seedShop`, `mkInput`, `mkListing`) — an in-memory `node:sqlite` db per test, no Electron.
- **safeStorage mock:** `tests/helpers/safeStorage.ts` (`fakeSafeStorage(available, backend)`); key-store tests use temp files.
- **Electron in main tests:** `vi.mock('electron')` + `vi.hoisted` (see `tests/main/ipc.test.ts`, which captures `ipcMain.handle` handlers). `tests/main/preload.test.ts` imports the real preload against a mocked `ipcRenderer` and checks every invoked channel has an `ipcMain.handle` and every subscribed channel is sent by main — add new channels on both sides.
- **Renderer:** `tests/renderer/helpers.ts` — `makeApi()` (fully stubbed `window.api`), `setupRenderer()` (installs it, clears localStorage, resets the store), builders `mkShop`, `mkScan`, `mkListing`, `mkChange`, `withKey` / `noKey`. Wrap clicks that trigger async store updates in `act(async () => …)` so the suite stays free of act() warnings.
- Cover both the happy path and the failure branches (bad key, 404, 429, mid-scan failure leaves state untouched).
