/**
 * Unit test — Bulgaria oblast catalogue + its alignment with the bundled
 * geojson polygons. Locks the 28-oblast count, the code lookup, and that
 * every region code matches a `shapeISO` in public/geo/bg-oblasti.geojson
 * (so a listing's regionCode always has a polygon).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    BULGARIA_REGIONS,
    BULGARIA_REGION_OPTIONS,
    regionByCode,
    isKnownRegionCode,
} from '@/lib/geo/bulgaria-regions';

describe('bulgaria-regions', () => {
    it('enumerates the 28 oblasti with unique codes', () => {
        expect(BULGARIA_REGIONS).toHaveLength(28);
        const codes = new Set(BULGARIA_REGIONS.map((r) => r.code));
        expect(codes.size).toBe(28);
    });

    it('regionByCode resolves a known code and rejects an unknown one', () => {
        expect(regionByCode('BG-16')?.nameEn).toBe('Plovdiv');
        expect(regionByCode('BG-16')?.nameBg).toBe('Пловдив');
        expect(regionByCode('BG-99')).toBeUndefined();
        expect(isKnownRegionCode('BG-16')).toBe(true);
        expect(isKnownRegionCode('BG-99')).toBe(false);
    });

    it('every region has valid Bulgaria-range coordinates', () => {
        for (const r of BULGARIA_REGIONS) {
            expect(r.lat).toBeGreaterThan(41);
            expect(r.lat).toBeLessThan(44.5);
            expect(r.lon).toBeGreaterThan(22);
            expect(r.lon).toBeLessThan(29);
        }
    });

    it('options are bilingual, one per region, sorted by Bulgarian name', () => {
        expect(BULGARIA_REGION_OPTIONS).toHaveLength(28);
        expect(BULGARIA_REGION_OPTIONS[0].label).toContain('/'); // "bg / en"
        const labels = BULGARIA_REGION_OPTIONS.map((o) => o.label);
        const sorted = [...labels].sort((a, b) => a.localeCompare(b, 'bg'));
        expect(labels).toEqual(sorted);
    });

    it('every region code has a matching polygon in the bundled geojson', () => {
        const geojsonPath = path.resolve(__dirname, '../../public/geo/bg-oblasti.geojson');
        const geo = JSON.parse(fs.readFileSync(geojsonPath, 'utf8')) as {
            features: { properties: { shapeISO: string } }[];
        };
        const shapeCodes = new Set(geo.features.map((f) => f.properties.shapeISO));
        for (const r of BULGARIA_REGIONS) {
            expect(shapeCodes.has(r.code)).toBe(true);
        }
    });
});
