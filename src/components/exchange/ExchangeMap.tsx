'use client';

/**
 * ExchangeMap — the cross-tenant marketplace map of Bulgaria.
 *
 * A deliberately Bulgaria-ONLY, dark, commercial map:
 *   • Dark minimal basemap (MapTiler `dataviz-dark`) so the app's dark UI and
 *     the SELL/BUY markers read as one system.
 *   • A spotlight MASK — everything outside Bulgaria is dimmed by a dark scrim
 *     (a world polygon with the oblast footprints punched out as holes), so the
 *     country is the only lit geography. Neighbours never compete for attention.
 *   • The view is LOCKED to Bulgaria (`maxBounds` + `minZoom`, rotation off) so
 *     a user can't pan off into Romania/Greece/Türkiye or zoom out to Europe.
 *   • Oblast (ADM1) polygons: a quiet wash by default, brand-green when the
 *     region is filter-selected; click toggles the region filter.
 *   • Clustered offer markers with a soft glow; SELL green / BUY blue.
 *
 * The oblast geometry (bundled `/geo/bg-oblasti.geojson`, geoBoundaries
 * CC-BY-4.0) is fetched once and drives BOTH the region layer and the mask.
 * The MapTiler key is read from env exactly as MapCanvas's resolver does.
 */
import 'maplibre-gl/dist/maplibre-gl.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import Map, {
    Layer,
    Marker,
    Popup,
    Source,
    type MapLayerMouseEvent,
    type MapRef,
} from 'react-map-gl/maplibre';
import type { FeatureCollection, Position } from 'geojson';
import type { GeoJSONSource, LngLatBoundsLike } from 'maplibre-gl';
import { env } from '@/env';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { featureToMapListing, type ExchangeMapListing } from './exchange-map-utils';

/** Side colours — shared by the marker paint AND the page's legend so they
 *  always match. Green = selling, blue = buying (mirrors MapCanvas's
 *  done/selected palette). */
export const EXCHANGE_SIDE_COLORS = { SELL: '#16a34a', BUY: '#2563eb' } as const;

/** Bulgaria bounding box [[west, south], [east, north]] — fit on load. */
const BULGARIA_BOUNDS: [[number, number], [number, number]] = [
    [22.36, 41.23],
    [28.61, 44.22],
];

/** Hard pan/zoom cage — a little breathing room around the country, but not
 *  enough to bring a neighbour's interior into frame (and the mask dims the
 *  slivers that do). Keeps the map unmistakably "Bulgaria". */
const MAX_BOUNDS: LngLatBoundsLike = [
    [20.8, 40.4],
    [30.2, 45.0],
];

/** Outer ring for the spotlight mask — generous enough to cover the whole
 *  visible frame at min zoom; the oblast footprints are punched out as holes. */
const MASK_WORLD_RING: Position[] = [
    [10, 34],
    [36, 34],
    [36, 49],
    [10, 49],
    [10, 34],
];

/** Dark scrim that dims everything outside Bulgaria (navy to match the UI).
 *  Near-opaque (0.92): the scrim sits over real dataviz-dark TILES, so it has
 *  to be strong to actually black out neighbouring countries' roads + city
 *  labels — the mockup's lower value looked right only because it had no tiles
 *  beneath it. Slightly darker than the flat land fill so Bulgaria lifts. */
const MASK_FILL = '#060a14';
const MASK_OPACITY = 0.92;

/** Selected-region brand accent (emerald), matching the SELL marker family. */
const REGION_ACCENT = '#22c55e';

/** Flat land fill — a near-opaque cool dark that covers the basemap roads/
 *  labels inside Bulgaria, so the country reads as one clean lifted shape
 *  (the mockup look) instead of a busy street map. Slightly lighter than the
 *  scrimmed surroundings so the country lifts off the dimmed neighbours. */
const LAND_FILL = '#0f1826';
const LAND_OPACITY = 0.94;

