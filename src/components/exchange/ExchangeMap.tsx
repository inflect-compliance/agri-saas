'use client';

/**
 * ExchangeMap — the cross-tenant marketplace map of Bulgaria.
 *
 * Reuses the existing MapLibre / react-map-gl stack (the same one MapCanvas
 * uses) — NO new map library. Two layers:
 *   A. Bulgaria oblast polygons (from the bundled /geo/bg-oblasti.geojson).
 *      Click an oblast → toggle a region filter (highlighted + list/markers
 *      filter to that regionCode).
 *   B. Clustered offer markers built from the (already client-filtered)
 *      listings. Cluster circles show the count; unclustered points are
 *      coloured by side (SELL green / BUY blue). Click a cluster → zoom in;
 *      click a point → a Popup with a "View details" affordance.
 *
 * Deliberately a NON-terrain basemap (streets/basic — cities + villages
 * labels), unlike the parcel map's satellite `hybrid`. The basemap style id
 * is overridable via the `basemapStyle` prop; the MapTiler key is read from
 * env exactly as MapCanvas's resolveBasemapStyle does.
 */
import 'maplibre-gl/dist/maplibre-gl.css';
import { useCallback, useMemo, useRef, useState } from 'react';
import Map, {
    Layer,
    Popup,
    Source,
    type MapLayerMouseEvent,
    type MapRef,
} from 'react-map-gl/maplibre';
import type { FeatureCollection } from 'geojson';
import { env } from '@/env';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';

/** Side colours — shared by the marker paint AND the page's legend so they
 *  always match. Green = selling, blue = buying (mirrors MapCanvas's
 *  done/selected palette). */
export const EXCHANGE_SIDE_COLORS = { SELL: '#16a34a', BUY: '#2563eb' } as const;

/** Bulgaria bounding box [[west, south], [east, north]] — fit on load. */
const BULGARIA_BOUNDS: [[number, number], [number, number]] = [
    [22.36, 41.23],
    [28.61, 44.22],
];

const DEMO_STYLE = 'https://demotiles.maplibre.org/style.json';

function styleUrl(styleId: string): string {
    const key = env.NEXT_PUBLIC_MAPTILER_KEY;
    if (!key) return DEMO_STYLE;
    return `https://api.maptiler.com/maps/${styleId}/style.json?key=${key}`;
}

export interface ExchangeMapListing {
    id: string;
    side: 'SELL' | 'BUY';
    commodity: string;
    quantityTonnes: string;
    pricePerTonne: string | null;
    priceCurrency: string;
    regionCode: string;
    regionName: string;
    lat: number;
    lon: number;
}

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
    /** Basemap style id — default a non-terrain streets style. */
    basemapStyle?: 'streets-v2' | 'basic-v2' | 'outdoor-v2';
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
    basemapStyle = 'streets-v2',
    className,
}: ExchangeMapProps) {
    const mapRef = useRef<MapRef | null>(null);
    const [popup, setPopup] = useState<PopupState | null>(null);

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
                    regionName: l.regionName,
                    lon: l.lon,
                    lat: l.lat,
                },
            })),
        }),
        [listings],
    );

    const fitBulgaria = useCallback(() => {
        mapRef.current?.fitBounds(BULGARIA_BOUNDS, { padding: 24, duration: 0 });
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

            // Cluster → zoom in on it.
            if (layerId === 'clusters') {
                const geom = feature.geometry;
                if (geom.type === 'Point') {
                    const [lng, lat] = geom.coordinates as [number, number];
                    const zoom = mapRef.current?.getZoom() ?? 6;
                    mapRef.current?.easeTo({ center: [lng, lat], zoom: zoom + 2, duration: 400 });
                }
                return;
            }

            // Unclustered offer point → open a popup.
            if (layerId === 'unclustered-point') {
                const p = feature.properties as Record<string, unknown>;
                setPopup({
                    lng: Number(p.lon),
                    lat: Number(p.lat),
                    listing: {
                        id: String(p.id),
                        side: p.side as 'SELL' | 'BUY',
                        commodity: String(p.commodity),
                        quantityTonnes: String(p.quantityTonnes),
                        pricePerTonne: p.pricePerTonne ? String(p.pricePerTonne) : null,
                        priceCurrency: String(p.priceCurrency),
                        regionCode: '',
                        regionName: String(p.regionName),
                        lat: Number(p.lat),
                        lon: Number(p.lon),
                    },
                });
            }
        },
        [onRegionClick],
    );

    return (
        <div className={cn('relative h-full w-full overflow-hidden rounded-lg border border-border-default', className)}>
            <Map
                ref={mapRef}
                initialViewState={{ longitude: 25.5, latitude: 42.7, zoom: 6 }}
                mapStyle={mapStyle}
                onLoad={fitBulgaria}
                onClick={handleClick}
                interactiveLayerIds={['oblast-fill', 'clusters', 'unclustered-point']}
                style={{ width: '100%', height: '100%' }}
                cursor="pointer"
            >
                {/* Layer A — Bulgaria oblast polygons. The clicked/filtered
                    oblasti are highlighted; the rest are a quiet wash. */}
                <Source id="oblasti" type="geojson" data="/geo/bg-oblasti.geojson">
                    <Layer
                        id="oblast-fill"
                        type="fill"
                        paint={{
                            'fill-color': [
                                'case',
                                ['in', ['get', 'shapeISO'], ['literal', selectedRegionCodes]],
                                '#22c55e',
                                '#94a3b8',
                            ],
                            'fill-opacity': [
                                'case',
                                ['in', ['get', 'shapeISO'], ['literal', selectedRegionCodes]],
                                0.22,
                                0.05,
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
                                '#15803d',
                                '#64748b',
                            ],
                            'line-width': [
                                'case',
                                ['in', ['get', 'shapeISO'], ['literal', selectedRegionCodes]],
                                2,
                                0.6,
                            ],
                        }}
                    />
                </Source>

                {/* Layer B — clustered offer markers. */}
                <Source
                    id="offers"
                    type="geojson"
                    data={offerGeojson}
                    cluster
                    clusterRadius={50}
                    clusterMaxZoom={9}
                >
                    <Layer
                        id="clusters"
                        type="circle"
                        filter={['has', 'point_count']}
                        paint={{
                            'circle-color': '#0ea5e9',
                            'circle-opacity': 0.85,
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
                </Source>

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
                                    {popup.listing.side === 'SELL' ? 'Selling' : 'Buying'}
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
                                View details
                            </Button>
                        </div>
                    </Popup>
                )}
            </Map>
        </div>
    );
}

export default ExchangeMap;
