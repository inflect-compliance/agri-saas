import { parseEuroPrice, oilseedCurrencyForRegion } from '@/lib/market/price-parse';

describe('parseEuroPrice', () => {
    it('parses the EC cereals comma-decimal shape "€178,00"', () => {
        expect(parseEuroPrice('€178,00')).toBe(178);
    });

    it('parses the EC oilseeds dot-decimal shape "€512.00"', () => {
        expect(parseEuroPrice('€512.00')).toBe(512);
    });

    it('treats a comma as the decimal separator and dots as thousands', () => {
        expect(parseEuroPrice('€1.234,56')).toBe(1234.56);
    });

    it('treats a dot as the decimal separator and commas as thousands', () => {
        expect(parseEuroPrice('1,234.56')).toBe(1234.56);
    });

    it('parses a bare integer', () => {
        expect(parseEuroPrice('200')).toBe(200);
    });

    it('accepts a numeric input unchanged', () => {
        expect(parseEuroPrice(42.5)).toBe(42.5);
    });

    it('returns null for non-numeric / empty / nullish values', () => {
        expect(parseEuroPrice(':')).toBeNull();
        expect(parseEuroPrice('n/a')).toBeNull();
        expect(parseEuroPrice('')).toBeNull();
        expect(parseEuroPrice(null)).toBeNull();
        expect(parseEuroPrice(undefined)).toBeNull();
    });
});

describe('oilseedCurrencyForRegion', () => {
    it('maps BG → BGN', () => {
        expect(oilseedCurrencyForRegion('BG')).toBe('BGN');
    });

    it('maps RO → RON', () => {
        expect(oilseedCurrencyForRegion('RO')).toBe('RON');
    });

    it('maps EL and EU → EUR (and any unknown region defaults to EUR)', () => {
        expect(oilseedCurrencyForRegion('EL')).toBe('EUR');
        expect(oilseedCurrencyForRegion('EU')).toBe('EUR');
        expect(oilseedCurrencyForRegion('XX')).toBe('EUR');
    });
});
