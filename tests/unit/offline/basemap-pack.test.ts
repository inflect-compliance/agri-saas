/**
 * Unit — offline basemap pack tile math + LRU eviction predicate.
 *
 * The eviction predicate is the load-bearing piece: it decides which tiles
 * the dedicated basemap cache sheds when it crosses its byte budget. The
 * service worker mirrors this exact logic inline (it can't import from src/),
 * so pinning the predicate here is what keeps the SW's eviction honest.
 */
import {
    BASEMAP_MAX_ZOOM,
    BASEMAP_MIN_ZOOM,
    isTileInBbox,
    lngLatToTileXY,
    selectBasemapEvictions,
    tilesForBbox,
    type BasemapCacheEntry,
} from '@/lib/offline/basemap-pack';

describe('selectBasemapEvictions — LRU eviction predicate', () => {
    const entry = (key: string, size: number): BasemapCacheEntry => ({ key, size });

    it('evicts nothing when total is at or under budget', () => {
        const entries = [entry('a', 10), entry('b', 10), entry('c', 10)];
        expect(selectBasemapEvictions(entries, 30)).toEqual([]);
        expect(selectBasemapEvictions(entries, 100)).toEqual([]);
    });

    it('over budget evicts the OLDEST entries first (front of the list)', () => {
        // entries are ordered oldest→newest; budget 25 leaves room for the two
        // newest (10 + 10) after shedding the oldest (10).
        const entries = [entry('oldest', 10), entry('mid', 10), entry('newest', 10)];
        expect(selectBasemapEvictions(entries, 25)).toEqual(['oldest']);
    });

    it('evicts as many oldest entries as needed to get under budget', () => {
        const entries = [entry('a', 10), entry('b', 10), entry('c', 10), entry('d', 10)];
        // budget 15 → must shed until ≤15: drop a (30 left), b (20 left), c (10 ≤15).
        expect(selectBasemapEvictions(entries, 15)).toEqual(['a', 'b', 'c']);
    });

    it('treats a just-inserted single entry over budget by evicting it', () => {
        expect(selectBasemapEvictions([entry('big', 100)], 50)).toEqual(['big']);
    });

    it('is stable when sizes are uneven — stops as soon as it fits', () => {
        const entries = [entry('a', 30), entry('b', 5), entry('c', 5)];
        // total 40, budget 20 → drop a (10 left ≤20), stop.
        expect(selectBasemapEvictions(entries, 20)).toEqual(['a']);
    });

    it('never counts a negative/garbage size as freeing space', () => {
        const entries = [entry('a', -5), entry('b', 40)];
        // negatives clamp to 0 → total 40, budget 30 → must drop 'a' then 'b'
        // (dropping 'a' frees 0, still over) → both evicted.
        expect(selectBasemapEvictions(entries, 30)).toEqual(['a', 'b']);
    });
});

describe('tile math', () => {
    it('lngLatToTileXY clamps into the valid 2^z grid', () => {
        const z = 4;
        const n = 2 ** z;
        // A far out-of-range lon/lat can never produce a negative or ≥n tile.
        const t = lngLatToTileXY(400, 400, z);
        expect(t.x).toBeGreaterThanOrEqual(0);
        expect(t.x).toBeLessThan(n);
        expect(t.y).toBeGreaterThanOrEqual(0);
        expect(t.y).toBeLessThan(n);
    });

    it('z0 is a single tile for any coordinate', () => {
        expect(lngLatToTileXY(0, 0, 0)).toEqual({ x: 0, y: 0 });
        expect(lngLatToTileXY(25, 42, 0)).toEqual({ x: 0, y: 0 });
    });

    it('tilesForBbox produces a bounded, capped set over the zoom range', () => {
        // A small Bulgarian farm bbox.
        const bbox: [number, number, number, number] = [25.0, 42.0, 25.02, 42.02];
        const tiles = tilesForBbox(bbox);
        expect(tiles.length).toBeGreaterThan(0);
        // Every tile is within the demotiles native zoom range.
        for (const t of tiles) {
            expect(t.z).toBeGreaterThanOrEqual(BASEMAP_MIN_ZOOM);
            expect(t.z).toBeLessThanOrEqual(BASEMAP_MAX_ZOOM);
        }
        // A tiny farm bbox stays far under the safety cap.
        expect(tiles.length).toBeLessThan(64);
    });

    it('tilesForBbox honours the tile cap', () => {
        const bbox: [number, number, number, number] = [-179, -85, 179, 85];
        const tiles = tilesForBbox(bbox, 0, 6, 10);
        expect(tiles.length).toBe(10);
    });

    it('isTileInBbox agrees with tilesForBbox membership', () => {
        const bbox: [number, number, number, number] = [25.0, 42.0, 25.5, 42.5];
        const tiles = tilesForBbox(bbox);
        for (const t of tiles) {
            expect(isTileInBbox(bbox, t.z, t.x, t.y)).toBe(true);
        }
        // A tile far outside the bbox at a mid zoom is rejected.
        expect(isTileInBbox(bbox, 6, 0, 0)).toBe(false);
    });
});
