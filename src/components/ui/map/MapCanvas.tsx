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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Map, { Layer, Marker, Source, type MapLayerMouseEvent, type MapRef } from 'react-map-gl/maplibre';
import type { Feature, FeatureCollection, Geometry, LineString, Polygon } from 'geojson';
import { validatePolygonGeometry, type PolygonValidity } from '@/lib/geo/polygon-validity';
import { Crosshairs3, MapPosition, Minus, Plus } from '@/components/ui/icons/nucleo';
import { cn } from '@/lib/cn';

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
     * Optimistic client-side topology feedback. Whenever a polygon is
     * drawn (draw mode) or reshaped (edit mode), the freshly-edited
     * geometry is run through `validatePolygonGeometry` and the result is
     * handed back here — letting the host page show a NON-BLOCKING hint
     * ("shape looks invalid — it will be auto-repaired on save"). This is
     * purely a UX preview: drawing is never blocked, and the server's
     * PostGIS `ST_MakeValid`/`ST_IsValid` remain the authority on persist.
     */
    onGeometryValidity?: (validity: PolygonValidity) => void;
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
     * On-map thumb controls (zoom ±, locate-me). Opt-in so the read-only
     * operator/prescription paths are unchanged unless they ask for it.
     * Each button is a ≥44px (WCAG 2.5.5) touch target, sat in the
     * bottom-right thumb zone. "Locate me" calls
     * `navigator.geolocation.getCurrentPosition()`, flies to the device
     * and drops a blue accuracy dot — permission-graceful (a denial shows
     * a non-blocking hint, never throws).
     */
    showControls?: boolean;
    /**
     * Lift the control stack this many px off the map's bottom edge so it
     * clears a fixed bottom-tab bar on phones. Defaults to 12px.
     */
    controlsBottomInset?: number;
    /**
     * Stretch — add a live-tracking toggle next to locate-me.
     * `watchPosition()` follows the device and draws a breadcrumb trail;
     * battery-aware (high-accuracy only while tracking, watch cleared on
     * stop/unmount). Requires `showControls`.
     */
    liveTracking?: boolean;
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
    onGeometryValidity,
    showNdvi = false,
    ndviTileUrl,
    showControls = false,
    controlsBottomInset = 12,
    liveTracking = false,
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

    // ── Geolocation (locate-me + stretch live-tracking) ────────────────
    // The device's own GPS, surfaced as a blue dot and (while tracking) a
    // breadcrumb trail. All client-side: no ST_* / geo.ts round-trip.
    const geoAvailable = typeof navigator !== 'undefined' && 'geolocation' in navigator;
    const [userLoc, setUserLoc] = useState<{ lon: number; lat: number } | null>(null);
    const [locating, setLocating] = useState(false);
    const [tracking, setTracking] = useState(false);
    const [trail, setTrail] = useState<Array<[number, number]>>([]);
    const [geoError, setGeoError] = useState<string | null>(null);
    const watchId = useRef<number | null>(null);

    const geoErrMessage = useCallback((err: GeolocationPositionError) =>
        err.code === err.PERMISSION_DENIED
            ? 'Location permission denied — enable it to centre the map on you.'
            : 'Could not get your location. Try again with a clearer sky view.',
    []);

    const handleLocate = useCallback(() => {
        if (!geoAvailable) { setGeoError('Location is not available on this device.'); return; }
        setGeoError(null);
        setLocating(true);
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const { longitude, latitude } = pos.coords;
                setUserLoc({ lon: longitude, lat: latitude });
                mapRef.current?.flyTo({ center: [longitude, latitude], zoom: 16, duration: 1200 });
                setLocating(false);
            },
            (err) => { setGeoError(geoErrMessage(err)); setLocating(false); },
            { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
        );
    }, [geoAvailable, geoErrMessage]);

    const stopTracking = useCallback(() => {
        if (watchId.current !== null) {
            navigator.geolocation.clearWatch(watchId.current);
            watchId.current = null;
        }
        setTracking(false);
    }, []);

    const startTracking = useCallback(() => {
        if (!geoAvailable) { setGeoError('Location is not available on this device.'); return; }
        setGeoError(null);
        setTrail([]);
        setTracking(true);
        watchId.current = navigator.geolocation.watchPosition(
            (pos) => {
                const { longitude, latitude } = pos.coords;
                setUserLoc({ lon: longitude, lat: latitude });
                // Append to the breadcrumb only on meaningful movement
                // (~2m) so the trail doesn't accrue jitter at a standstill.
                setTrail((t) => {
                    const last = t[t.length - 1];
                    if (last && Math.abs(last[0] - longitude) < 2e-5 && Math.abs(last[1] - latitude) < 2e-5) return t;
                    return [...t, [longitude, latitude]];
                });
                mapRef.current?.easeTo({ center: [longitude, latitude], duration: 500 });
            },
            (err) => { setGeoError(geoErrMessage(err)); stopTracking(); },
            { enableHighAccuracy: true, timeout: 10_000, maximumAge: 5_000 },
        );
    }, [geoAvailable, geoErrMessage, stopTracking]);

    // Battery-aware: always release the watch when the map unmounts.
    useEffect(() => () => {
        if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    }, []);

    const trailData = useMemo<FeatureCollection>(() => ({
        type: 'FeatureCollection',
        features: trail.length > 1
            ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: trail } }]
            : [],
    }), [trail]);

    const controlBtn =
        'flex min-h-[44px] min-w-[44px] items-center justify-center bg-bg-default text-content-default ' +
        'transition-colors hover:bg-bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset';

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
                        const geometry = f.geometry as Polygon;
                        // Optimistic preview: flag obvious topology problems
                        // for a non-blocking host hint. Never gates the draw.
                        onGeometryValidity?.(validatePolygonGeometry(geometry));
                        onCreateGeometry?.(geometry);
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
                                const geometry = f.geometry as Polygon;
                                // Optimistic preview on reshape (see draw mode).
                                onGeometryValidity?.(validatePolygonGeometry(geometry));
                                onUpdateGeometry?.(parcelId, geometry);
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

    // Human-readable description of what the map is doing right now, so
    // screen-reader users get the same context the sighted toolbar hint
    // gives. Mirrors the per-mode copy on the Location detail Map tab.
    const modeLabel =
        mode === 'draw'
            ? 'drawing a new parcel'
            : mode === 'edit'
              ? 'editing parcel vertices'
              : mode === 'split'
                ? 'splitting a parcel'
                : interactive
                  ? 'selecting parcels'
                  : 'read-only view';

    return (
        // Keyboard-focusable, labelled map region. MapLibre's own canvas
        // handles arrow-key panning once focused; `tabIndex={0}` + the
        // group role surface it to keyboard + AT users (the bare
        // <Map> wrapper is otherwise an unlabelled, un-focusable div).
        <div
            role="group"
            aria-label={`Parcel map — ${modeLabel}`}
            tabIndex={0}
            className={cn(
                // `relative` anchors the absolutely-positioned on-map control
                // overlay + the geolocation error toast.
                'relative',
                // Focusable region always carries a visible focus ring
                // (keyboard affordance must survive a custom className too).
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                // Default size/skin is responsive (360px on phones, 480px
                // from md: up); a passed className overrides the sizing/skin.
                className ??
                    'h-[360px] w-full overflow-hidden rounded-lg border border-border-subtle md:h-[480px]',
            )}
        >
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

                {/* GPS breadcrumb (live-tracking) — drawn under the dot. */}
                {tracking && trail.length > 1 && (
                    <Source id="gps-trail" type="geojson" data={trailData}>
                        <Layer
                            id="gps-trail-line"
                            type="line"
                            paint={{ 'line-color': '#2563eb', 'line-width': 3, 'line-opacity': 0.75 }}
                        />
                    </Source>
                )}

                {/* Device location — the classic "blue dot": a solid centre
                    with a soft accuracy halo. Purely decorative (aria-hidden);
                    the locate button is the labelled control. */}
                {userLoc && (
                    <Marker longitude={userLoc.lon} latitude={userLoc.lat} anchor="center">
                        <div
                            data-testid="map-user-dot"
                            aria-hidden="true"
                            className="relative flex size-7 items-center justify-center"
                        >
                            <span className="absolute size-7 rounded-full bg-[var(--brand-default)] opacity-20" />
                            <span className="size-3.5 rounded-full border-2 border-bg-default bg-[var(--brand-default)] shadow-md" />
                        </div>
                    </Marker>
                )}
            </Map>

            {/* ── On-map thumb controls (opt-in) ──────────────────────────
                Bottom-right thumb zone; each button a ≥44px touch target.
                The container is pointer-events-none so map panning is
                unaffected; only the buttons capture taps. */}
            {showControls && (
                <div className="pointer-events-none absolute inset-0 z-10">
                    <div
                        className="pointer-events-auto absolute right-3 flex flex-col items-end gap-tight"
                        style={{ bottom: controlsBottomInset }}
                    >
                        {geoAvailable && (
                            <button
                                type="button"
                                onClick={handleLocate}
                                aria-label="Locate me"
                                aria-busy={locating}
                                data-testid="map-locate"
                                className={cn(controlBtn, 'rounded-lg border border-border-subtle shadow-md')}
                            >
                                {locating ? (
                                    <span className="size-5 animate-spin rounded-full border-2 border-border-emphasis border-t-transparent" />
                                ) : (
                                    <Crosshairs3 className="size-5" aria-hidden="true" />
                                )}
                            </button>
                        )}
                        {liveTracking && geoAvailable && (
                            <button
                                type="button"
                                onClick={() => (tracking ? stopTracking() : startTracking())}
                                aria-label={tracking ? 'Stop live tracking' : 'Start live tracking'}
                                aria-pressed={tracking}
                                data-testid="map-track"
                                className={cn(
                                    controlBtn,
                                    'rounded-lg border shadow-md',
                                    tracking
                                        ? 'border-border-emphasis text-content-emphasis ring-2 ring-ring'
                                        : 'border-border-subtle',
                                )}
                            >
                                <MapPosition className="size-5" aria-hidden="true" />
                            </button>
                        )}
                        <div className="flex flex-col overflow-hidden rounded-lg border border-border-subtle shadow-md divide-y divide-border-subtle">
                            <button
                                type="button"
                                onClick={() => mapRef.current?.zoomIn()}
                                aria-label="Zoom in"
                                data-testid="map-zoom-in"
                                className={controlBtn}
                            >
                                <Plus className="size-5" aria-hidden="true" />
                            </button>
                            <button
                                type="button"
                                onClick={() => mapRef.current?.zoomOut()}
                                aria-label="Zoom out"
                                data-testid="map-zoom-out"
                                className={controlBtn}
                            >
                                <Minus className="size-5" aria-hidden="true" />
                            </button>
                        </div>
                    </div>

                    {/* Non-blocking geolocation hint (permission denied /
                        unavailable). aria-live so AT users hear it too. */}
                    {geoError && (
                        <div
                            role="status"
                            aria-live="polite"
                            data-testid="map-geo-error"
                            className="pointer-events-none absolute inset-x-3 top-3 rounded-lg border border-border-subtle bg-bg-default/95 px-3 py-2 text-xs text-content-secondary shadow-md"
                        >
                            {geoError}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export default MapCanvas;
