# 2026-07-19 — AgriEvent: real coverage, typed read side, palette reach

**Commit:** `<pending>` feat(events): behavioural coverage, exhaustive category map, palette entry

Follow-up to `2026-07-19-agri-events-finish.md`, which resolved the
FINISH-vs-RETIRE fork and built the population + curation paths. This PR is the
polish pass. Three of its four subpoints rested on premises that did not survive
contact with the code; each is recorded below with what replaced it.

## 1. Real tests, replacing a `typeof` assertion

`agriculture-usecases.test.ts` asserted `typeof listUpcomingAgriEvents ===
'function'` — that the export existed, and nothing about what it did. Replaced
by `tests/unit/agri-events-list.test.ts`, which pins the three properties a
reader actually depends on:

- **"Upcoming" includes an event that has already started** but not ended — the
  predicate keys on `endsAt`, so a multi-day fair you can still travel to stays
  in the feed. A past event matches neither arm; a future event with no end date
  matches the second.
- **Soonest-first**, so a deadline three days out cannot sort below a fair three
  months out.
- **The take clamp** — default 50, honoured inside the range, capped at 100, and
  floored at 1 so `?limit=0` can't send `take: 0`.

The old file keeps its `import * as agriEvents` (so its
`usecase-test-coverage` contribution is unchanged) with a pointer to the new
file.

`/events` joined the `PAGES` list in `horizontal-drift.spec.ts`, and
`tests/e2e/mobile/events.spec.ts` is a new read-only `@mobile` spec on the
shared seeded tenant. Unlike the `/trends` and `/news` specs — which assert
shell-only because their data is env-gated — this one asserts **real content**,
because the previous PR wired the catalogue into `prisma/seed.ts`. If it ever
fails with an empty feed, the seed wiring has regressed, which is precisely the
defect the page shipped with. It asserts link *safety attributes*
(`target=_blank` + `rel=noopener`, https href) rather than a specific URL, so
re-curating the seed doesn't break it.

## 2. Category — closing the read side

The previous PR closed the **write** side (`AGRI_EVENT_CATEGORIES` + a zod enum
at the platform-admin boundary). The read side was still
`switch (c) { … default: return t('catFair') }`, which meant an unrecognised
category was **presented to a farmer as a trade fair** — a subsidy deadline
mislabeled as an exhibition is a worse failure than showing nothing.

Now a `Record<AgriEventCategory, string>` of i18n keys: exhaustive by type, so
adding a category without a label is a compile error. The runtime fallback
renders the **raw value** rather than asserting a category we don't know — rows
predating the write-side validation can still hold arbitrary strings.

## 3. `formatDateRange` — applied to spans only

**The premise was that this is a drop-in swap. It isn't.**
`formatDateRange(startsAt, null)` renders **"From 16 Apr 2026"**, not
"16 Apr 2026" (`format-date.ts:291`, locked by
`tests/unit/format-date-range.test.ts:69`).

Most of this feed has no end date — three of the four seed rows, and every
webinar and deadline by nature. "From" is wrong for a one-day training and
actively **inverts the meaning** of a subsidy deadline: it reads as the opening
of an application window rather than the date a farmer must act by.

So the helper is applied to real spans only, and single dates keep `formatDate`.
This satisfies what the `format-date` docblock actually prohibits — hand-built
` – ` separators, which sidestep its same-month / same-year collapsing — without
degrading the majority case. (That rule is documented but unenforced: the
separator `it()` block in `date-display-consistency.test.ts` was never
implemented, so this was a correctness fix, not a ratchet fix.)

## 4. Shell fork — both arms turned out to be unreachable

The fork was "adopt `EntityListPage`, or add `/events` to the Epic-52 exemption
list". Neither is available:

- **`EntityListPage` structurally requires a table.** `table` is a required
  prop, `EntityListPageTable` requires `data` + `columns`, and the component
  renders `<DataTable>` unconditionally with no `children`-instead-of-table
  escape hatch. A read-only `<ul>` of cards would have to pass `columns: []` and
  render the feed into `children`, mounting a visible empty table shell above
  it.
- **The Epic-52 exemption list cannot see this page.** Its guard short-circuits
  on `if (!f.importsDataTable) continue;` before any exemption lookup, and
  `/events` imports nothing from `@/components/ui/table`. An entry there would
  claim the page was considered and rejected for the shell, when the ratchet
  never evaluates it at all.

So the bespoke feed stays, unchanged in layout (the page rendering was on the
PRESERVE list). `ListPageShell` — the lower-level primitive that gives the
viewport-clamped chrome without a table — is the available upgrade if the feed
ever wants it, and would not affect the ratchet.

## 5. Command palette — and the i18n hole it exposed

**The premise that offers / news / trends have palette entries to copy is
false.** The palette has *no* agri entries at all; its Navigation group is the
original compliance seven, one of which (`nav:risks`) points at a page the
sidebar comment says was removed. The registry has drifted from the nav.

Worse, **every command label was hardcoded English** in a Bulgarian-first
product — while the surrounding palette chrome (group headings, placeholder,
empty states) already resolved through the `commandPalette` namespace. The
labels escaped the no-hardcoded-UI-strings ratchet only because they live in a
`.ts` hook rather than JSX, where the AST scan can't see them.

Adding one Bulgarian label beside eight English ones would have looked broken,
so all ten labels now resolve through the existing namespace (10 key pairs), and
the new `nav:events` entry joins them.

**The entry is unconditional**, unlike the sidebar's, which hides on an empty
catalogue. The palette derives its tenant from the *pathname* precisely so it
can render outside `TenantProvider` (on `/login`), so it has no access to
`agriEventsAvailable`, and `useTenantContext` throws without a provider. Gating
would mean adding an optional-context accessor to serve one entry. This matches
the palette's documented model — it lists `nav:admin` for every user and leans
on server-side gates — and the page's own empty state makes the worst case
honest rather than misleading.

One known gap: `filterPaletteCommands` is a substring match on the label with no
keyword/alias field, so a user typing „събития" matches only while the UI is in
Bulgarian. Cross-locale aliases would need a `keywords` field on
`PaletteCommand` — out of scope here, and it affects all ten commands equally.

## Files

| File | Role |
|------|------|
| `tests/unit/agri-events-list.test.ts` | **New** — behavioural coverage of the read. |
| `tests/unit/agriculture-usecases.test.ts` | Smoke assertion removed; import + pointer kept. |
| `tests/e2e/mobile/events.spec.ts` | **New** — read-only `@mobile` content + link-safety spec. |
| `tests/e2e/mobile/horizontal-drift.spec.ts` | `/events` added to `PAGES`. |
| `.../(app)/events/page.tsx` | Exhaustive category map, span-only `formatDateRange`, stable ids for e2e. |
| `src/components/command-palette/use-palette-commands.ts` | Labels i18n'd; `nav:events` added. |
| `messages/{en,bg}.json` | 10 `commandPalette` label keys. |
