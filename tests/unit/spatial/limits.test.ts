/**
 * Spatial-upload abuse limits — unit coverage for the pure guards that
 * bound a parcel import before (size) and after (complexity) parsing.
 *
 * These are the cheap, DB-free locks of Epic harden-security #2:
 *   • assertUploadWithinSize  → 413 over the per-format byte cap
 *   • countParcelVertices     → sums MultiPolygon rings
 *   • assertParcelComplexity  → 422 over parcel-count / vertex caps
 */
import type { Position } from 'geojson';
import type { ParsedParcel } from '@/lib/spatial/parse';
import {
    SPATIAL_UPLOAD_LIMITS,
    MAX_PARCEL_VERTICES,
    MAX_TOTAL_VERTICES,
    MAX_PARCEL_COUNT,
    SPATIAL_PARSE_TIMEOUT_MS,
    SpatialLimitError,
    assertUploadWithinSize,
    countParcelVertices,
    assertParcelComplexity,
} from '@/lib/spatial/limits';

/** A parcel whose single ring carries `n` vertices. */
function parcelWithVertices(name: string, n: number): ParsedParcel {
    const ring: Position[] = [];
    for (let i = 0; i < n; i++) ring.push([i % 360, (i % 180) - 90]);
    return { name, geometry: { type: 'MultiPolygon', coordinates: [[ring]] }, properties: {} };
}

describe('spatial limits — constants', () => {
    it('caps shapefile tighter than text formats', () => {
        expect(SPATIAL_UPLOAD_LIMITS.shapefile).toBe(5 * 1024 * 1024);
        expect(SPATIAL_UPLOAD_LIMITS.geojson).toBe(10 * 1024 * 1024);
        expect(SPATIAL_UPLOAD_LIMITS.kml).toBe(10 * 1024 * 1024);
        expect(SPATIAL_UPLOAD_LIMITS.shapefile).toBeLessThan(SPATIAL_UPLOAD_LIMITS.geojson);
    });
    it('exposes a 30s parse budget', () => {
        expect(SPATIAL_PARSE_TIMEOUT_MS).toBe(30_000);
    });
});

describe('assertUploadWithinSize', () => {
    it('passes at exactly the cap (boundary)', () => {
        expect(() => assertUploadWithinSize('shapefile', SPATIAL_UPLOAD_LIMITS.shapefile)).not.toThrow();
        expect(() => assertUploadWithinSize('geojson', SPATIAL_UPLOAD_LIMITS.geojson)).not.toThrow();
    });

    it('rejects one byte over the shapefile cap with a 413', () => {
        try {
            assertUploadWithinSize('shapefile', SPATIAL_UPLOAD_LIMITS.shapefile + 1);
            throw new Error('expected throw');
        } catch (err) {
            expect(err).toBeInstanceOf(SpatialLimitError);
            expect((err as SpatialLimitError).statusCode).toBe(413);
            expect((err as Error).message).toMatch(/too large/i);
        }
    });

    it('applies the looser cap to GeoJSON / KML', () => {
        // 8 MB passes for text formats but would blow the 5 MB shapefile cap.
        const eightMb = 8 * 1024 * 1024;
        expect(() => assertUploadWithinSize('geojson', eightMb)).not.toThrow();
        expect(() => assertUploadWithinSize('kml', eightMb)).not.toThrow();
        expect(() => assertUploadWithinSize('shapefile', eightMb)).toThrow(SpatialLimitError);
    });
});

describe('countParcelVertices', () => {
    it('sums every ring across the MultiPolygon', () => {
        expect(countParcelVertices(parcelWithVertices('A', 12))).toBe(12);
        // two polygons, two rings each.
        const multi: ParsedParcel = {
            name: 'M',
            geometry: {
                type: 'MultiPolygon',
                coordinates: [
                    [[[0, 0], [1, 0], [1, 1], [0, 0]], [[0, 0], [0.5, 0], [0.5, 0.5], [0, 0]]],
                    [[[2, 2], [3, 2], [3, 3], [2, 2]]],
                ],
            },
            properties: {},
        };
        expect(countParcelVertices(multi)).toBe(4 + 4 + 4);
    });
});

describe('assertParcelComplexity', () => {
    it('passes a reasonable parcel set', () => {
        expect(() => assertParcelComplexity([
            parcelWithVertices('North 40', 200),
            parcelWithVertices('South 80', 1500),
        ])).not.toThrow();
    });

    it('passes an empty set', () => {
        expect(() => assertParcelComplexity([])).not.toThrow();
    });

    it('rejects too many parcels with a 422 (count checked first)', () => {
        const many = Array.from({ length: MAX_PARCEL_COUNT + 1 }, (_, i) => parcelWithVertices(`p${i}`, 1));
        try {
            assertParcelComplexity(many);
            throw new Error('expected throw');
        } catch (err) {
            expect(err).toBeInstanceOf(SpatialLimitError);
            expect((err as SpatialLimitError).statusCode).toBe(422);
            expect((err as Error).message).toMatch(/too many parcels/i);
        }
    });

    it('rejects a single over-complex parcel and names it', () => {
        const parcels = [
            parcelWithVertices('Fine field', 100),
            parcelWithVertices('Pathological field', MAX_PARCEL_VERTICES + 1),
        ];
        try {
            assertParcelComplexity(parcels);
            throw new Error('expected throw');
        } catch (err) {
            expect(err).toBeInstanceOf(SpatialLimitError);
            expect((err as SpatialLimitError).statusCode).toBe(422);
            expect((err as Error).message).toContain('Pathological field');
        }
    });

    it('rejects an aggregate-vertex blowout even when each parcel is under the per-parcel cap', () => {
        // 11 × 49k = 539k > 500k total, each 49k < 50k per-parcel cap.
        const each = 49_000;
        const n = Math.ceil((MAX_TOTAL_VERTICES + 1) / each); // 11
        const parcels = Array.from({ length: n }, (_, i) => parcelWithVertices(`field-${i}`, each));
        try {
            assertParcelComplexity(parcels);
            throw new Error('expected throw');
        } catch (err) {
            expect(err).toBeInstanceOf(SpatialLimitError);
            expect((err as SpatialLimitError).statusCode).toBe(422);
            expect((err as Error).message).toMatch(/too complex/i);
        }
    });
});
