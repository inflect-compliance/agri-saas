'use client';

/**
 * ExchangeMap — the cross-tenant marketplace map of Bulgaria.
 *
 * A bespoke Canvas renderer (NOT MapLibre): for a Bulgaria-only commodity
 * overview a full GL basemap was overkill and hard to make read like the
 * "grain floor" mockup. Instead we draw our own map on a 2D canvas:
 *   • Dark canvas = the void outside Bulgaria — no spotlight-mask maths, no
 *     neighbour geography competing for attention.
 *   • Oblast (ADM1) polygons filled by a gold liquidity choropleth (share of
 *     offered tonnage), emerald when filter-selected; click toggles the filter.
 *   • Offer markers: SELL green / BUY blue, sized by tonnage, with a soft glow.
 *     At overview zoom offers AGGREGATE per (region · crop · side) into one
 *     marker labelled with that crop's average price; zoom in and they SPLIT
 *     into individual listings, revealing tonnage then location as you push in.
 *   • One national ★ BEST per crop (cheapest ask, or highest bid for buy-only
 *     crops) gets a gold ring. Price chips de-conflict by priority: a chip that
 *     would overlap a stronger one fades back; hover or tap lifts it forward.
 *   • Tap a marker to pin its full line (location · crop · tonnage · price);
 *     a single offer also opens a detail popup. +/- buttons zoom (bottom-left).
 *
 * Geometry (projected province paths + outline + the projection params) is the
 * bundled `/geo/bg-map-geometry.json`; live offer lon/lat is projected at
 * runtime with the same params so markers land on the right province.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Minus } from '@/components/ui/icons/nucleo';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { type ExchangeMapListing } from './exchange-map-utils';

/** Side colours — shared by the marker paint AND the page's legend/list so they
 *  always match. Green = selling, blue = buying. */
export const EXCHANGE_SIDE_COLORS = { SELL: '#34d399', BUY: '#5b8def' } as const;

/** Grain-gold — the brand accent (wheat + value/money). Chrome + liquidity. */
export const EXCHANGE_ACCENT_GOLD = '#e3b341';

/** Brighter gold reserved for the best-price ring so it out-punches the chrome. */
const BEST_GOLD = '#f5c542';
/** Selected-region fill (emerald, matching the SELL marker family). */
const REGION_ACCENT = '#22c55e';

/** Zoom (= k / fit) thresholds for progressive disclosure. */
const SPLIT_Z = 3.4; // below: aggregate per region·crop; above: individual offers + tonnage
const LOC_Z = 6.5; //  above: chips also carry the region name

/** The exchange is euro-denominated (Bulgaria adopted the euro) — every price
 *  renders as €/t regardless of a listing's stored currency code. */
const PRICE_UNIT = '€/t';

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
    className?: string;
}

interface Geometry {
    W: number;
    H: number;
    proj: { minX: number; maxX: number; minY: number; maxY: number; cos: number; ox: number; oy: number; s: number };
    oblasti: { d: string; iso: string; name: string }[];
    outlinePath: string;
}

/** An offer projected into the geometry's WxH space, plus derived flags. */
interface POffer {
    id: string;
    listing: ExchangeMapListing;
    side: 'SELL' | 'BUY';
    commodity: string;
    t: number;
    price: number;
    curr: string;
    regionCode: string;
    regionName: string;
    px: number;
    py: number;
    best: boolean;
    // fan-out for offers sharing an exact projected point (revealed on split)
    fx: number;
    fy: number;
    cCount: number;
}

interface OGroup {
    key: string;
    regionCode: string;
    regionName: string;
    commodity: string;
    side: 'SELL' | 'BUY';
    offers: POffer[];
    offerIds: string[];
    cx: number;
    cy: number;
    totalT: number;
    avg: number | null;
    priceStr: string;
    curr: string;
    best: boolean;
}

