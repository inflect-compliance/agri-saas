# Bundled geo assets

## `bg-oblasti.geojson` — Bulgaria oblasti (ADM1)

28 oblast (province) polygons for Bulgaria, used by the Exchange region
map. Bundled as a **static asset** — it is never fetched at runtime and
never stored in the DB.

- **Source:** [geoBoundaries](https://www.geoboundaries.org/) — gbOpen
  release, Bulgaria (`BGR`) ADM1.
  Download: `https://www.geoboundaries.org/api/current/gbOpen/BGR/ADM1/`
  (raw file resolved via the GitHub LFS media endpoint
  `media.githubusercontent.com/media/wmgeolab/geoBoundaries/main/releaseData/gbOpen/BGR/ADM1/geoBoundaries-BGR-ADM1.geojson`).
- **License:** **CC-BY-4.0** (Creative Commons Attribution 4.0
  International). Attribution: *geoBoundaries (Runfola et al., 2020)*.
  License is redistribution-clean for a commercial product provided this
  attribution is retained.
- **Why geoBoundaries and not `yurukov/Bulgaria-geocoding`:** the latter's
  license is unstated; geoBoundaries is explicitly CC-BY-4.0, so it is the
  license-safe choice.
- **Feature properties:** each feature carries `shapeName` (oblast name,
  latin), `shapeISO` (ISO 3166-2 code, e.g. `BG-16`), `shapeID`,
  `shapeGroup` (`BGR`), `shapeType` (`ADM1`).

The programmatic region catalogue (codes, bilingual names, centroids,
lookup + dropdown helpers) lives in `src/lib/geo/bulgaria-regions.ts` —
that typed module, not this geojson, is what the app-layer imports. The
geojson is only for map polygon rendering (future UI).

### Refreshing the file

geoBoundaries stores its geojson via Git LFS, so a plain
`raw.githubusercontent.com` URL returns an LFS pointer. Use the API's
`gjDownloadURL`, or the `media.githubusercontent.com/media/...` LFS
resolver shown above.

**The bundled file is SIMPLIFIED for map performance.** The raw
geoBoundaries ADM1 is ~408 KB / 9,193 points with ~15-decimal
coordinates — far more than the Exchange map (overview → city zoom) or
the spotlight mask needs, and it was blocking load (fetch + a
main-thread rebuild of a 28-hole mask polygon). It is Douglas-Peucker
simplified (ε ≈ 0.003° ≈ 330 m) with coordinates rounded to 5 decimals
(≈1 m): ~66 KB / 3,090 points (20 KB gzipped). **After re-downloading a
fresh copy, re-apply the same simplification** before committing, or the
map slows down again.