/** The flat land fill is opaque for the clean overview, then fades out as you
 *  zoom in so the dataviz-dark basemap (cities, villages, roads, labels) shows
 *  through for locating offers precisely. Fully gone by LAND_FADE_END_ZOOM. */
const LAND_FADE_START_ZOOM = 7;
const LAND_FADE_END_ZOOM = 9.5;

const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] };

const DEMO_STYLE = 'https://demotiles.maplibre.org/style.json';

function styleUrl(styleId: string): string {
    const key = env.NEXT_PUBLIC_MAPTILER_KEY;
    if (!key) return DEMO_STYLE;
    return `https://api.maptiler.com/maps/${styleId}/style.json?key=${key}`;
}

/** Build the spotlight mask: one polygon = world ring + every oblast outer
 *  ring as a hole, so the fill covers everything EXCEPT Bulgaria. Oblast
 *  borders are drawn on top, hiding any hairline seams between adjacent holes. */
function buildMask(oblasti: FeatureCollection): FeatureCollection {
    const holes: Position[][] = [];
    for (const f of oblasti.features) {
        const g = f.geometry;
        if (g.type === 'Polygon') {
            holes.push(g.coordinates[0]);
        } else if (g.type === 'MultiPolygon') {
            for (const poly of g.coordinates) holes.push(poly[0]);
        }
    }
    return {
        type: 'FeatureCollection',
        features: [
            {
                type: 'Feature',
                properties: {},
                geometry: { type: 'Polygon', coordinates: [MASK_WORLD_RING, ...holes] },
            },
        ],
    };
}

export type { ExchangeMapListing };

interface ExchangeMapProps {
    listings: ExchangeMapListing[];
    /** Currently-filtered region codes (highlighted on the map). */
    selectedRegionCodes: string[];
    /** Toggle a region filter (from an oblast click). */
    onRegionClick: (regionCode: string) => void;
    /** Open a listing's detail (from a popup "View details"). */
    onListingSelect: (id: string) => void;
    /** Highlight a listing's marker (row hover in the list). */
    highlightedId?: string | null;
    /** Basemap style id — default a dark, minimal, label-light canvas. */
    basemapStyle?: 'dataviz-dark' | 'streets-v2-dark' | 'basic-v2-dark' | 'streets-v2';
    className?: string;
}

interface PopupState {
    lng: number;
    lat: number;
    listing: ExchangeMapListing;
}

