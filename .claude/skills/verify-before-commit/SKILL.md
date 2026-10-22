---
name: verify-before-commit
description: Run BEFORE creating any git commit in this repo. Verifies that new functionality written during the session is covered by tests and that the existing test suite and build still pass. Use whenever the user asks to commit, or you are about to run `git commit` yourself.
---

# Verify before commit

A commit-time gate for etsy-tracker. Before any `git commit`, make sure new
code from this session is tested and nothing already-working broke.

The project's only correctness gates are **`npm test`** (Vitest) and
**`npm run build`** (`tsc --noEmit` on both tsconfigs, then electron-vite).
Tests live in `tests/`, mirroring `src/` (`tests/shared/**`, `tests/main/**`,
`tests/renderer/**`). There is no linter.

## When to run

Run this whole checklist when:
- the user says "commit", "закоміть", "зроби коміт", or similar, **or**
- you are about to run `git commit` for any reason.

Do **not** skip it because a change "looks trivial" — a one-line change to
`src/` can still break a test or leave new behavior uncovered.

## Steps

### 1. Find what changed in `src/`
```bash
git status --porcelain
git diff --stat HEAD 2>/dev/null || git status --porcelain --untracked-files=all
```
(Before the first commit `HEAD` does not exist yet, so `git diff HEAD` fails —
then every file is new and the fallback lists them all.)
List the changed/added **source** files under `src/` (ignore files already in
`tests/`, config, docs). These are the candidates that need test coverage.

### 2. Check coverage for each changed source file
For every changed `src/...` file, find its test:
- `src/shared/<x>.ts` → `tests/shared/<x>.test.ts`
- `src/main/<x>.ts` → `tests/main/<x>.test.ts`
- `src/renderer/src/<x>.ts` → `tests/renderer/<x>.test.ts`
- `src/renderer/src/components/<X>.tsx` → `tests/renderer/components/<X>.test.tsx`

For each new function, branch, or behavior added this session, confirm there is
a test asserting it. If coverage is **missing or incomplete**:
- Write the missing tests, following the patterns already in `tests/`:
  - **never hit the real Etsy API** — use the fake Etsy server
    (`tests/helpers/fakeEtsy.ts`: `FakeEtsy`, `mkEtsyListing`, `intercept` for
    4xx/5xx/429/network failures) or `tests/helpers/fakeFetch.ts`
    (`fakeFetch`, `queuedFetch`); keep `tests/fixtures/*.json` shaped exactly
    like Etsy's responses
  - use a **real in-memory `node:sqlite` DB** (`tests/helpers/db.ts`:
    `memDb`, `seedShop`, `mkInput`, `mkListing`) — don't mock the database
  - mock Electron's safeStorage with `tests/helpers/safeStorage.ts`
    (`fakeSafeStorage(available, backend)`) and `electron` itself via
    `vi.mock` + `vi.hoisted` (see `tests/main/ipc.test.ts`)
  - a schema change = a **new** entry in `MIGRATIONS` (never edit a shipped one)
    plus a test in `tests/main/db.test.ts`
  - renderer tests use `// @vitest-environment jsdom` and
    `tests/renderer/helpers.ts` (`setupRenderer`, `makeApi`, `mkShop`,
    `mkScan`, `mkListing`, `mkChange`); a new `window.api` method needs a stub
    in `makeApi()`; wrap clicks that trigger async store updates in
    `act(async () => …)`
- Cover the happy path **and** the error/edge branches (the existing suite tests
  both — e.g. bad key (401/403), 404 shop, 429 exhaustion, failure mid-scan
  leaving the DB untouched, duplicate shop, empty input).
- If a behavior is genuinely not unit-testable, say so explicitly and explain
  why — don't silently skip it.

### 3. Run the full suite (catch regressions)
```bash
npm test
```
All tests must pass, with no new act() warnings. If any **previously passing**
test now fails:
- Decide whether the change is a real regression (fix the code) or an
  intentional behavior change (update the test **and** point the change out to
  the user — never quietly rewrite an assertion to make red go green).

### 4. Typecheck / build
```bash
npm run build
```
Must succeed. It runs `npm run typecheck` first — the only type-safety gate;
Vitest and electron-vite run through esbuild and do **not** typecheck.

### 5. Report, then commit
Only after steps 1–4 are green, summarize:
- which source files changed and which tests now cover them,
- new test count and that `npm test` + `npm run build` pass.

If the change affects architecture, the DB schema, the Etsy client, scan/diff
rules or test helpers, update `CLAUDE.md` in the same commit.

Then create the commit. If the user did not explicitly ask to commit, confirm
first. (Per repo convention, branch off `main` first if you're on it — except
for the very first commit, which goes straight onto `main` (`git status` says
"No commits yet"); there is nothing to branch from. End the commit message with
the required `Co-Authored-By` trailer.)

## Hard rules
- **Never commit with a failing `npm test` or `npm run build`.** If you can't get
  to green, stop and tell the user what's red and why.
- **Never** disable, `.skip`, or delete a failing test just to pass the gate.
- New behavior without a test is not done — add the test or flag it explicitly.
- Never commit a real Etsy API key (keystring or shared secret) — not in code,
  fixtures, or test files.
