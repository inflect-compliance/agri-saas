# 2026-07-03 — Exchange main page (browse)

**Commit:** `<pending> feat(exchange): marketplace map + offer list (browse-only)`

## Design

Split-view browse page for the cross-tenant marketplace: a map of Bulgaria
(left) + a synced, filterable offer list (right). Stacked on the Prompt-1
backend (ExchangeListing + `listActiveListings` + EXCHANGE module).

```
exchange/layout.tsx        server module gate: requireModule(ctx,'EXCHANGE')
exchange/page.tsx          renders <ExchangeClient/>
exchange/ExchangeClient.tsx  FilterProvider → ListPageShell:
   header (breadcrumbs + "Борса / Exchange" + SELL/BUY legend + Offer button)
   filters (Epic-53 FilterToolbar: side/commodity/region/quantity + search)
   body → two-pane flex: <ExchangeMap/> | scrolling offer-card list
   <Sheet/> detail (open/close wired; body stubbed for Prompt 3)
components/exchange/ExchangeMap.tsx  react-map-gl/maplibre, NON-terrain basemap
   Layer A: oblast polygons (/geo/bg-oblasti.geojson) — click → region filter
   Layer B: clustered offer points (side-coloured) + Popup → "View details"
api/.../exchange/listings/route.ts   GET → listActiveListings → PUBLIC projection
```

Map ↔ list ↔ filter sync: an oblast click `toggle('region', code)`; the
FilterProvider `state` is the single source of truth; the map + list both
render the same client-filtered array; hovering a row highlights its marker.

## Files

| File | Role |
|---|---|
| `exchange/layout.tsx` | module gate (redirect if EXCHANGE off) |
| `exchange/page.tsx` / `ExchangeClient.tsx` | server shim + client split-view |
| `exchange/filter-defs.ts` | Epic-53 filter defs (region from bulgaria-regions) |
| `components/exchange/ExchangeMap.tsx` | MapLibre map (polygons + clustered markers + popup) |
| `lib/exchange/public-listing.ts` | `toPublicListing` — the wire projection |
| `api/.../exchange/listings/route.ts` | GET listings (module-gated, public projection) |
| `SidebarNav.tsx` / `BottomTabBar.tsx` | module-gated nav entry |

## Decisions

- **Reused the existing react-map-gl/maplibre stack** (no new map lib), with a
  NON-terrain basemap (`streets-v2`, overridable) vs the parcel map's satellite
  `hybrid` — a marketplace wants cities/villages labels, not imagery. Basemap
  resolution mirrors MapCanvas's env-key pattern.
- **Client-side filtering** over the fetched array (browse is bounded to the
  repo's `take:` cap) — simplest, and the FilterProvider already owns the state.
- **Public projection at the wire** (`toPublicListing`): drops `sellerUserId`
  and the raw owning-tenant id (→ opaque `isOwn`), stringifies decimals. The
  Exchange is cross-tenant, so the DTO must be deliberately public.
- **Marker colours are hex constants** (`EXCHANGE_SIDE_COLORS`) shared by the
  maplibre paint AND the legend/rows (inline style) so they always match —
  maplibre paint can't consume CSS tokens.
- **Browse-only**: the create button + Sheet body are stubbed (Prompt 3 wires
  the create modal + inquiry flow).
