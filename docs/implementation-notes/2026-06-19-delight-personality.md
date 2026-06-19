# 2026-06-19 — Personality (feat/delight-personality)

**Commit:** `<sha>` feat/delight-personality — greeting header, sunlight theme, bilingual warmth

## Design

A home screen that greets the farmer like a helpful colleague, in their
language, reflecting real weather + today's work. Three parts:

1. **Greeting header** — the dashboard server page fetches `getHomeGreeting`
   (a tenant-wide spray-window + tasks summary over existing rows) plus the
   session name/avatar, and renders a client `GreetingHeader`. Time-of-day
   and season are the user's (browser tz) so they resolve after mount.
2. **Sunlight theme** — a high-contrast outdoor palette, delivered as the
   light theme + a `[data-contrast="high"]` overlay rather than a third
   theme block.
3. **Bilingual warm microcopy** — `dashboard.greeting.*` in en + bg, warm and
   emoji-free, full parity.

## Files

| File | Role |
|------|------|
| `src/app-layer/usecases/home-greeting.ts` | `getHomeGreeting` tenant-wide summary |
| `src/app/t/[tenantSlug]/(app)/dashboard/GreetingHeader.tsx` | client greeting (time/season/name) |
| `src/app/t/[tenantSlug]/(app)/dashboard/page.tsx` | server fetch + mount above DashboardClient |
| `src/lib/season.ts` | pure `calendarSeason` / `timeOfDay` |
| `src/styles/tokens.css` | `[data-contrast="high"]` sunlight overlay |
| `src/components/theme/ThemeProvider.tsx` | `Theme += sunlight`; cycle; sunlight → light+contrast |
| `src/components/theme/ThemeToggle.tsx` | 3-state cycle, next-theme icon |
| `messages/{en,bg}.json` | `dashboard.greeting.*` |

## Decisions

- **Sunlight is an overlay, not a third theme block.** A full third
  `[data-theme="sunlight"]` block (copying every light token) tripped six
  token-structure guards that encode a "dark + light = exactly two blocks"
  invariant. Modelling sunlight as `data-theme="light"` + `data-contrast="high"`
  keeps that invariant: the provider sets both attributes, the overlay
  inherits the full light palette and overrides only the ~12 contrast-critical
  surfaces. Cleaner *and* it touched zero existing guards.
- **Time-of-day/season resolve after mount.** They track the user's timezone,
  not the server's, so the SSR shell shows a neutral "Hello, {name}." and the
  client effect swaps in "Good morning, …" — correct tz, no hydration mismatch.
- **The zero-tasks copy is a plain key, not an ICU `=0 {…}` clause.** The i18n
  parity guard's `{word}` placeholder regex captured the ASCII word inside
  `=0 {nothing due today}` but not its Cyrillic counterpart, raising a false
  placeholder-drift failure. A separate `noTasks` plain key keeps the plural
  key's only token `{count}` and parity clean.
- **Theme persistence reuses the existing localStorage mechanism** (`inflect:theme`)
  — the same per-user/per-browser model dark and light already use; no new DB
  column. Cross-device sync is a documented follow-up.
- **The greeting degrades gracefully** — no name → no comma; no farm signal at
  all → a warm welcome line; daily weather only, so no fabricated "until noon".
