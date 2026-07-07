/**
 * Unit tests — SoilGrids response normalisation (#37).
 *
 * `normaliseSoilGrids` is the pure transform behind `fetchSoilProfile`; it
 * converts SoilGrids "mapped units" (integer g/kg, pH×10, cg/cm³) to
 * real-world units and derives the USDA texture class. No network here — a
 * canned response is fed directly.
 */
import { normaliseSoilGrids } from '@/lib/soil/soilgrids-client';

function layer(name: string, mean: number | null, uncertainty: number | null = null) {
    return { name, depths: [{ label: '0-5cm', values: { mean, uncertainty } }] };
}

describe('normaliseSoilGrids', () => {
    const meta = { provider: 'soilgrids', fetchedAt: '2026-07-07T00:00:00.000Z' };

    it('converts mapped units and derives the texture class', () => {
        const resp = {
            properties: {
                layers: [
                    layer('clay', 200), // g/kg → 20 %
                    layer('sand', 400), // → 40 %
                    layer('silt', 400), // → 40 %
                    layer('phh2o', 65), // pH×10 → 6.5
                    layer('soc', 250), // dg/kg → 25 g/kg
                    layer('bdod', 140), // cg/cm³ → 1.40 g/cm³
                ],
            },
        };
        const p = normaliseSoilGrids(resp, meta);
        expect(p.clayPct).toBe(20);
        expect(p.sandPct).toBe(40);
        expect(p.siltPct).toBe(40);
        expect(p.phH2o).toBe(6.5);
        expect(p.socGkg).toBe(25);
        expect(p.bulkDensity).toBe(1.4);
        expect(p.textureClass).toBe('Loam'); // 40/40/20
        expect(p.provider).toBe('soilgrids');
        expect(p.depth).toBe('0-5cm');
    });

    it('yields honest nulls (never a fabricated class) on missing layers', () => {
        const p = normaliseSoilGrids({ properties: { layers: [] } }, meta);
        expect(p.clayPct).toBeNull();
        expect(p.phH2o).toBeNull();
        expect(p.textureClass).toBeNull();
    });

    it('carries per-property uncertainty companions', () => {
        const resp = {
            properties: { layers: [layer('phh2o', 65, 8)] },
        };
        const p = normaliseSoilGrids(resp, meta);
        expect(p.uncertainty?.phh2o?.mean).toBe(6.5);
        expect(p.uncertainty?.phh2o?.uncertainty).toBe(0.8); // 8 / 10
    });
});
