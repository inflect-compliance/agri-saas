'use client';

/**
 * MapCanvas — renders a location's parcels as a MapLibre GeoJSON layer
 * and (optionally) lets the user click parcels to multi-select. Used by
 * the Location detail Map tab, the PrescriptionPanel, and the operator's
 * read-only field-operation view.
 *
 * Drawing/editing (Phase-1 fast-follow): when `mode` is 'draw', 'edit',
 * or 'split' a terra-draw (MIT) layer is mounted on the underlying
 * MapLibre map via its official adapter — 'draw' adds a polygon
 * (→ onCreateGeometry), 'edit' makes existing polygons' vertices
 * draggable (→ onUpdateGeometry, debounced), and 'split' draws a single
 * LineString blade across a parcel (→ onCreateSplitLine, then auto-
 * clears the line). 'select' (default) keeps the original click-to-select
 * behaviour and never loads terra-draw, so the read-only/operator and
 * spray-prescription paths are untouched.
 *
 * MapLibre GL (BSD-3) + react-map-gl (MIT) + terra-draw (MIT). No API key
 * (public demo basemap). Geometry is GeoJSON in WGS84.
 */
import 'maplibre-gl/dist/maplibre-gl.css';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import Map, { Layer, Source, type MapLayerMouseEvent, type MapRef } from 'react-map-gl/maplibre';
import type { Feature, FeatureCollection, Geometry, LineString, Polygon } from 'geojson';

export interface MapParcel {
    id: string;
    name: string;
    areaHa?: number | null;
    geometry: Geometry | null;
}

export type MapMode = 'select' | 'draw' | 'edit' | 'split';

export interface MapCanvasProps {
    parcels: MapParcel[];
    /** [west, south, east, north] for initial fit; world view when null. */
    bounds?: [number, number, number, number] | null;
    selectedIds?: string[];
    onSelectionChange?: (ids: string[]) => void;
    /** When false, the map is read-only (operator view). */
    interactive?: boolean;
    /** Parcels rendered as completed (green) — operator progress. */
    doneIds?: string[];
    /** Authoring mode (default 'select'). 'draw'/'edit'/'split' load terra-draw. */
    mode?: MapMode;
    /** Fired when a new polygon is drawn (draw mode). */
    onCreateGeometry?: (geometry: Polygon) => void;
    /** Fired (debounced) when an existing parcel's polygon is reshaped. */
    onUpdateGeometry?: (parcelId: string, geometry: Polygon) => void;
    /** Fired when a split line is drawn across a parcel (split mode). */
    onCreateSplitLine?: (line: LineString) => void;
    /**
     * NDVI raster overlay (Agro-intel). When `showNdvi` is true AND an
     * XYZ `{z}/{x}/{y}` template `ndviTileUrl` is supplied, a raster
     * `<Source>`/`<Layer>` is drawn over the AOI (the map is already fit
     * to the location's parcel bbox via `bounds`). When the URL is empty
     * the layer is simply not rendered — the page surfaces a "configure a
     * tile source" empty state.
     */
    showNdvi?: boolean;
    ndviTileUrl?: string;
    /**
     * Vector-tile source for read-only display (perf at scale). When set
     * AND the map is pure read-only (`!interactive` and `mode` is not a
     * drawing mode), a MapLibre `vector` `<Source>` is drawn from this
     * `{z}/{x}/{y}.pbf` template at zoom ≥ 6 (the `parcels` source-layer
     * carries `id` + `name` per feature). In that branch the GeoJSON
     * parcel layers are capped at `maxzoom={6}` so the two never
     * double-draw — GeoJSON below 6, vector tiles at/above 6. Ignored
     * (no-op) when interactive or drawing: selection + sketch stay on the
     * full GeoJSON source exactly as before.
     */
    vectorTileUrl?: string;
    className?: string;
}

const DEMO_STYLE = 'https://demotiles.maplibre.org/style.json';

