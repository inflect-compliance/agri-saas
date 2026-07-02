/**
 * Per-decare rate calculator — spray/fertilizer totals.
 */
import {
    DCA_PER_HA,
    haToDca,
    totalForArea,
    amountUnitOf,
    areaBasisOf,
    totalForRate,
    trimNumber,
    formatTotal,
    totalLabel,
} from '@/lib/agro/rate-calc';

describe('haToDca', () => {
    it('converts hectares to decares (1 ha = 10 dca)', () => {
        expect(DCA_PER_HA).toBe(10);
        expect(haToDca(10)).toBe(100);
        expect(haToDca(0.5)).toBe(5);
        expect(haToDca(0)).toBe(0);
    });
    it('returns 0 for non-finite area', () => {
        expect(haToDca(NaN)).toBe(0);
    });
});

describe('totalForArea', () => {
    it('computes rate × decares', () => {
        // 14 L/dca over a 10 ha (100 dca) parcel = 1400.
        expect(totalForArea(14, 10)).toBe(1400);
        // 100 ml/dca over 100 dca = 10000 ml.
        expect(totalForArea(100, 10)).toBe(10000);
    });
    it('is zero for zero area or non-finite inputs', () => {
        expect(totalForArea(14, 0)).toBe(0);
        expect(totalForArea(NaN, 10)).toBe(0);
        expect(totalForArea(14, NaN)).toBe(0);
    });
});

describe('amountUnitOf', () => {
    it('extracts the head amount unit from a rate symbol', () => {
        expect(amountUnitOf('ml/dca')).toBe('ml');
        expect(amountUnitOf('L/ha')).toBe('L');
        expect(amountUnitOf('kg/dca')).toBe('kg');
        expect(amountUnitOf('L / dca')).toBe('L');
    });
    it('falls back to the whole symbol when there is no slash', () => {
        expect(amountUnitOf('L')).toBe('L');
    });
});

describe('trimNumber', () => {
    it('drops trailing zeros and caps at 2dp', () => {
        expect(trimNumber(10)).toBe('10');
        expect(trimNumber(10.0)).toBe('10');
        expect(trimNumber(2.5)).toBe('2.5');
        expect(trimNumber(2.567)).toBe('2.57');
        expect(trimNumber(1400)).toBe('1400');
    });
});

describe('formatTotal', () => {
    it('matches the worked example', () => {
        // Water: 14 L/dca × 100 dca = 1400 L.
        expect(formatTotal(totalForArea(14, 10), 'L/dca')).toBe('1400 L');
        // Product: 100 ml/dca × 100 dca = 10000 ml → 10 L.
        expect(formatTotal(totalForArea(100, 10), 'ml/dca')).toBe('10 L');
    });
    it('promotes ml→L and g→kg at ≥ 1000', () => {
        expect(formatTotal(50000, 'ml/dca')).toBe('50 L');
        expect(formatTotal(2500, 'g/dca')).toBe('2.5 kg');
    });
    it('keeps small quantities in the base unit', () => {
        expect(formatTotal(100, 'ml/dca')).toBe('100 ml');
        expect(formatTotal(0, 'ml/dca')).toBe('0 ml');
        expect(formatTotal(3, 'L/ha')).toBe('3 L');
    });
});

describe('areaBasisOf', () => {
    it('reads the /ha or /dca basis from the symbol', () => {
        expect(areaBasisOf('L/dca')).toBe('dca');
        expect(areaBasisOf('mL/dca')).toBe('dca');
        expect(areaBasisOf('L/ha')).toBe('ha');
        expect(areaBasisOf('kg/ha')).toBe('ha');
        // Unknown/absent denominator defaults to hectare.
        expect(areaBasisOf('L')).toBe('ha');
    });
});

describe('totalForRate (basis-aware)', () => {
    it('multiplies /dca rates by decares', () => {
        expect(totalForRate(14, 'L/dca', 10)).toBe(1400);
        expect(totalForRate(100, 'mL/dca', 10)).toBe(10000);
    });
    it('multiplies /ha rates by hectares', () => {
        // 2 L/ha over 10 ha = 20 L (NOT × dca).
        expect(totalForRate(2, 'L/ha', 10)).toBe(20);
    });
    it('is zero for non-finite inputs', () => {
        expect(totalForRate(NaN, 'L/dca', 10)).toBe(0);
    });
});

describe('totalLabel', () => {
    it('computes and formats honoring the basis', () => {
        expect(totalLabel(14, 'L/dca', 10)).toBe('1400 L');
        expect(totalLabel(100, 'mL/dca', 10)).toBe('10 L');
        // Per-hectare rate stays per-hectare.
        expect(totalLabel(2, 'L/ha', 10)).toBe('20 L');
    });
});
