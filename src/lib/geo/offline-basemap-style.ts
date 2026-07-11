import type { StyleSpecification } from 'maplibre-gl';
import { BASEMAP_MAX_ZOOM, BASEMAP_MIN_ZOOM } from '@/lib/offline/basemap-pack';

/**
 * A minimal, GLYPH-FREE MapLibre style for the offline basemap pack.
 *
 * The pack proxies the public-domain demotiles (Natural Earth) VECTOR tiles
 * same-origin (see `basemap-pack.ts`). To render them with NO network we must
 * hand MapLibre a style that references ONLY same-origin resources — the
 * app's normal styles (MapTiler / the remote demotiles style.json) all pull a
 * cross-origin style document, glyph fonts, and sprites that the service
 * worker cannot cache, so they blank offline.
 *
 * This style therefore:
 *   - points its single vector source at the SAME-ORIGIN pack template
 *     (`{z}/{x}/{y}`), maxzoom = demotiles' native max (MapLibre overzooms
 *     for closer views),
 *   - draws ONLY `background` + fill/line layers on the `countries` and
 *     `geolines` source-layers — deliberately NO `symbol`/text layers, so no
 *     glyph (`{fontstack}`) fetch is ever needed, and no `sprite` is declared,
 *   - uses the app's map palette tones so the offline backdrop reads like the
 *     online demo basemap (land / water / coastline / graticule).
 *
 * The operator's parcels are drawn on top by MapCanvas from the same-origin
 * GeoJSON parcel data (cached by the field-data DATA_CACHE), so offline the
 * map shows real fields on a real — if coarse — backdrop instead of a void.
 *
 * `tileTemplate` is the same-origin `.../basemap/{z}/{x}/{y}` URL; the
 * `{z}/{x}/{y}` placeholders are substituted by MapLibre per tile.
 */
export function buildOfflineBasemapStyle(tileTemplate: string): StyleSpecification {
    return {
        version: 8,
        // No `glyphs` and no `sprite`: every layer below is background / fill /
        // line, so neither is needed — and omitting them keeps the style fully
        // same-origin (nothing cross-origin to fetch while offline).
        sources: {
            basemap: {
                type: 'vector',
                tiles: [tileTemplate],
                minzoom: BASEMAP_MIN_ZOOM,
                maxzoom: BASEMAP_MAX_ZOOM,
            },
        },
        layers: [
            {
                id: 'offline-background',
                type: 'background',
                // Water tone — the sea/no-data backdrop.
                paint: { 'background-color': '#a9c9e8' },
            },
            {
                id: 'offline-land',
                type: 'fill',
                source: 'basemap',
                'source-layer': 'countries',
                paint: { 'fill-color': '#e8ece4' },
            },
            {
                id: 'offline-coastline',
                type: 'line',
                source: 'basemap',
                'source-layer': 'countries',
                paint: { 'line-color': '#9fb0a0', 'line-width': 0.8 },
            },
            {
                id: 'offline-graticule',
                type: 'line',
                source: 'basemap',
                'source-layer': 'geolines',
                paint: { 'line-color': '#c2cbd6', 'line-width': 0.5 },
            },
        ],
    };
}
