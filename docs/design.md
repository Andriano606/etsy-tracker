# Design guide

How the app's UI is built. Read it before you change a screen. The building blocks live in
`src/renderer/src/ui/` (import from `'../ui'` or `'../../ui'`), styled in `src/renderer/src/styles/base.css`
(every component class starts with `ui-`). Plain-language explanations live in the **glossary**
(`src/shared/glossary.ts`).

## 1. Who we design for

Someone who has **never used Etsy or this app**. They don't know what a listing, a scan, VAT, a
featured position or an API key is. So:

- Every Etsy or technical concept gets an explanation **where it appears**: an ⓘ (`InfoTip`) after the
  label, or a dotted-underlined word (`Term`). The text comes from the glossary.
- Say **what a number means and why it matters**: not "Обране: 1 204", but a label "Обране" + ⓘ
  "Скільки людей додали товар в обране — показник інтересу…".
- Prefer Ukrainian words. English/API words (keystring, shared secret, MinIO, Docker, OAuth, scope,
  SKU, JSON…) only where the user must recognise them (e.g. the field names on Etsy's developer page),
  and then always with an ⓘ that explains them.
- Calm, predictable screens: one clear primary action per area, destructive actions red and confirmed,
  nothing that moves under the pointer.

## 2. Wording rules

- **Buttons are verbs** saying what happens: "Сканувати повторно", "Зберегти ключ", "Додати магазин",
  "Видалити магазин" — not "OK", "Так", "Далі" (except "Скасувати" / "Закрити").
- **Labels are nouns**, short, sentence case: "Країна покупця", "Ціна для покупця".
- **Help text** under a field says what to type and where to find it: "Скопіюйте зі сторінки свого
  застосунку на Etsy".
- **Errors** say what happened and what to do: "Etsy не відповідає. Перевірте інтернет і спробуйте ще
  раз." — never a raw code or English API text alone.
- **Empty states** say why it's empty and offer the way out (a button).
- **Numbers**: `uk-UA` formatting (`1 204`, `4,87`), a typographic minus `−3`, a sign on changes
  (`+12`, `formatSigned`). Show the unit or period ("за 30 днів", "з 01.10").
- Keep the glossary tone: "ви", short sentences, no exclamation marks.

## 3. Components

All take `className`. All are keyboard- and screen-reader-friendly; keep it that way.

### Button

```tsx
<Button variant="primary" icon="refresh" onClick={scan}>Сканувати повторно</Button>
<Button variant="danger" icon="trash" onClick={remove}>Видалити</Button>
<Button icon="settings" iconOnly label="Налаштування" onClick={open} />   // tooltip + aria-label
<Button busy>Сканування…</Button>                                          // spinner, disabled, aria-busy
```

`variant`: `secondary` (default outline) · `primary` (green, one per area) · `subtle` (filled grey) ·
`danger` (red outline, for "Видалити" before a confirm) · `danger-solid` (the confirm button itself) ·
`ghost` (text-only). `size`: `md` (34 px) · `sm` (28 px). `tooltip` adds a hint. `fullWidth`. It renders
the legacy `.btn` classes, so old and new buttons look the same; `buttonClass(variant, size)` gives the
class string for an `<a>` or a custom element.

### Icon

```tsx
<Icon name="heart" />  <Icon name="star" size={14} />  <Icon name="warning" title="Увага" />
```

24-grid SVG, 1.75 px stroke, `currentColor`. Decorative unless `title` is given. Names (`ICON_NAMES`):
refresh scan stats chart info help settings plus minus edit trash external search photo money percent
tag box truck store star heart eye review check warning error success close more chevron-down/up/left/right
arrow-up/down clock calendar history copy link download upload filter sort list grid user key lock server
database globe file draft folder sparkle power play stop menu bell sun pause receipt wallet layers image
video logout login. **Use icons instead of emoji** in new UI (emoji render differently per system); keep
one icon per meaning (stats = `stats`, scan = `refresh`, delete = `trash`, external = `external`).

### Toggle — instead of every checkbox

```tsx
<Toggle
  label="Зі знижкою"
  hint="Показати лише товари, на які зараз діє акція"
  glossary="promotion"
  checked={discountOnly}
  onChange={setDiscountOnly}
/>
```

A real `<input type="checkbox" role="switch">`: tests use `getByRole('switch', {name})` or
`getByLabelText(label)` + `toBeChecked()`, and `userEvent.click`. The **label alone** is the accessible
name; `hint` is its description (one line, what switching does). The whole row is clickable. Props:
`disabled`, `id` (keep an existing id), `ariaLabel` (no visible label), `size="sm"`, `switchFirst` (switch
on the left — for a toggle inside a toolbar). Use a Toggle for on/off settings and filters; use
`Segmented` for a choice between named options.

### InfoTip, Term, Tooltip — explanations

```tsx
<label>Перегляди <InfoTip glossary="views" /></label>
<p>Ціна з <Term glossary="vat" /> і доставкою</p>           // shows "ПДВ", dotted underline
<Term glossary="favorites">в обраному</Term>                 // custom visible text
<InfoTip text="Рахується між двома скануваннями." />         // one-off text (prefer the glossary)
<Tooltip content="Оновити всі магазини"><button>…</button></Tooltip>
```

Hover or keyboard focus shows the bubble; a click/tap pins it (and shows the entry's `long` text);
Escape, blur or a click elsewhere closes it. The text is always in the DOM (a `hidden` span referenced by
`aria-describedby`), so tests can assert `toHaveAccessibleDescription(...)` without opening anything.
The InfoTip button is named "Що таке «term»?" (`label` overrides). Bubbles are portalled into
`<body>`, `position: fixed`, flip above/below and are clamped into the window — they are never cut off
by a scrolling container or a modal. Inside a modal, Escape closes the tip first, then the modal. An
InfoTip/Term inside a `<label>` does not toggle the labelled control. Don't put a Term inside a button.

### Field — form rows

```tsx
<Field label="Keystring" glossary="keystring" hint="Скопіюйте зі сторінки застосунку" required error={err}>
  <input value={v} onChange={(e) => setV(e.target.value)} />
</Field>
<Field label="Порт" aside="1024–65535">{(p) => <input type="number" {...p} />}</Field>
```

The child gets `id` (its own, the `id` prop, or a generated one), `aria-describedby` (its own + hint +
error), `aria-invalid` and `required`. `error` renders under the control with `role="alert"`. The `*`
sits outside the `<label>`, so `getByLabelText('Keystring')` matches exactly. `aside` = something at the
right of the label row (a counter "12/140"). Two or more fields side by side: wrap them in
`<div className="ui-form-grid">` (wraps to one column when narrow).

All `input`/`select`/`textarea` are styled globally in the dark theme (low specificity, area CSS wins):
34 px high, `--bg-input`, green border + ring on focus, red when `aria-invalid`.

### Select

```tsx
<Select value={country} onChange={setCountry} options={[{ value: 'UA', label: 'Україна (UA)' }]} />
```

Native `<select>` (keyboard, screen reader, never clipped) with the dark style and a chevron; `fullWidth`.
`<option>` children work too. Every plain `<select>` in the app already looks the same.

### Segmented — 2–5 options

```tsx
<Segmented label="Період" value={range} onChange={setRange}
  options={[{ value: 'all', label: 'Усе' }, { value: '30d', label: '30 днів', hint: 'Останній місяць' }]} />
```

Native radio inputs in a `role="radiogroup"`: `getByRole('radio', {name})` + `toBeChecked()`, arrow keys
move. `size="sm"`, `fullWidth`, per-option `icon`, `hint` (tooltip), `disabled`. Wraps instead of
overflowing. More than 5 options → a `Select`.

### Tabs

```tsx
<Tabs label="Розділи магазину" value={tab} onChange={setTab}
  tabs={[{ id: 'info', label: 'Магазин', icon: 'store' }, { id: 'orders', label: 'Замовлення', badge: 3 }]}>
  {tab === 'info' ? <ShopInfo /> : <Orders />}
</Tabs>
```

Horizontal tabs **never overflow**: what doesn't fit moves into a "Ще ▾" menu at the end (the active tab
always stays visible; the menu button is named "Ще вкладки (N)"). `orientation="vertical"` = a column
beside the panel for many tabs in a wide modal; below 640 px of container width it becomes a scrolling
row above the panel. Keyboard: ←/→/↑/↓ select the previous/next enabled tab (including tabs hidden in the
menu), Home/End the first/last. `children` is the active panel (`role="tabpanel"`, labelled by its tab);
to render the panel elsewhere, omit children and spread `tabPanelProps(idBase, value)` on it (pass the
same `idBase`). Tab extras: `badge`, `icon`, `hint` (tooltip), `disabled`. Tests:
`getByRole('tab', {name})`, `getByRole('tabpanel')`.

### ActionBar — a row of buttons that never overflows

```tsx
<ActionBar label="Дії з магазином" align="end" actions={[
  { id: 'scan', label: 'Сканувати повторно', icon: 'refresh', variant: 'primary', onClick: scan, busy: scanning },
  { id: 'stats', label: 'Статистика', icon: 'stats', onClick: openStats },
  { id: 'photos', label: 'Синхронізувати фото', icon: 'photo', onClick: syncPhotos, hint: 'Скопіювати нові фото у сховище' },
  canDelete && { id: 'delete', label: 'Видалити', icon: 'trash', variant: 'danger', onClick: askDelete }
]} />
```

List actions **in priority order, the primary first**. It measures itself (ResizeObserver) and moves the
actions that don't fit — from the end — into a "⋯" menu ("Ще дії"); `primary` and `pinned: true`
actions always stay, and the bar's `min-width` is set to fit them. Falsy entries are skipped. Action
fields: `label`, `icon`, `variant`, `disabled`, `busy`, `hint` (tooltip + second line in the menu),
`iconOnly` (always icon-only, with the label as tooltip), `pinned`. Danger actions are red in the menu
too. `size="sm"`. The bar is `flex: 1 1 0` — in a header put it **next to** a title that can truncate:

```tsx
<div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
  <h1 className="truncate" title={name}>{name}</h1>
  <ActionBar align="end" actions={…} />
</div>
```

In jsdom there is no layout, so every action renders inline exactly once (old `getByRole('button',
{name})` tests keep working). To test the overflow, fake widths (see `tests/renderer/ui/measure.ts`).
For a menu that is always a menu (row actions, "more" in a card) use `Menu` directly.

### Menu

```tsx
<Menu label="Ще дії" items={[
  { id: 'edit', label: 'Редагувати', icon: 'edit', onSelect: edit },
  { id: 'delete', label: 'Видалити', icon: 'trash', danger: true, onSelect: askDelete, hint: 'Назавжди' }
]} />
<Menu label="Сортування" trigger="Новіші" buttonClassName="btn" items={…checked…} />
```

Menu-button pattern: `aria-haspopup="menu"`, ↓/↑ open it, ↓/↑/Home/End move, Enter chooses, Escape
closes and refocuses the trigger, Tab or a click outside closes. Items: `icon`, `hint`, `danger`,
`disabled`, `checked` (→ `menuitemcheckbox`). Default trigger = "⋯" icon named by `label`; a string
`trigger` is its own name. The list is portalled and kept inside the window.

### Modal — the shell for every dialog

```tsx
<Modal title="Налаштування" subtitle="Ключ доступу, країна покупця, сховище фото" size="lg"
  onClose={close} className="settings-modal"
  footer={<>
    <span className="ui-modal-foot-start">Зміни застосуються з наступного сканування</span>
    <Button onClick={close}>Скасувати</Button>
    <Button variant="primary" onClick={save}>Зберегти</Button>
  </>}>
  …
</Modal>
```

Sizes `sm` 420 · `md` 560 · `lg` 820 · `xl` 1120 px, always `≤ 100vw − 32px` wide and `≤ 100vh − 32px`
high; the header (title, subtitle, `headerExtra`, ×) and the footer stay put, **`.ui-modal-body` scrolls**
(harness scenes scroll `.ui-modal-body`, not the dialog). It uses the shared `useEscape` stack (only the
topmost modal closes), closes on a backdrop click (`closeOnBackdrop={false}` to disable; a text selection
dragged out of the box doesn't close it) and on ×. Focus moves into the dialog when it opens (unless a
child has `autoFocus`), Tab cycles inside, and focus returns to the opener on close — **tests that assert
focus stayed on the opener must be updated**. `role="alertdialog"` + `size="sm"` for confirmations; the
backdrop keeps the legacy `modal-backdrop` class (old backdrop-click tests still find it). `open={false}`
renders nothing; mounting only while open also works (default `open = true`). Tests:
`getByRole('dialog', {name: title})`, `getByRole('button', {name: 'Закрити'})`.

Destructive confirm: a `Modal size="sm" role="alertdialog"` (or the app's `requestConfirm`) whose text says
what will be lost and what will **not** happen ("На Etsy нічого не зміниться"), buttons "Скасувати" +
`danger-solid` "Видалити …".

### Callout — messages inside a screen

```tsx
<Callout tone="warn" title="Дані застаріли" action={<Button size="sm" icon="refresh" onClick={scan}>Сканувати</Button>}>
  Останнє сканування було 2 дні тому.
</Callout>
<Callout tone="error" onClose={dismiss}>{error}</Callout>
```

`tone`: `info` · `success` · `warn` · `error` (`role="alert"`; others `role="status"`, `role` overrides —
use `"note"` for a static explanation). `title`, `action` (wraps under the text when narrow), `onClose`
(×), `icon` (or `false`), `compact`. Stack several in a `.ui-stack`.

### Badge, Stat, EmptyState, Spinner, Loading

```tsx
<Badge tone="accent">NEW</Badge>  <Badge tone="warn" icon="clock" hint="Дані старші за 6 годин">застаріло</Badge>
<div className="ui-stat-grid">
  <Stat label="Обране" glossary="favorites" value="1 204" delta={12} caption="за 30 днів" deltaHint="з 01.10 до 24.10" />
  <Stat label="Зникли" value="3" delta={2} lowerIsBetter />
</div>
<EmptyState icon="store" title="Ще немає магазинів" action={<Button variant="primary" icon="plus">Додати магазин</Button>}>
  Вставте посилання на магазин Etsy — програма збереже всі його товари.
</EmptyState>
<Spinner label="Сканування…" />   <Loading>Завантаження відгуків…</Loading>   <Loading inline>…</Loading>
```

Badge tones: `neutral` `accent` `info` `warn` `danger`, `solid`. Stat: a number delta gets a sign and
colour (growth green unless `lowerIsBetter`), a node delta is shown as is; `compact`, `icon`, `info`.
`.ui-stat-grid` lays tiles out responsively. EmptyState `compact` for a section inside a card.

## 4. Glossary workflow

- `src/shared/glossary/core.ts` — shared concepts (Etsy, listing, scan, favourites, VAT, API key…). Look
  there first: `GLOSSARY.vat`, `GLOSSARY.favorites`, `GLOSSARY.buyerPrice`… (full key list: the file).
- Your area's own terms go in **your** file `src/shared/glossary/<area>.ts` (`shell`, `shop`, `listing`,
  `stats`, `settings`, `myshop`, `features`), keys prefixed with the area: `'shop.lastScan'`.
  Declare entries with `satisfies GlossaryEntries` (not a type annotation), so keys stay literal and a typo
  in `glossary="…"` is a **type error**:

  ```ts
  export const SHOP = {
    'shop.lastScan': { term: 'Останнє сканування', short: 'Коли програма востаннє читала цей магазин з Etsy.' }
  } satisfies GlossaryEntries
  ```

- Entry rules (enforced by `tests/shared/glossary.test.ts`): `term` = what the UI calls it; `short` ≤ 140
  characters, plain Ukrainian sentence(s) ending with punctuation, no code-like text, no unexplained
  English (jargon like API/MinIO/MCP/SKU/Docker/OAuth/token may appear only in the entry that explains that
  very word); `long` optional (shown when the ⓘ is clicked); keys unique across files; terms unique (one
  concept, one entry — reuse core entries instead of copying them). The test also checks every
  `glossary="…"` used under `src/renderer/src` exists.
- Use `glossary="key"` on `InfoTip`, `Term`, `Field`, `Toggle`, `Stat`; for runtime keys there is
  `glossaryEntry(key)`.

## 5. Layout and responsive rules

The window is at least **900×560** (sidebar 272 px → the main area is ~628 px wide at minimum). Every screen
must look right at **900×560, 1280×820, 1680×1050**:

- **No horizontal page scroll; nothing sticks out of its container.** Flex/grid children that hold text
  need `min-width: 0`; long single-line text gets `.truncate` (+ a `title` with the full text); multi-line
  `.clamp-2` / `.clamp-3`; URLs and codes `overflow-wrap: anywhere`.
- **Button groups**: an `ActionBar` (collapses into "⋯"), or a `.ui-row` (wraps). Never a fixed-width row of
  buttons. Header pattern: truncating title + `ActionBar`.
- **Forms**: `Field`s in a `.ui-form-grid` (auto-fit columns ≥ 240 px). Inputs are `width: 100%` inside a
  Field.
- **Grids of cards**: `repeat(auto-fill/auto-fit, minmax(min(<px>, 100%), 1fr))`.
- **Modals**: the `Modal` shell (fits the window, body scrolls, sticky header/footer). Wide content inside
  (tables, charts) scrolls horizontally in its own wrapper (`overflow-x: auto`), never the dialog.
- **Tabs**: `Tabs` (overflow → "Ще"); many sections in a wide modal → `orientation="vertical"`.
- Sizes with `clamp()` where a fixed px would break (`flex: 0 0 clamp(170px, 24%, 240px)`). Container
  queries (`container-type: inline-size`) for components that live in panes of different widths.
- Helpers in base.css: `.ui-row` (wrapping flex row, gap 8), `.ui-stack` (column, gap 12), `.ui-spacer`,
  `.ui-card`, `.ui-section` + `.ui-section-title` + `.ui-section-desc`, `.ui-form-grid`, `.ui-stat-grid`,
  `.truncate`, `.clamp-2`, `.clamp-3`, `.min-w-0`, `.num` (tabular figures), `.sr-only`.

## 6. Visual tokens (base.css)

Keep the dark theme, the single green accent and IBM Plex. Use tokens, not raw values:

- Surfaces `--bg-app` < `--bg-2` (sidebar, modals, cards) < `--bg` (main) < `--bg-3` (raised) < `--bg-4`
  < `--bg-5`; inputs `--bg-input`. Borders `--hairline`, `--border`, `--border-strong`, `--border-control`,
  `--border-hover`.
- Text `--text` (headings, values) · `--text-body` (body) · `--text-dim` (labels, help; ≥ 4.5:1) ·
  `--text-faint` (decoration only — never for text that must be read).
- Status: `--accent` (+ `-soft`, `-line`, `--accent-on` for text on it), `--danger` (`--danger-text` for red
  text, `-soft`, `-line`), `--warn`, `--info` (each with `-soft`/`-line`). Green = good/live/primary only.
- Spacing on a 4 px grid: `--sp-1` 4 · `--sp-2` 8 · `--sp-3` 12 · `--sp-4` 16 · `--sp-5` 20 · `--sp-6` 24 ·
  `--sp-8` 32 · `--sp-10` 40 (`--sp-0` 2).
- Radii `--r-xs` 4 · `--r-sm` 6 (buttons, inputs) · `--r-md` 8 (cards, callouts, menus) · `--r-lg` 12 (modals)
  · `--r-pill`.
- Type `--fs-2xs` 11 · `--fs-xs` 12 (meta, help) · `--fs-sm` 13 (UI, buttons) · `--fs-md` 14 (body) ·
  `--fs-lg` 16 (section/empty titles) · `--fs-xl` 18 (modal titles) · `--fs-2xl` 22 (big numbers, page
  titles) · `--fs-3xl` 28; `--lh-tight` 1.25, `--lh` 1.5 for paragraphs.
- Controls `--control-h` 34, `--control-h-sm` 28. Shadows `--shadow-1`, `--shadow-pop`, `--shadow-modal`.
  Layers `--z-modal` 50, `--z-layer` 1000 (tooltips/menus above modals). Motion `--dur` 160ms, `--ease`;
  everything respects `prefers-reduced-motion`.
- Focus: every interactive element shows `:focus-visible` (2 px green outline); inputs show a green border +
  `--focus-ring`. Never remove focus styles without a replacement.
- Legacy classes (`.btn`, `.modal`, `.modal-backdrop`, `.field`, `.banner`, `.hint`, `.dim`, `.ok`, `.err`,
  `.empty-state`…) still work and now use the tokens; migrate to the components when you touch a screen.

## 7. Accessibility checklist

Every control has a name (label, `aria-label`, `Field`); icon-only buttons use `Button iconOnly label=…`;
groups have `aria-label`; errors use `Field error` / `Callout tone="error"`; keyboard reaches and operates
everything (Tab, Enter/Space, arrows in tabs/menus/segmented, Escape closes the topmost layer); text
contrast ≥ 4.5:1 (`--text-dim` or brighter); don't convey meaning by colour alone (add an icon or text).

## 8. Testing

- Components: `tests/renderer/ui/*.test.tsx`. Glossary: `tests/shared/glossary.test.ts`.
- Queries that keep working: `getByRole('switch', {name})` (was `checkbox`), `getByLabelText(label)` +
  `toBeChecked()`, `getByRole('radio', {name})`, `getByRole('tab', {name})`, `getByRole('dialog', {name})`,
  `toHaveAccessibleDescription(GLOSSARY.x.short)` for tips.
- Tooltip bubbles and menus are portalled into `document.body` — `screen` queries find them; a
  `within(container)` query won't.
- Wrap state-changing events in `act` / use `userEvent` so the suite stays free of act() warnings.

## 9. Verify with the UI harness

```bash
UIH_OUT=.ui-harness/build-<area> node_modules/.bin/electron-vite build --logLevel error
npx electron scripts/ui-harness/main.cjs --no-sandbox --disable-gpu --out=.ui-harness/build-<area> \
  --shots=.ui-harness/shots-<area> --scenes=<names> [--sizes=900x560,1280x820,1680x1050] [--signed-out]
```

It prints each PNG and "⚠ overflow: …" when something sticks out. **Look at every PNG** (Read tool) at all
three sizes: open each tab, section, modal, empty/error state in your scene file
(`scripts/ui-harness/scenes/<area>.cjs`; helpers `__h.click(text, sel)`, `clickSel`, `waitFor`, `open`,
`type`, `scroll('.ui-modal-body', y)`, `sleep`). Open a tooltip or a menu in a scene with
`__h.clickSel('.ui-infotip')` / `__h.clickSel('.ui-actionbar-more button')` to check it stays inside the window.
