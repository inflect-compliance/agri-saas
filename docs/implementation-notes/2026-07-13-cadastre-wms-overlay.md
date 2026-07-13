# 2026-07-13 — Bulgarian cadastre (КККР / АГКК) WMS overlay

**Commit:** `<sha>` feat(map): toggleable Bulgarian cadastre (КККР) WMS overlay

A toggleable cadastral-parcel reference overlay on the location map, built as
an **env-gated seam** with **NO hardcoded upstream URL**. The overlay is
HIDDEN until an operator configures a WMS endpoint. NO schema changes.

## Discovery outcome (why the seam, not a default URL)

The free INSPIRE view WMS for Bulgarian cadastral parcels **could not be
located** by probing from the production VM:

- `inspire.egov.bg` is a client-side JS SPA — no discoverable `GetCapabilities`
  from the landing host.
- The CSW / catalogue paths tried returned 404.
- The АГКК geoserver hostnames guessed did not resolve.

A hardcoded default that 404s is **worse than nothing** (it looks broken and
wastes a round-trip on every tile). So the feature ships as a pure seam: unset
env ⇒ the toggle never renders ⇒ correct behaviour per spec.

**Leads to chase for a working free endpoint:**
- EU INSPIRE geoportal registry — <https://inspire-geoportal.ec.europa.eu>
  (search the BG member-state view services for the `CP` — Cadastral Parcels —
  theme).
- Direct АГКК / КАИС contact for the published INSPIRE view-service GetMap base.

## №8002 commercial terms (the paid alternative)

The paid cadastre WMS service **№8002** (delivered via **КАИС**) is priced per
**Наредба РД-02-20-4/2016 + Тарифа 14**:

- **80 лв/месец** or **800 лв/година**,
- **per layer, per IP-bound access point**.

Because the licence is **IP-bound**, tiles MUST be fetched **server-side** from
the VM's fixed IP — a browser fetch would originate from the user's IP and be
rejected/metered wrongly. This is the primary reason the overlay goes through a
same-origin proxy rather than a direct browser WMS call (unlike the CORS-open,
free ISRIC soil layer). Enabling the paid layer is a **visible operator cost
decision** — the env is documented in `deploy/env.prod.example` with the price.

## Design

```
env (server-only)                     client (never sees upstream URL)
  CADASTRE_WMS_URL          ┐            GET /cadastre/config → { configured }
  CADASTRE_WMS_LAYERS       ├─ resolveCadastreSource()          │
  CADASTRE_WMS_PREMIUM_URL  ┘   (premium wins)                  ▼
                                    │              toggle renders iff configured
                                    ▼                           │  + online
     GET /cadastre/wms/{z}/{x}/{y}  ◄───────────────────────────┘
        getTenantCtx (auth gate)
        zoom floor (z≥10) + Bulgaria-envelope clamp  → else 204
        Redis cache (source,z,x,y), 7d TTL, base64
        z/x/y → EPSG:3857 bbox → WMS GetMap (server-side fetch, no creds)
        upstream 404/5xx/throw → 204 (map degrades gracefully)
      → 200 image/png, Cache-Control: public, max-age=604800, immutable
```

Client: `MapCanvas` gains a `cadastreOverlay={{ tileUrl }}` prop — a raster
`<Source>`/`<Layer>` (opacity 0.8, `minzoom=10`) drawn ABOVE the basemap +
soil/index rasters but BELOW the tenant's own parcel fills, so the operator's
fields stay legible on top. The tile URL is the same-origin proxy template; the
upstream WMS URL never enters the client bundle.

## Files

| File | Role |
| --- | --- |
| `src/lib/geo/cadastre-tiles.ts` | Pure tile math (no env/IO): z/x/y→3857 bbox, Bulgaria envelope, zoom floor, WMS URL builder, cache-key. |
| `src/lib/geo/cadastre-source.ts` | Server-only env resolver (`resolveCadastreSource` / `isCadastreConfigured`); premium precedence. |
| `src/app/api/t/[tenantSlug]/cadastre/config/route.ts` | `{ configured }` boolean probe (never the URL). |
| `src/app/api/t/[tenantSlug]/cadastre/wms/[z]/[x]/[y]/route.ts` | Bounded same-origin tile proxy + Redis cache. |
| `src/env.ts` | 3 optional cadastre vars + runtimeEnv wiring. |
| `deploy/env.prod.example` | Documents the vars + the №8002 price. |
| `src/components/ui/map/MapCanvas.tsx` | `cadastreOverlay` prop + gated raster source. |
| `src/app/t/[tenantSlug]/(app)/locations/[locationId]/page.tsx` | Toggle (config-gated, offline-disabled) + prop wiring. |
| `messages/{en,bg}.json` | `cadastreToggle`, `cadastreOfflineHint`, `cadastreAttribution`. |

## Decisions

- **No hardcoded WMS URL.** A 404ing default is worse than a hidden feature —
  discovery could not confirm a live free endpoint. Operator opt-in only.
- **Server-side proxy, not a direct browser WMS call** (the soil layer is
  direct because ISRIC is free + CORS-open). The №8002 licence is IP-bound to
  the VM, so tiles must originate server-side; the proxy also keeps the URL +
  any credentials out of the client bundle.
- **Zoom floor (z≥10) + Bulgaria envelope** bound abuse of an IP-metered
  upstream: a low-zoom or out-of-country tile is refused before any fetch. The
  raster source's `minzoom=10` stops MapLibre requesting sub-floor tiles at all.
- **Graceful degradation = 204.** Every refusal + upstream error returns 204;
  MapLibre simply skips the tile, so a broken/absent upstream never breaks the
  map.
- **base64 in Redis.** Tile bytes are cached base64-encoded — Redis strings are
  safe for text but binary round-trips can corrupt under the default encoding.
- **Online-only, not in the offline pack.** The WMS is live; the toggle is
  disabled with a hint when offline (`useOfflineSync().online`). No
  GetFeatureInfo click-through in this phase.
- **`configured` boolean over exposing the URL.** The client only learns
  whether the feature exists — the upstream URL is server-only.
