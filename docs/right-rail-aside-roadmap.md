# Right-rail / aside-panel chrome — architecture brief

> **Status: Phases 0–4 implemented (2026-05-22).** This document
> began as a future-facing brief; the roadmap below was then built in
> full. It is kept as the design record — the rationale, the posture
> definition, and the acceptance criteria still govern any future
> rail surface. The original "if a right-rail is built" framing is
> left intact in the prose below for context; treat it as written
> *before* the build.
>
> **Implementation:**
> - **Phase 1** — `<AsidePanel>` primitive + `EntityDetailLayout`
>   rail slot; consumer: risks detail page (#644).
> - **Phase 2** — `aside` slot on `ListPageShell` / `EntityListPage`
>   + `<SelectionSummaryPanel>`; consumer: controls list selection
>   summary (#646).
> - **Phase 3** — `<AsidePanel defaultCollapsed>` + `<AiAssistRail>`;
>   consumer: the risk register (#647).
> - **Phase 4** — refinements: user-resizable docked width +
>   `?aside=<surfaceKey>` deep-link.
>
> Structural lock: `tests/guards/right-rail-discipline.test.ts`
> carries one describe block per phase.

---

# Why a right-rail exists or does not yet exist

Inflect's chrome today is a three-region frame, owned by
`AppShell`:

```
┌────────────┬──────────────────────────────────────────┐
│            │  TopChrome (breadcrumbs · switcher ·     │
│  Sidebar   │             bell · user menu)            │
│  (global   ├──────────────────────────────────────────┤
│   nav)     │                                          │
│            │  Page content                            │
│            │  (ListPageShell / EntityDetailLayout /   │
│            │   WorkspaceShell / DashboardLayout)      │
└────────────┴──────────────────────────────────────────┘
```

There is no persistent right-hand column. Contextual secondary
information is carried by three existing surfaces, each with a
distinct job:

| Surface | Job | Posture |
|---------|-----|---------|
| **Tabs** (`EntityDetailLayout`) | Show one facet of an entity at a time | Co-resident, but *mutually exclusive* — opening one hides the others |
| **`<Sheet>`** (Epic 54) | Drill into a row / inline-edit without losing the list | **Transient** overlay drawer — opens, dismisses, scrim-free but modal-ish focus |
| **`<Modal>`** (Epic 54) | Quick create / confirm | **Blocking** overlay |

A right-rail is **a fourth posture none of these provide**:
information or actions that must stay **visible and co-resident**
while the user works in the main content — *persistent* (a `<Sheet>`
that keeps reopening is friction) and *non-exclusive* (a tab that
hides its siblings defeats the purpose).

It is **not built yet** for deliberate reasons:

- **Horizontal budget is real.** Most compliance work happens on
  1280–1440px laptops. The sidebar already spends ~240px; a
  320px+ rail leaves the main content cramped. A rail must *earn*
  that space against a concrete, repeated workflow.
- **The existing surfaces are currently sufficient.** No shipped
  workflow today is demonstrably hurt by the absence of a
  persistent rail. `<Sheet>` covers transient drill-in; tabs cover
  facets.
- **"A panel everywhere" is an anti-goal.** A rail introduced
  speculatively becomes visual noise on pages that never needed it
  and a maintenance surface with no consumer.

The product position: **defer until a real workflow needs the
fourth posture** — then build it once, scoped, per the design below.

---

# Best future use cases

Ranked by strength — a candidate is strong only when the context is
*both* persistent-worthy *and* co-resident-worthy.

1. **Detail-page activity / audit timeline.** Controls, risks,
   policies, and audits each have an activity history. Today it is
   a tab — opening it hides the entity body. As a rail it stays
   visible *while* the user edits the entity, which is exactly when
   "what changed, by whom" is reference context. **Strongest
   candidate** — clear persistent + co-resident need.

2. **Traceability / linked-entities inspector.** On a control or
   risk detail page, the linked controls/risks/assets relationships
   (`TraceabilityPanel`). Keeping the link graph docked while
   editing the entity it belongs to.

3. **AI assist / risk-suggestion co-pilot.** `ai/risk-suggestions`
   already exists as a flow. A persistent assist rail that follows
   the user across the risk register is a natural home — but it
   depends on the AI roadmap maturing first.

4. **List-page selection summary.** When several rows are selected,
   a rail summarising the selection + offering batch verbs — a
   calmer home than a floating bulk-action toolbar.

5. **Audit-pack / evidence assembly.** Building an audit pack
   across several pages: a persistent "what I've added" rail that
   survives navigation within the audit flow.

**Explicit anti-cases** — these must NOT pull a rail into being:
per-field help (tooltip), one-off create/edit forms (`<Modal>` /
`<Sheet>`), navigation (the sidebar), and anything transient
(`<Sheet>`).

---

# Architectural design

## Layout integration model

The rail is **an optional slot on specific page shells — never a
global, always-on column.** `AppShell` is unchanged. The rail lives
*inside* the content region of the shells that opt in:

- `EntityDetailLayout` gains an optional `aside` slot (the primary
  home — detail pages are where co-resident context pays off).
- `ListPageShell` / `EntityListPage` gain an optional `aside` slot
  (the selection-summary case).
- `WorkspaceShell` (canvas pages) is **excluded** — canvas surfaces
  want full-bleed; a rail fights that layout language.

Rendered shape — the rail is a third flex column after the main
content, with its own independent scroll:

```
content region of EntityDetailLayout / ListPageShell
┌──────────────────────────────────────┬───────────────┐
│  main content (min-width enforced)    │  aside rail   │
│  own scroll                           │  own scroll   │
└──────────────────────────────────────┴───────────────┘
```

## Sizing / collapse behaviour

- **Fixed width** — 320–360px. Not user-resizable in v1: resizable
  rails add drag handling, width persistence, and layout thrash for
  marginal value. Revisit only if usage data demands it.
- **Three states** — expanded · collapsed-to-spine (a thin icon
  rail that re-expands on click) · hidden. A user who never wants
  the rail can collapse it to zero and pays no permanent space.
- **Collapse state persists** per surface via the existing
  `useLocalStorage` hook (Epic 60) — keyed by shell + surface, so
  the controls detail page and the risks list remember
  independently.
- **Main-content min-width is load-bearing.** Below a threshold the
  rail auto-collapses to the spine so the main content never
  becomes unusable.

## Responsive behaviour

This is the **minimally-invasive seam**. The rail's *content* is
viewport-agnostic; only its *container* changes:

- **≥ xl (~1280px)** — the rail docks as the third column.
- **< xl** — the same content renders inside a `<Sheet>` (the
  existing Epic 54 primitive), opened from a chrome affordance.

The rule: **rail content is written once, as a plain component.**
The shell decides whether to mount it in the docked slot or hand it
to a `<Sheet>`. No second code path for the content; no mobile rail.

## Interaction model

- **Co-resident, not overlay.** No scrim, no focus trap — the rail
  and the main content are both live. This is the line that
  separates a rail from `<Sheet>`/`<Modal>`.
- **Persistent within a surface.** It does not "dismiss"; it
  collapses. Navigating to a different page swaps the rail's
  content (or empties it) — it does not carry stale content across
  routes.
- **Not draggable, not resizable** in v1.

## State ownership

Mirrors the established `EntityDetailLayout` split — *shell owns
layout, page owns content*:

- The **shell** owns: the slot, the collapse chrome, the
  responsive docked-vs-Sheet decision, and the persisted collapse
  state (a small `AsideController` context).
- The **page** owns: what goes *in* the rail (the activity
  timeline, the traceability panel, …) — passed as the `aside`
  prop, exactly as `tabs` / `actions` are passed today.

## Routing / deep-link implications

- **v1: the rail is UI-only.** Collapse state is `localStorage`,
  **not** in the URL — a shared link must never carry one user's
  rail preference.
- **Later, if needed:** a section within the rail that warrants
  deep-linking (e.g. "open the activity rail to entry X") uses an
  additive search param (`?aside=activity`). Additive, opt-in, not
  v1 — the rail stays out of the route by default.

---

# What must stay out of the current scope

Explicit — none of the following may happen as part of current or
near-term work:

- **No `aside` slot is added to any shell now.** The slots
  described above are designed, not implemented.
- **No global, always-on rail.** Adoption is opt-in per surface,
  and even then collapsible to zero.
- **No migration of `<Sheet>` usages to a rail.** `<Sheet>` remains
  the canonical transient drill-in surface; the rail is the
  *persistent* posture, a complement, not a replacement.
- **No rail state in routing.**
- **`WorkspaceShell` / canvas pages are not touched.**
- **The account/profile chrome work stays clean of this.** No rail
  affordance, no "rail toggle", and no aside-shaped seam is added
  to the top-bar, sidebar, or `AppShell` as a side effect of
  current chrome work.

---

# Future implementation phases

**Phase 0 — trigger (no code).** Wait for a concrete, repeated
workflow that demonstrably needs the fourth posture. The activity
timeline (use case 1) is the expected trigger. Until then, nothing.

**Phase 1 — the primitive + one real consumer.** Build
`<AsidePanel>` (the rail container: width, three-state collapse,
`localStorage` persistence, the `< xl` → `<Sheet>` fallback) and add
the optional `aside` slot to `EntityDetailLayout` **only**. Ship it
with exactly one consumer — the detail-page activity timeline — so
the primitive is proven against a real surface, not a hypothetical.

**Phase 2 — list-page selection summary.** Extend the `aside` slot
to `ListPageShell` / `EntityListPage` for the multi-select summary
+ batch-verb use case.

**Phase 3 — AI assist rail.** Mount the AI co-pilot in the rail —
gated on the AI roadmap maturing.

**Phase 4 — refinements (only if usage data demands).** Deep-link
search param; user-resizable width. Neither is built without
evidence that the fixed-width, UI-only v1 is insufficient.

Each phase is independently shippable and independently
justifiable; a later phase never starts on speculation.

---

# Acceptance criteria for the future feature

A right-rail system is worth building only when **all** of these
hold:

1. **A specific, repeated workflow needs the fourth posture** —
   context that is *both* persistent (a transient `<Sheet>` is
   friction) *and* co-resident (a tab hiding its siblings is
   friction). If `<Sheet>` or a tab serves the workflow, the rail
   is not justified.
2. **The main content survives the horizontal cost at 1280px** —
   with the rail expanded, the enforced main-content min-width
   still yields a usable layout.
3. **Rail content degrades cleanly below the breakpoint** — the
   same content component renders inside a `<Sheet>` under xl with
   no separate code path.
4. **Adoption is opt-in per surface** — no shell mounts a rail it
   was not explicitly given, and every rail collapses to zero.
5. **Collapse state persists and is UI-only** — remembered per
   surface, never in the URL.

If a proposal cannot satisfy all five, it is a `<Sheet>`, a tab, a
modal, or a navigation item — not a right-rail.
