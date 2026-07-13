/**
 * Unit test — the reprojecting geometry SQL fragment (src/lib/db/geo.ts).
 *
 * Asserts the STRUCTURE of `reprojectedGeometrySql`, not a live DB result:
 * the reprojection (`ST_Transform → 4326`) must be applied BEFORE the repair
 * (`ST_MakeValid`), the source SRID must be stamped by `ST_SetSRID` inside the
 * transform, and the GeoJSON must ride as a bound parameter while the SRID is
 * inlined as an integer literal. This locks the ordering the cadastre ingest
 * relies on (reproject first, then repair — see the geo.ts docstring).
 */
import { reprojectedGeometrySql } from '@/lib/db/geo';
import type { Polygon } from 'geojson';

const POLY: Polygon = {
    type: 'Polygon',
    coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]],
};

describe('reprojectedGeometrySql', () => {
    it('emits ST_Transform to 4326 nested inside ST_MakeValid (reproject before repair)', () => {
        const frag = reprojectedGeometrySql(POLY, 7801);
        const text = frag.strings.join('');

        // All the expected PostGIS calls are present.
        for (const fn of ['ST_Multi', 'ST_CollectionExtract', 'ST_MakeValid', 'ST_Transform', 'ST_SetSRID', 'ST_GeomFromGeoJSON']) {
            expect(text).toContain(fn);
        }

        // Nesting order (outer → inner): MakeValid wraps Transform wraps SetSRID.
        // Reproject-before-repair means Transform is INSIDE MakeValid.
        expect(text.indexOf('ST_MakeValid')).toBeLessThan(text.indexOf('ST_Transform'));
        expect(text.indexOf('ST_Transform')).toBeLessThan(text.indexOf('ST_SetSRID'));

        // Target SRID 4326 and the inlined source SRID literal both present.
        expect(text).toContain('4326');
        expect(text).toContain('7801');
    });

    it('binds the GeoJSON as a parameter and inlines the SRID (not a bind value)', () => {
        const frag = reprojectedGeometrySql(POLY, 32635);
        // The GeoJSON string is the sole bound value; the SRID is raw SQL text.
        expect(frag.values).toHaveLength(1);
        expect(String(frag.values[0])).toContain('"type":"Polygon"');
        expect(frag.values.some((v) => v === 32635 || v === '32635')).toBe(false);
        expect(frag.strings.join('')).toContain('32635');
    });

    it('rejects a non-integer / non-positive source SRID', () => {
        expect(() => reprojectedGeometrySql(POLY, 0)).toThrow();
        expect(() => reprojectedGeometrySql(POLY, 4326.5)).toThrow();
    });
});