export function MapCanvas({
    parcels,
    bounds,
    selectedIds = [],
    onSelectionChange,
    interactive = true,
    doneIds = [],
    mode = 'select',
    onCreateGeometry,
    onUpdateGeometry,
    onCreateSplitLine,
    showNdvi = false,
    ndviTileUrl,
    vectorTileUrl,
    className,
}: MapCanvasProps) {
    const ndviActive = showNdvi && !!ndviTileUrl && ndviTileUrl.length > 0;
    const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
    const done = useMemo(() => new Set(doneIds), [doneIds]);
    const mapRef = useRef<MapRef | null>(null);
    // terra-draw instance kept off-render; typed loosely to avoid leaking
    // the adapter's map generic across the component boundary.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const drawRef = useRef<any>(null);
    const drawing = mode === 'draw' || mode === 'edit' || mode === 'split';
    // Vector tiles only serve PURE read-only display: a tile URL is set,
    // the map is non-interactive, and no sketch mode owns the pointer.
    // In that case the GeoJSON layers cap at maxzoom 6 and the vector
    // source takes over at zoom ≥ 6 (no double-draw). When interactive or
    // drawing this is false → behave exactly as before (GeoJSON only).
    const vectorActive = !!vectorTileUrl && vectorTileUrl.length > 0 && !interactive && !drawing;

    const data = useMemo<FeatureCollection>(() => ({
        type: 'FeatureCollection',
        features: parcels
            .filter((p): p is MapParcel & { geometry: Geometry } => !!p.geometry)
            .map((p): Feature => ({
                type: 'Feature',
                id: p.id,
                properties: {
                    id: p.id,
                    name: p.name,
                    selected: selected.has(p.id),
                    done: done.has(p.id),
                },
                geometry: p.geometry,
            })),
    }), [parcels, selected, done]);

    const initialViewState = useMemo(() => {
        if (bounds) {
            const [w, s, e, n] = bounds;
            return { longitude: (w + e) / 2, latitude: (s + n) / 2, zoom: 12 };
        }
        return { longitude: 0, latitude: 20, zoom: 1 };
    }, [bounds]);

    const handleClick = useCallback((e: MapLayerMouseEvent) => {
        if (!interactive || !onSelectionChange || drawing) return;
        const feature = e.features?.[0];
        const id = feature?.properties?.id as string | undefined;
        if (!id) return;
        onSelectionChange(
            selected.has(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id],
        );
    }, [interactive, onSelectionChange, selected, selectedIds, drawing]);

    // ── terra-draw lifecycle (draw / edit / split modes only) ──────────
    useEffect(() => {
        const map = mapRef.current?.getMap();
        if (!map || !drawing) return;

        let cancelled = false;
        let debounce: ReturnType<typeof setTimeout> | null = null;

        // Dynamic import keeps terra-draw out of the bundle for the
        // read-only/select paths and off the SSR graph entirely.
        (async () => {
            const [
                { TerraDraw, TerraDrawPolygonMode, TerraDrawLineStringMode, TerraDrawSelectMode },
                { TerraDrawMapLibreGLAdapter },
            ] = await Promise.all([import('terra-draw'), import('terra-draw-maplibre-gl-adapter')]);
            if (cancelled) return;

            const draw = new TerraDraw({
                adapter: new TerraDrawMapLibreGLAdapter({ map }),
                modes: [
                    new TerraDrawPolygonMode(),
                    new TerraDrawLineStringMode(),
                    new TerraDrawSelectMode({
                        flags: {
                            polygon: {
                                feature: {
                                    draggable: false,
                                    coordinates: { midpoints: true, draggable: true, deletable: true },
                                },
                            },
                        },
                    }),
                ],
            });
            draw.start();
            drawRef.current = draw;

            if (mode === 'draw') {
                draw.setMode('polygon');
                draw.on('finish', (id: string | number, context: { action: string }) => {
                    if (context.action !== 'draw') return;
                    const f = draw.getSnapshotFeature(id);
                    if (f && f.geometry.type === 'Polygon') {
                        onCreateGeometry?.(f.geometry as Polygon);
                        draw.clear();
                    }
                });
            } else if (mode === 'split') {
                // Draw a single LineString blade across the target parcel.
                // On finish, hand the line to the host (→ split API) and
                // clear it — mirroring the draw-mode create+clear so a new
                // attempt starts from a clean slate.
                draw.setMode('linestring');
                draw.on('finish', (id: string | number, context: { action: string }) => {
                    if (context.action !== 'draw') return;
                    const f = draw.getSnapshotFeature(id);
                    if (f && f.geometry.type === 'LineString') {
                        onCreateSplitLine?.(f.geometry as LineString);
                        draw.clear();
                    }
                });
            } else {
                // edit — seed existing single-Polygon parcels as editable
                // features (MultiPolygon imports aren't vertex-editable here).
                const seed = parcels
                    .filter((p) => p.geometry?.type === 'Polygon')
                    .map((p) => ({
                        type: 'Feature' as const,
                        properties: { mode: 'polygon', parcelId: p.id },
                        geometry: p.geometry as Polygon,
                    }));
                if (seed.length) {
                    try {
                        draw.addFeatures(seed);
                    } catch {
                        /* a malformed stored geometry shouldn't break edit mode */
                    }
                }
                draw.setMode('select');
                draw.on('change', (ids: Array<string | number>) => {
                    if (debounce) clearTimeout(debounce);
                    debounce = setTimeout(() => {
                        for (const id of ids) {
                            const f = draw.getSnapshotFeature(id);
                            const parcelId = f?.properties?.parcelId as string | undefined;
                            if (parcelId && f?.geometry?.type === 'Polygon') {
                                onUpdateGeometry?.(parcelId, f.geometry as Polygon);
                            }
                        }
                    }, 700);
                });
            }
        })();

        return () => {
            cancelled = true;
            if (debounce) clearTimeout(debounce);
            try {
                drawRef.current?.stop();
            } catch {
                /* adapter already torn down */
            }
            drawRef.current = null;
        };
        // Re-init when the mode flips. Parcels are seeded once on entry to
        // edit mode (intentionally not a dep — re-seeding on every refresh
        // would fight the user's in-progress edit).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mode, drawing]);

    return (
        <div className={className ?? 'h-[480px] w-full overflow-hidden rounded-lg border border-border-subtle'}>
            <Map
                ref={mapRef}
                initialViewState={initialViewState}
                mapStyle={DEMO_STYLE}
                interactiveLayerIds={interactive && !drawing ? ['parcel-fill'] : []}
                onClick={handleClick}
                style={{ width: '100%', height: '100%' }}
                cursor={interactive && !drawing ? 'pointer' : 'grab'}
            >
                {/* NDVI raster overlay (Agro-intel). Drawn first so the
                    parcel fill/line layers stay legible on top. The map is
                    already fit to the AOI bbox via `bounds`. */}
                {ndviActive && (
                    <Source id="ndvi" type="raster" tiles={[ndviTileUrl!]} tileSize={256}>
                        <Layer id="ndvi-raster" type="raster" paint={{ 'raster-opacity': 0.7 }} />
                    </Source>
                )}

                {/* Hide the static layer while editing so terra-draw owns
                    the on-map render of the editable polygons. */}
                {mode !== 'edit' && (
                    <Source id="parcels" type="geojson" data={data}>
                        <Layer
                            id="parcel-fill"
                            type="fill"
                            // In read-only vector-tile mode, hand off to the
                            // vector source at zoom ≥ 6 so the two never
                            // double-draw. Uncapped otherwise (interactive/draw).
                            {...(vectorActive ? { maxzoom: 6 } : {})}
                            paint={{
                                'fill-color': [
                                    'case',
                                    ['boolean', ['get', 'done'], false], '#16a34a',
                                    ['boolean', ['get', 'selected'], false], '#2563eb',
                                    '#94a3b8',
                                ],
                                'fill-opacity': 0.4,
                            }}
                        />
                        <Layer
                            id="parcel-line"
                            type="line"
                            {...(vectorActive ? { maxzoom: 6 } : {})}
                            paint={{
                                'line-color': [
                                    'case',
                                    ['boolean', ['get', 'selected'], false], '#1d4ed8',
                                    '#475569',
                                ],
                                'line-width': 1.5,
                            }}
                        />
                    </Source>
                )}

                {/* Vector-tile source for read-only display at scale. Takes
                    over from the GeoJSON layers at zoom ≥ 6 (those cap at
                    maxzoom 6 above). The `parcels` source-layer carries no
                    selected/done state, so the neutral default fill/line
                    colors are used — mirroring the un-selected/un-done
                    GeoJSON paint values exactly. Only rendered for pure
                    read-only display (see `vectorActive`). */}
                {vectorActive && (
                    <Source id="parcels-vector" type="vector" tiles={[vectorTileUrl!]} minzoom={6}>
                        <Layer
                            id="parcels-vector-fill"
                            type="fill"
                            source-layer="parcels"
                            minzoom={6}
                            paint={{
                                'fill-color': '#94a3b8',
                                'fill-opacity': 0.4,
                            }}
                        />
                        <Layer
                            id="parcels-vector-line"
                            type="line"
                            source-layer="parcels"
                            minzoom={6}
                            paint={{
                                'line-color': '#475569',
                                'line-width': 1.5,
                            }}
                        />
                    </Source>
                )}
            </Map>
        </div>
    );
}

export default MapCanvas;