export function ExchangeMap({
    listings,
    selectedRegionCodes,
    onRegionClick,
    onListingSelect,
    highlightedId,
    basemapStyle = 'dataviz-dark',
    className,
}: ExchangeMapProps) {
    const t = useTranslations('exchangeMap');
    const mapRef = useRef<MapRef | null>(null);
    const [popup, setPopup] = useState<PopupState | null>(null);
    // Surface the map's own lifecycle so a failed style/GL init is visible
    // instead of a silently-blank bordered box. `error` is only fatal BEFORE
    // the first successful load — a transient tile error after `ready` must
    // not tear down a working map.
    const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

    // Oblast geometry, fetched once and reused for the region layer + the mask.
    // On failure the basemap still renders (just without the spotlight).
    const [oblasti, setOblasti] = useState<FeatureCollection | null>(null);
    useEffect(() => {
        let alive = true;
        fetch('/geo/bg-oblasti.geojson')
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
            .then((data: FeatureCollection) => {
                if (alive) setOblasti(data);
            })
            .catch(() => {
                /* no spotlight/regions — the basemap + markers still work */
            });
        return () => {
            alive = false;
        };
    }, []);

    const maskGeojson = useMemo<FeatureCollection>(
        () => (oblasti ? buildMask(oblasti) : EMPTY_FC),
        [oblasti],
    );

    const mapStyle = useMemo(() => styleUrl(basemapStyle), [basemapStyle]);

    // Offer markers as a GeoJSON point FeatureCollection (clustered source).
    const offerGeojson = useMemo<FeatureCollection>(
        () => ({
            type: 'FeatureCollection',
            features: listings.map((l) => ({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [l.lon, l.lat] },
                properties: {
                    id: l.id,
                    side: l.side,
                    commodity: l.commodity,
                    quantityTonnes: l.quantityTonnes,
                    pricePerTonne: l.pricePerTonne ?? '',
                    priceCurrency: l.priceCurrency,
                    regionCode: l.regionCode,
                    regionName: l.regionName,
                    lon: l.lon,
                    lat: l.lat,
                    // Pinned map label — same shape as the popup line. Units are
                    // symbols (mirrors the popup), so no new translatable copy.
                    chipLabel:
                        `${l.commodity} · ${l.quantityTonnes} t` +
                        (l.pricePerTonne ? ` · ${l.pricePerTonne} ${l.priceCurrency}/t` : ''),
                },
            })),
        }),
        [listings],
    );

    // The offer under the list's row-hover — gets a live pulse ring on the map.
    const hovered = useMemo(
        () => listings.find((l) => l.id === highlightedId) ?? null,
        [listings, highlightedId],
    );

    // Re-fit the country to the pane. Called on load AND on every container
    // resize — the flex/vh pane settles to its final size AFTER the map mounts,
    // so a load-only fit is stale and clips the country's sides. A touch more
    // horizontal padding keeps the east/west extremes off the edges on narrow
    // (mobile) panes.
    const fitToBulgaria = useCallback(() => {
        mapRef.current?.fitBounds(BULGARIA_BOUNDS, {
            padding: { top: 24, bottom: 24, left: 30, right: 30 },
            duration: 0,
        });
    }, []);

    const handleLoad = useCallback(() => {
        setStatus('ready');
        fitToBulgaria();
    }, [fitToBulgaria]);

    // The fatal error card must appear ONLY when the map genuinely never
    // loads. MapLibre fires transient `error` events during a NORMAL load (a
    // tile 404, a glyph miss) — escalating on those flashed a false "Map
    // couldn't load" card before the map finished loading. So we no longer
    // react to `error` at all (MapLibre logs it); instead, if the map hasn't
    // reached `ready` within a budget, the basemap style itself failed → card.
    useEffect(() => {
        const timer = setTimeout(() => {
            setStatus((s) => (s === 'loading' ? 'error' : s));
        }, 12_000);
        return () => clearTimeout(timer);
    }, []);

    const handleClick = useCallback(
        (e: MapLayerMouseEvent) => {
            const feature = e.features?.[0];
            if (!feature) {
                setPopup(null);
                return;
            }
            const layerId = feature.layer?.id;

            // Oblast polygon → toggle the region filter.
            if (layerId === 'oblast-fill') {
                const code = feature.properties?.shapeISO as string | undefined;
                if (code) onRegionClick(code);
                return;
            }

            // Cluster → drill in to the exact zoom that breaks it apart
            // (getClusterExpansionZoom), not a guessed fixed +2.
            if (layerId === 'clusters') {
                const geom = feature.geometry;
                const clusterId = feature.properties?.cluster_id as number | undefined;
                if (geom.type !== 'Point') return;
                const [lng, lat] = geom.coordinates as [number, number];
                const src = mapRef.current?.getMap().getSource('offers') as GeoJSONSource | undefined;
                if (src && clusterId != null) {
                    void src.getClusterExpansionZoom(clusterId)
                        .then((zoom) => mapRef.current?.easeTo({ center: [lng, lat], zoom, duration: 400 }))
                        .catch(() => {
                            // Fallback: a bounded step-in if the source can't resolve it.
                            const cur = mapRef.current?.getZoom() ?? 6;
                            mapRef.current?.easeTo({ center: [lng, lat], zoom: cur + 2, duration: 400 });
                        });
                }
                return;
            }

            // Unclustered offer point → open a popup (regionCode carried through).
            if (layerId === 'unclustered-point') {
                const p = feature.properties as Record<string, unknown>;
                setPopup({ lng: Number(p.lon), lat: Number(p.lat), listing: featureToMapListing(p) });
            }
        },
        [onRegionClick],
    );

    return (
        <div className={cn('relative h-full w-full overflow-hidden rounded-lg border border-border-default', className)}>
            <Map
                ref={mapRef}
                initialViewState={{ longitude: 25.48, latitude: 42.73, zoom: 6.4 }}
                mapStyle={mapStyle}
                onLoad={handleLoad}
                onResize={fitToBulgaria}
                onClick={handleClick}
                interactiveLayerIds={['oblast-fill', 'clusters', 'unclustered-point']}
                style={{ width: '100%', height: '100%' }}
                cursor="pointer"
                // Lock the frame to Bulgaria — no rotation, no wandering off to
                // neighbouring countries, no zooming out to all of Europe. minZoom
                // is a low floor so a narrow (mobile) pane can zoom out enough to
                // fit the whole country; maxBounds is the real cage.
                maxBounds={MAX_BOUNDS}
                minZoom={4.8}
                maxZoom={12}
                dragRotate={false}
            >
                {/* Spotlight mask — dark scrim over everything OUTSIDE Bulgaria.
                    Drawn first so the region + markers sit on top of it. */}
                <Source id="bg-mask" type="geojson" data={maskGeojson}>
                    <Layer
                        id="bg-mask-fill"
                        type="fill"
                        paint={{ 'fill-color': MASK_FILL, 'fill-opacity': MASK_OPACITY }}
                    />
                </Source>

                {/* Region layer — Bulgaria oblasti. A quiet lift by default so the
                    country reads as one lit body; brand-green when filter-selected.
                    Borders are drawn on top of the mask, hiding any hole seams.
                    (geoBoundaries CC-BY-4.0.) */}
                <Source id="oblasti" type="geojson" data={oblasti ?? EMPTY_FC}>
                    <Layer
                        id="oblast-fill"
                        type="fill"
                        paint={{
                            // Flat fill for a clean overview; selected regions
                            // glow brand-emerald. Opacity is zoom-driven — opaque
                            // when zoomed out, fading to reveal the basemap's
                            // cities/villages as you zoom in.
                            'fill-color': [
                                'case',
                                ['in', ['get', 'shapeISO'], ['literal', selectedRegionCodes]],
                                REGION_ACCENT,
                                LAND_FILL,
                            ],
                            'fill-opacity': [
                                'case',
                                ['in', ['get', 'shapeISO'], ['literal', selectedRegionCodes]],
                                // Selected: a highlight that thins on zoom so the
                                // basemap still reads under the chosen province.
                                ['interpolate', ['linear'], ['zoom'], LAND_FADE_START_ZOOM, 0.5, LAND_FADE_END_ZOOM, 0.28],
                                // Unselected land: opaque overview → fully clear
                                // (cities/villages visible) as you zoom in.
                                ['interpolate', ['linear'], ['zoom'], LAND_FADE_START_ZOOM, LAND_OPACITY, LAND_FADE_END_ZOOM, 0],
                            ],
                        }}
                    />
                    <Layer
                        id="oblast-line"
                        type="line"
                        paint={{
                            'line-color': [
                                'case',
                                ['in', ['get', 'shapeISO'], ['literal', selectedRegionCodes]],
                                REGION_ACCENT,
                                '#8aa0c0',
                            ],
                            'line-width': [
                                'case',
                                ['in', ['get', 'shapeISO'], ['literal', selectedRegionCodes]],
                                2.2,
                                0.6,
                            ],
                            'line-opacity': [
                                'case',
                                ['in', ['get', 'shapeISO'], ['literal', selectedRegionCodes]],
                                0.9,
                                0.35,
                            ],
                        }}
                    />
                </Source>

                {/* Offer markers — clustered, with a soft glow halo underneath. */}
                <Source
                    id="offers"
                    type="geojson"
                    data={offerGeojson}
                    cluster
                    clusterRadius={50}
                    clusterMaxZoom={9}
                    // Aggregate the SELL/BUY split per cluster so a cluster can
                    // communicate buy-vs-sell at a glance (coloured by dominant side).
                    clusterProperties={{
                        sellCount: ['+', ['case', ['==', ['get', 'side'], 'SELL'], 1, 0]],
                        buyCount: ['+', ['case', ['==', ['get', 'side'], 'BUY'], 1, 0]],
                    }}
                >
                    {/* Glow halo for single offers — soft, side-coloured. */}
                    <Layer
                        id="unclustered-glow"
                        type="circle"
                        filter={['!', ['has', 'point_count']]}
                        paint={{
                            'circle-color': [
                                'match',
                                ['get', 'side'],
                                'SELL', EXCHANGE_SIDE_COLORS.SELL,
                                'BUY', EXCHANGE_SIDE_COLORS.BUY,
                                '#6b7280',
                            ],
                            'circle-radius': [
                                'case',
                                ['==', ['get', 'id'], highlightedId ?? '__none__'],
                                20,
                                14,
                            ],
                            'circle-blur': 1,
                            'circle-opacity': 0.15,
                        }}
                    />
                    <Layer
                        id="clusters"
                        type="circle"
                        filter={['has', 'point_count']}
                        paint={{
                            'circle-color': [
                                'case',
                                ['>=', ['get', 'sellCount'], ['get', 'buyCount']],
                                EXCHANGE_SIDE_COLORS.SELL,
                                EXCHANGE_SIDE_COLORS.BUY,
                            ],
                            'circle-opacity': 0.9,
                            'circle-radius': ['step', ['get', 'point_count'], 16, 10, 22, 50, 30],
                            'circle-stroke-width': 2,
                            'circle-stroke-color': '#ffffff',
                        }}
                    />
                    <Layer
                        id="cluster-count"
                        type="symbol"
                        filter={['has', 'point_count']}
                        layout={{
                            'text-field': ['get', 'point_count_abbreviated'],
                            'text-size': 12,
                        }}
                        paint={{ 'text-color': '#ffffff' }}
                    />
                    <Layer
                        id="unclustered-point"
                        type="circle"
                        filter={['!', ['has', 'point_count']]}
                        paint={{
                            'circle-color': [
                                'match',
                                ['get', 'side'],
                                'SELL', EXCHANGE_SIDE_COLORS.SELL,
                                'BUY', EXCHANGE_SIDE_COLORS.BUY,
                                '#6b7280',
                            ],
                            'circle-radius': [
                                'case',
                                ['==', ['get', 'id'], highlightedId ?? '__none__'],
                                10,
                                7,
                            ],
                            'circle-stroke-width': 2,
                            'circle-stroke-color': '#ffffff',
                        }}
                    />
                    {/* Pinned price chip on each UNCLUSTERED offer — commodity ·
                        tonnes · price. Collapses into the cluster count at low
                        zoom (unclustered filter), and MapLibre collision hides
                        any that would overlap, so the map never clutters. */}
                    <Layer
                        id="offer-label"
                        type="symbol"
                        filter={['!', ['has', 'point_count']]}
                        layout={{
                            'text-field': ['get', 'chipLabel'],
                            'text-size': 11,
                            'text-anchor': 'left',
                            'text-offset': [0.9, 0],
                            'text-optional': true,
                            'text-max-width': 14,
                        }}
                        paint={{
                            'text-color': '#e5e7eb',
                            'text-halo-color': '#0b0f18',
                            'text-halo-width': 1.6,
                            'text-halo-blur': 0.4,
                        }}
                    />
                </Source>

                {/* Soft pulsing ring on the offer the list row is hovering. */}
                {hovered && (
                    <Marker longitude={hovered.lon} latitude={hovered.lat}>
                        <span
                            className="pointer-events-none block h-5 w-5 animate-pulse rounded-full border-2"
                            style={{ borderColor: EXCHANGE_SIDE_COLORS[hovered.side], opacity: 0.6 }}
                        />
                    </Marker>
                )}

                {popup && (
                    <Popup
                        longitude={popup.lng}
                        latitude={popup.lat}
                        anchor="bottom"
                        offset={12}
                        closeOnClick={false}
                        onClose={() => setPopup(null)}
                    >
                        <div className="space-y-tight p-1">
                            <div className="flex items-center gap-compact">
                                <span
                                    aria-hidden="true"
                                    className="inline-block h-2.5 w-2.5 rounded-full"
                                    style={{ backgroundColor: EXCHANGE_SIDE_COLORS[popup.listing.side] }}
                                />
                                <span className="text-sm font-medium text-content-emphasis">
                                    {popup.listing.commodity}
                                </span>
                                <span className="text-xs text-content-muted">
                                    {popup.listing.side === 'SELL' ? t('selling') : t('buying')}
                                </span>
                            </div>
                            <div className="text-xs text-content-secondary">
                                {popup.listing.quantityTonnes} t
                                {popup.listing.pricePerTonne
                                    ? ` · ${popup.listing.pricePerTonne} ${popup.listing.priceCurrency}/t`
                                    : ''}
                            </div>
                            <div className="text-xs text-content-muted">{popup.listing.regionName}</div>
                            <Button
                                variant="secondary"
                                size="sm"
                                className="mt-1 w-full"
                                onClick={() => onListingSelect(popup.listing.id)}
                            >
                                {t('viewDetails')}
                            </Button>
                        </div>
                    </Popup>
                )}
            </Map>

            {/* Loading scrim — until the basemap style + first tiles are in. */}
            {status === 'loading' && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-bg-default/60">
                    <span className="animate-pulse text-sm text-content-muted">{t('loadingMap')}</span>
                </div>
            )}

            {/* Fatal error — the basemap style never loaded (bad/missing
                MapTiler key, blocked style host, or no WebGL). Explains the
                blank pane instead of leaving a silent void; the offer list
                beside the map still works. */}
            {status === 'error' && (
                <div className="absolute inset-0 flex items-center justify-center bg-bg-default/80 p-default">
                    <div className="flex max-w-xs flex-col items-center gap-compact rounded-lg border border-border-subtle bg-bg-elevated p-default text-center">
                        <p className="text-sm font-medium text-content-emphasis">{t('mapLoadError')}</p>
                        <p className="text-xs text-content-muted">
                            {t('mapLoadErrorDetail')}
                        </p>
                    </div>
                </div>
            )}

            {/* Empty hint — map is fine, but nothing matches the filters. */}
            {status === 'ready' && listings.length === 0 && (
                <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-border-subtle bg-bg-elevated/90 px-3 py-1 text-xs text-content-muted">
                    {t('noOffers')}
                </div>
            )}

            {/* Terminal chrome — a wordmark chip with a live pulse, and the
                SELL/BUY key, floated on the map like a trading surface. */}
            {status === 'ready' && (
                <>
                    <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-1.5 rounded-full border border-border-subtle bg-bg-default/70 px-3 py-1.5 backdrop-blur-sm">
                        <span
                            className="inline-flex h-2 w-2 animate-pulse rounded-full"
                            style={{ backgroundColor: EXCHANGE_SIDE_COLORS.SELL }}
                        />
                        <span className="text-xs font-semibold tracking-wide text-content-emphasis">БОРСА</span>
                        <span className="text-xs text-content-muted">· {t('exchangeSuffix')}</span>
                    </div>
                    <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-compact rounded-lg border border-border-subtle bg-bg-default/70 px-3 py-1.5 backdrop-blur-sm">
                        <span className="flex items-center gap-1.5 text-xs text-content-muted">
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: EXCHANGE_SIDE_COLORS.SELL }} />
                            {t('selling')}
                        </span>
                        <span className="flex items-center gap-1.5 text-xs text-content-muted">
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: EXCHANGE_SIDE_COLORS.BUY }} />
                            {t('buying')}
                        </span>
                    </div>
                </>
            )}
        </div>
    );
}

export default ExchangeMap;