/** A drawable marker+chip for the current frame (screen space). */
interface Item {
    id: string;
    sx: number;
    sy: number;
    r: number;
    col: string;
    best: boolean;
    glow: number;
    pri: number;
    loc: string;
    crop: string;
    ton: number;
    priceStr: string;
    curr: string;
    single: boolean;
    offerId?: string;
    offerIds?: string[];
    listing?: ExchangeMapListing;
    wx: number;
    wy: number;
    text?: string;
}

interface Rect { x: number; y: number; w: number; h: number }

function lerp(a: number, b: number, t: number): number {
    return Math.round(a + (b - a) * t);
}
/** Land base (heat 0, warm loam) → bright wheat gold (heat 1). */
function heatColor(h: number): string {
    return `rgb(${lerp(42, 156, h)},${lerp(33, 122, h)},${lerp(19, 52, h)})`;
}
function rectsOverlap(a: Rect, b: Rect): boolean {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Draw one marker: soft side-coloured glow, gold double-ring when best. */
function drawMarker(ctx: CanvasRenderingContext2D, it: Item): void {
    const R = it.best ? it.r * 1.28 : it.r;
    ctx.save();
    ctx.shadowColor = it.col;
    ctx.shadowBlur = 13 + it.glow * 12;
    ctx.globalAlpha = 0.82;
    ctx.fillStyle = it.col;
    ctx.beginPath();
    ctx.arc(it.sx, it.sy, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    if (it.best) {
        ctx.strokeStyle = 'rgba(245,197,66,.4)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(it.sx, it.sy, R + 7.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.save();
        ctx.shadowColor = BEST_GOLD;
        ctx.shadowBlur = 16;
        ctx.strokeStyle = BEST_GOLD;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.arc(it.sx, it.sy, R + 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }
    ctx.fillStyle = it.col;
    ctx.strokeStyle = '#0b0f18';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(it.sx, it.sy, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
}

interface Model {
    offers: POffer[];
    groups: OGroup[];
    heatByIso: Record<string, number>;
    maxT: number;
    maxGT: number;
}

/** Project listings, tag the national best per crop, and pre-aggregate. */
function buildModel(listings: ExchangeMapListing[], geom: Geometry): Model {
    const { proj } = geom;
    const project = (lon: number, lat: number): [number, number] => [
        proj.ox + (lon - proj.minX) * proj.cos * proj.s,
        proj.oy + (proj.maxY - lat) * proj.s,
    ];

    const offers: POffer[] = listings.map((l) => {
        const [px, py] = project(l.lon, l.lat);
        return {
            id: l.id,
            listing: l,
            side: l.side,
            commodity: l.commodity,
            t: Number(l.quantityTonnes) || 0,
            price: Number(l.pricePerTonne) || 0,
            curr: l.priceCurrency,
            regionCode: l.regionCode,
            regionName: l.regionName,
            px,
            py,
            best: false,
            fx: 0,
            fy: 0,
            cCount: 1,
        };
    });

    // National best per CROP (side-agnostic): cheapest sell ask, or — for a
    // buy-only crop — the highest bid. Ties broken by larger tonnage.
    const byCrop: Record<string, POffer[]> = {};
    for (const o of offers) {
        if (o.price > 0) (byCrop[o.commodity] ??= []).push(o);
    }
    for (const arr of Object.values(byCrop)) {
        const sells = arr.filter((o) => o.side === 'SELL');
        const pool = sells.length ? sells : arr;
        const dir = sells.length ? 1 : -1;
        const win = pool.reduce((a, b) =>
            b.price * dir < a.price * dir || (b.price === a.price && b.t > a.t) ? b : a,
        );
        win.best = true;
    }

    // Fan-out dirs for offers sharing an exact projected point (split view).
    const coincident: Record<string, POffer[]> = {};
    for (const o of offers) (coincident[`${Math.round(o.px)}|${Math.round(o.py)}`] ??= []).push(o);
    for (const list of Object.values(coincident)) {
        list.forEach((o, i) => {
            o.cCount = list.length;
            const a = list.length > 1 ? (i / list.length) * Math.PI * 2 - Math.PI / 2 : 0;
            o.fx = Math.cos(a);
            o.fy = Math.sin(a);
        });
    }

    // Aggregate per region · crop · side.
    const groupMap: Record<string, OGroup> = {};
    for (const o of offers) {
        const key = `${o.regionCode}|${o.commodity}|${o.side}`;
        (groupMap[key] ??= {
            key,
            regionCode: o.regionCode,
            regionName: o.regionName,
            commodity: o.commodity,
            side: o.side,
            offers: [],
            offerIds: [],
            cx: 0,
            cy: 0,
            totalT: 0,
            avg: null,
            priceStr: '',
            curr: o.curr,
            best: false,
        }).offers.push(o);
    }
    const groups = Object.values(groupMap).map((g) => {
        g.offerIds = g.offers.map((o) => o.id);
        g.cx = g.offers.reduce((s, o) => s + o.px, 0) / g.offers.length;
        g.cy = g.offers.reduce((s, o) => s + o.py, 0) / g.offers.length;
        g.totalT = g.offers.reduce((s, o) => s + o.t, 0);
        g.best = g.offers.some((o) => o.best);
        const priced = g.offers.filter((o) => o.price > 0);
        g.avg = priced.length ? Math.round(priced.reduce((s, o) => s + o.price, 0) / priced.length) : null;
        g.priceStr = g.avg == null ? '' : priced.length > 1 ? `⌀${g.avg}` : `${priced[0].price}`;
        return g;
    });

    // Per-region choropleth heat (share of the busiest region's tonnage).
    const tonnesByRegion: Record<string, number> = {};
    for (const o of offers) tonnesByRegion[o.regionCode] = (tonnesByRegion[o.regionCode] ?? 0) + o.t;
    const maxRegion = Math.max(1, ...Object.values(tonnesByRegion));
    const heatByIso: Record<string, number> = {};
    for (const [iso, tonnes] of Object.entries(tonnesByRegion)) heatByIso[iso] = tonnes / maxRegion;

    return {
        offers,
        groups,
        heatByIso,
        maxT: Math.max(1, ...offers.map((o) => o.t)),
        maxGT: Math.max(1, ...groups.map((g) => g.totalT)),
    };
}

export function ExchangeMap({
    listings,
    selectedRegionCodes,
    onRegionClick,
    onListingSelect,
    highlightedId,
    className,
}: ExchangeMapProps) {
    const t = useTranslations('exchangeMap');
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const wrapRef = useRef<HTMLDivElement | null>(null);
    const popupRef = useRef<HTMLDivElement | null>(null);

    const [geom, setGeom] = useState<Geometry | null>(null);
    const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
    const [pinnedId, setPinnedId] = useState<string | null>(null);
    const [popup, setPopup] = useState<{ listing: ExchangeMapListing; wx: number; wy: number } | null>(null);

    // View transform (pan/zoom) lives in a ref so pointer moves never re-render.
    const view = useRef({ k: 1, tx: 0, ty: 0, fit: 1 });
    // Last frame's drawn items, for pointer hit-testing.
    const itemsRef = useRef<Item[]>([]);
    // Latest draw fn, so once-attached pointer handlers always call the current one.
    const drawRef = useRef<() => void>(() => {});

    useEffect(() => {
        let alive = true;
        fetch('/geo/bg-map-geometry.json')
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
            .then((d: Geometry) => {
                if (!alive) return;
                setGeom(d);
                setStatus('ready');
            })
            .catch(() => alive && setStatus('error'));
        return () => {
            alive = false;
        };
    }, []);

    const provincePaths = useMemo(
        () => (geom ? geom.oblasti.map((o) => ({ path: new Path2D(o.d), iso: o.iso })) : []),
        [geom],
    );
    const outlinePath = useMemo(() => (geom ? new Path2D(geom.outlinePath) : null), [geom]);
    const model = useMemo(() => (geom ? buildModel(listings, geom) : null), [geom, listings]);

    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        const g = geom;
        const m = model;
        if (!canvas || !g || !m) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const CW = canvas.clientWidth;
        const CH = canvas.clientHeight;
        const { k, tx, ty, fit } = view.current;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = '#060a12';
        ctx.fillRect(0, 0, CW, CH);

        // Provinces + outline in world (WxH) space.
        ctx.save();
        ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * tx, dpr * ty);
        const selected = new Set(selectedRegionCodes);
        for (const p of provincePaths) {
            ctx.fillStyle = selected.has(p.iso) ? REGION_ACCENT : heatColor(m.heatByIso[p.iso] ?? 0);
            ctx.fill(p.path);
        }
        ctx.lineWidth = 0.5 / k;
        for (const p of provincePaths) {
            ctx.strokeStyle = selected.has(p.iso) ? REGION_ACCENT : 'rgba(90,74,42,.5)';
            ctx.lineWidth = (selected.has(p.iso) ? 1.6 : 0.5) / k;
            ctx.stroke(p.path);
        }
        if (outlinePath) {
            ctx.lineWidth = 1.1 / k;
            ctx.strokeStyle = 'rgba(227,179,65,.35)';
            ctx.stroke(outlinePath);
        }
        ctx.restore();

        // Build this frame's markers (aggregate below SPLIT, individual above).
        const z = k / fit;
        const items: Item[] = [];
        const col = (side: 'SELL' | 'BUY') => EXCHANGE_SIDE_COLORS[side];
        if (z < SPLIT_Z) {
            for (const gr of m.groups) {
                items.push({
                    id: `g${gr.key}`,
                    sx: gr.cx * k + tx,
                    sy: gr.cy * k + ty,
                    r: 3 + (gr.totalT / m.maxGT) * 3,
                    col: col(gr.side),
                    best: gr.best,
                    glow: gr.totalT / m.maxGT,
                    pri: (gr.best ? 1e6 : 0) + gr.totalT,
                    loc: gr.regionName,
                    crop: gr.commodity,
                    ton: gr.totalT,
                    priceStr: gr.priceStr,
                    curr: gr.curr,
                    single: false,
                    offerIds: gr.offerIds,
                    wx: gr.cx,
                    wy: gr.cy,
                });
            }
        } else {
            const spread = Math.min(36, 16 + (z - SPLIT_Z) * 24);
            for (const o of m.offers) {
                const off = o.cCount > 1;
                items.push({
                    id: `s${o.id}`,
                    sx: o.px * k + tx + (off ? o.fx * spread : 0),
                    sy: o.py * k + ty + (off ? o.fy * spread : 0),
                    r: 2.4 + (o.t / m.maxT) * 3,
                    col: col(o.side),
                    best: o.best,
                    glow: o.t / m.maxT,
                    pri: (o.best ? 1e6 : 0) + o.t,
                    loc: o.regionName,
                    crop: o.commodity,
                    ton: o.t,
                    priceStr: o.price > 0 ? `${o.price}` : '',
                    curr: o.curr,
                    single: true,
                    offerId: o.id,
                    listing: o.listing,
                    wx: o.px,
                    wy: o.py,
                });
            }
        }

        // Compose each chip's text: crop always; +tonnage on split/pin; +region
        // on deep-zoom/pin; price+currency always (when known).
        const showLocAll = z >= LOC_Z;
        const showTonAll = z >= SPLIT_Z;
        for (const it of items) {
            const pin = it.id === pinnedId;
            const parts: string[] = [];
            if ((showLocAll || pin) && it.loc) parts.push(it.loc);
            parts.push(it.crop);
            if (showTonAll || pin) parts.push(`${it.ton}t`);
            if (it.priceStr) parts.push(`${it.priceStr}${PRICE_UNIT}`);
            it.text = parts.join('·');
        }

        // Which marker the list-row hover maps to (bring its chip forward).
        const hovered = highlightedId
            ? items.find((it) =>
                  it.single ? it.offerId === highlightedId : it.offerIds?.includes(highlightedId),
              )
            : undefined;
        const hoverId = hovered?.id ?? null;

        // Markers first, then chips (so labels sit above every dot).
        for (const it of items) drawMarker(ctx, it);

        // Chip metrics/box.
        const measure = (it: Item): { bx: number; w: number } => {
            ctx.font = '10px ui-monospace,monospace';
            // Best gets a drawn gold dot (no glyph — keeps the file emoji-free).
            const badge = it.best ? 9 : 0;
            return { bx: it.sx + 5, w: ctx.measureText(it.text ?? '').width + badge + 7 };
        };
        const rectOf = (it: Item): Rect => {
            const mm = measure(it);
            return { x: mm.bx, y: it.sy - 8, w: mm.w, h: 16 };
        };
        const drawChip = (it: Item, alpha: number) => {
            const mm = measure(it);
            const by = it.sy;
            ctx.globalAlpha = alpha;
            ctx.fillStyle = '#0d1220';
            ctx.strokeStyle = it.best ? BEST_GOLD : '#2a3648';
            ctx.lineWidth = it.best ? 1.2 : 1;
            ctx.beginPath();
            ctx.roundRect(mm.bx, by - 8, mm.w, 16, 4);
            ctx.fill();
            ctx.stroke();
            ctx.textBaseline = 'middle';
            let cx = mm.bx + 4;
            if (it.best) {
                ctx.fillStyle = BEST_GOLD;
                ctx.beginPath();
                ctx.arc(mm.bx + 7, by, 2.6, 0, Math.PI * 2);
                ctx.fill();
                cx = mm.bx + 13;
            }
            ctx.font = '10px ui-monospace,monospace';
            ctx.fillStyle = '#ede7d8';
            ctx.fillText(it.text ?? '', cx, by);
            ctx.globalAlpha = 1;
        };

        const placed: Rect[] = [];
        const lift = new Set([hoverId, pinnedId]);
        for (const it of [...items].sort((a, b) => b.pri - a.pri)) {
            if (lift.has(it.id)) continue;
            const rect = rectOf(it);
            const clip = placed.some((r) => rectsOverlap(r, rect));
            if (!clip || it.best) {
                placed.push(rect);
                drawChip(it, 1);
            } else {
                drawChip(it, 0.24);
            }
        }
        const pinItem = items.find((i) => i.id === pinnedId);
        if (pinItem) drawChip(pinItem, 1);
        const hovItem = items.find((i) => i.id === hoverId && i.id !== pinnedId);
        if (hovItem) drawChip(hovItem, 1);

        itemsRef.current = items;

        // Keep the DOM detail popup pinned to its offer through pan/zoom.
        if (popup && popupRef.current) {
            popupRef.current.style.transform = `translate(-50%, -100%) translate(${popup.wx * k + tx}px, ${popup.wy * k + ty - 14}px)`;
        }
    }, [geom, model, provincePaths, outlinePath, selectedRegionCodes, highlightedId, pinnedId, popup]);

    // Keep the ref pointing at the latest draw so once-attached pointer
    // handlers and the ResizeObserver always call the current closure.
    useEffect(() => {
        drawRef.current = draw;
    });

    // Resize / initial fit — the pane settles after mount, so refit on resize.
    useEffect(() => {
        const canvas = canvasRef.current;
        const wrap = wrapRef.current;
        if (!canvas || !wrap || !geom) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const resize = () => {
            const rect = wrap.getBoundingClientRect();
            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;
            const fit = Math.min(rect.width / geom.W, rect.height / geom.H) * 0.98;
            const v = view.current;
            // Keep it fit-framed until the user zooms (k tracks fit while untouched).
            if (v.k < 0.5 || Math.abs(v.k - v.fit) < 1e-6) {
                v.fit = fit;
                v.k = fit;
                v.tx = (rect.width - geom.W * fit) / 2;
                v.ty = (rect.height - geom.H * fit) / 2;
            } else {
                v.fit = fit;
            }
            drawRef.current();
        };
        resize();
        const ro = new ResizeObserver(resize);
        ro.observe(wrap);
        return () => ro.disconnect();
    }, [geom]);

    // Redraw whenever the frame inputs change.
    useEffect(() => {
        drawRef.current();
    }, [draw]);

    const zoomAt = useCallback((cx: number, cy: number, factor: number) => {
        const v = view.current;
        const nk = Math.max(v.fit * 0.9, Math.min(v.fit * 22, v.k * factor));
        v.tx = cx - (cx - v.tx) * (nk / v.k);
        v.ty = cy - (cy - v.ty) * (nk / v.k);
        v.k = nk;
        drawRef.current();
    }, []);

    // Pointer: drag to pan, distinguish a tap, hit-test markers then provinces.
    const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
    const moved = useRef(false);

    const nearest = useCallback((mx: number, my: number): Item | null => {
        let best: Item | null = null;
        let bd = 1e9;
        for (const it of itemsRef.current) {
            const dx = it.sx - mx;
            const dy = it.sy - my;
            const d = dx * dx + dy * dy;
            if (d < bd) {
                bd = d;
                best = it;
            }
        }
        return bd < 676 ? best : null;
    }, []);

    const onPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
        drag.current = { x: e.clientX, y: e.clientY, tx: view.current.tx, ty: view.current.ty };
        moved.current = false;
        e.currentTarget.setPointerCapture(e.pointerId);
    }, []);

    const onPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
        const d = drag.current;
        if (!d) return;
        if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 5) moved.current = true;
        view.current.tx = d.tx + (e.clientX - d.x);
        view.current.ty = d.ty + (e.clientY - d.y);
        drawRef.current();
    }, []);

    const onPointerUp = useCallback(
        (e: React.PointerEvent<HTMLCanvasElement>) => {
            const wasDrag = moved.current;
            drag.current = null;
            if (wasDrag) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            const hit = nearest(mx, my);
            if (hit) {
                setPinnedId((cur) => (cur === hit.id ? null : hit.id));
                if (hit.single && hit.listing) {
                    setPopup({ listing: hit.listing, wx: hit.wx, wy: hit.wy });
                } else {
                    setPopup(null);
                }
                return;
            }
            // Empty space → clear selection, then province hit-test for the filter.
            setPinnedId(null);
            setPopup(null);
            const canvas = canvasRef.current;
            const ctx = canvas?.getContext('2d');
            if (!ctx) return;
            const v = view.current;
            const wx = (mx - v.tx) / v.k;
            const wy = (my - v.ty) / v.k;
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            for (const p of provincePaths) {
                if (ctx.isPointInPath(p.path, wx, wy)) {
                    onRegionClick(p.iso);
                    break;
                }
            }
        },
        [nearest, onRegionClick, provincePaths],
    );

    const onWheel = useCallback(
        (e: React.WheelEvent<HTMLCanvasElement>) => {
            const rect = e.currentTarget.getBoundingClientRect();
            zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.15 : 1 / 1.15);
        },
        [zoomAt],
    );

    const zoomButton = useCallback(
        (factor: number) => {
            const canvas = canvasRef.current;
            if (!canvas) return;
            zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, factor);
        },
        [zoomAt],
    );

    const popupListing = popup?.listing ?? null;

    return (
        <div
            ref={wrapRef}
            className={cn(
                'relative h-full w-full select-none overflow-hidden rounded-lg border border-border-default',
                className,
            )}
        >
            <canvas
                ref={canvasRef}
                className="block h-full w-full touch-none"
                style={{ cursor: 'grab' }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onWheel={onWheel}
            />

            {/* Detail popup for a tapped single offer — tracks the marker via a
                transform set in draw(). */}
            {popupListing && (
                <div
                    ref={popupRef}
                    className="pointer-events-auto absolute left-0 top-0 z-10 w-52 space-y-tight rounded-lg border border-border-emphasis bg-bg-elevated p-default"
                >
                    <div className="flex items-center gap-compact">
                        <span
                            aria-hidden="true"
                            className="inline-block h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: EXCHANGE_SIDE_COLORS[popupListing.side] }}
                        />
                        <span className="text-sm font-medium text-content-emphasis">{popupListing.commodity}</span>
                        <span className="text-xs text-content-muted">
                            {popupListing.side === 'SELL' ? t('selling') : t('buying')}
                        </span>
                    </div>
                    <div className="text-xs text-content-secondary">
                        {popupListing.quantityTonnes} t
                        {popupListing.pricePerTonne ? ` · ${popupListing.pricePerTonne} ${PRICE_UNIT}` : ''}
                    </div>
                    <div className="text-xs text-content-muted">{popupListing.regionName}</div>
                    <Button
                        variant="secondary"
                        size="sm"
                        className="mt-1 w-full"
                        onClick={() => onListingSelect(popupListing.id)}
                    >
                        {t('viewDetails')}
                    </Button>
                </div>
            )}

            {/* Zoom controls (bottom-left). */}
            {status === 'ready' && (
                <div className="absolute bottom-3 left-3 flex flex-col gap-1.5">
                    <Button
                        variant="secondary"
                        size="icon"
                        aria-label={t('zoomIn')}
                        onClick={() => zoomButton(1.5)}
                        icon={<Plus />}
                    />
                    <Button
                        variant="secondary"
                        size="icon"
                        aria-label={t('zoomOut')}
                        onClick={() => zoomButton(1 / 1.5)}
                        icon={<Minus />}
                    />
                </div>
            )}

            {/* Loading / error / empty. */}
            {status === 'loading' && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-bg-default/60">
                    <span className="animate-pulse text-sm text-content-muted">{t('loadingMap')}</span>
                </div>
            )}
            {status === 'error' && (
                <div className="absolute inset-0 flex items-center justify-center bg-bg-default/80 p-default">
                    <div className="flex max-w-xs flex-col items-center gap-compact rounded-lg border border-border-subtle bg-bg-elevated p-default text-center">
                        <p className="text-sm font-medium text-content-emphasis">{t('mapLoadError')}</p>
                        <p className="text-xs text-content-muted">{t('mapLoadErrorDetail')}</p>
                    </div>
                </div>
            )}
            {status === 'ready' && listings.length === 0 && (
                <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-border-subtle bg-bg-elevated/90 px-3 py-1 text-xs text-content-muted">
                    {t('noOffers')}
                </div>
            )}

            {/* Terminal chrome — wordmark chip + SELL/BUY/best/liquidity key. */}
            {status === 'ready' && (
                <>
                    <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-1.5 rounded-full border border-border-subtle bg-bg-default/70 px-3 py-1.5 backdrop-blur-sm">
                        <span
                            className="inline-flex h-2 w-2 animate-pulse rounded-full"
                            style={{ backgroundColor: EXCHANGE_ACCENT_GOLD }}
                        />
                        <span className="text-xs font-semibold tracking-wide text-content-emphasis">БОРСА</span>
                        <span className="text-xs text-content-muted">· {t('exchangeSuffix')}</span>
                    </div>
                    <div className="pointer-events-none absolute bottom-3 left-16 right-3 flex flex-wrap items-center gap-compact rounded-lg border border-border-subtle bg-bg-default/70 px-3 py-1.5 backdrop-blur-sm">
                        <span className="flex items-center gap-1.5 text-xs text-content-muted">
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: EXCHANGE_SIDE_COLORS.SELL }} />
                            {t('selling')}
                        </span>
                        <span className="flex items-center gap-1.5 text-xs text-content-muted">
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: EXCHANGE_SIDE_COLORS.BUY }} />
                            {t('buying')}
                        </span>
                        <span className="flex items-center gap-1.5 text-xs text-content-muted">
                            <span className="h-2.5 w-2.5 rounded-full border" style={{ borderColor: BEST_GOLD }} />
                            {t('bestPrice')}
                        </span>
                        <span className="ml-auto flex items-center gap-1.5 text-xs text-content-muted">
                            {t('liquidity')}
                            <span
                                className="h-2 w-9 rounded-sm"
                                style={{ background: `linear-gradient(90deg, ${heatColor(0)}, ${heatColor(1)}, ${EXCHANGE_ACCENT_GOLD})` }}
                            />
                        </span>
                    </div>
                </>
            )}
        </div>
    );
}

export default ExchangeMap;
