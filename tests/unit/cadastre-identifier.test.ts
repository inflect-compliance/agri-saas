/**
 * Unit — КАИС cadastral identifier validation + normalization + grouping.
 */
import {
    isValidCadastreIdentifier,
    normalizeCadastreIdentifier,
    ekatteOf,
    parseIdentifierList,
    groupByEkatte,
} from '@/lib/cadastre/identifier';

describe('isValidCadastreIdentifier', () => {
    const cases: Array<[string, boolean]> = [
        ['68134.8360.729', true],
        ['02676.15.42', true],
        ['00134.5.6', true], // leading-zero ЕКАТТЕ preserved
        ['68134.8360.729.1', false], // 4 parts — not the canonical form
        ['6813.8360.729', false], // 4-digit ЕКАТТЕ
        ['681345.8360.729', false], // 6-digit ЕКАТТЕ
        ['68134.8360', false], // 2 parts
        ['68134', false],
        ['abc.1.2', false],
        ['68134.83a.729', false],
        ['', false],
    ];
    it.each(cases)('validates %s => %s', (input, expected) => {
        expect(isValidCadastreIdentifier(input)).toBe(expected);
    });
});

describe('normalizeCadastreIdentifier', () => {
    it('trims and strips inner whitespace', () => {
        expect(normalizeCadastreIdentifier('  68134.8360.729  ')).toBe('68134.8360.729');
        expect(normalizeCadastreIdentifier('68134. 8360 .729')).toBe('68134.8360.729');
    });
    it('normalizes full-width dots', () => {
        expect(normalizeCadastreIdentifier('68134．8360．729')).toBe('68134.8360.729');
    });
    it('preserves leading zeros', () => {
        expect(normalizeCadastreIdentifier('00134.5.6')).toBe('00134.5.6');
    });
});

describe('ekatteOf', () => {
    it('returns the 5-digit prefix of a valid identifier', () => {
        expect(ekatteOf('68134.8360.729')).toBe('68134');
        expect(ekatteOf('00134.5.6')).toBe('00134');
    });
    it('returns null for a non-5-digit prefix', () => {
        expect(ekatteOf('6813.8360.729')).toBeNull();
    });
});

describe('parseIdentifierList', () => {
    it('splits a paste block into valid + invalid, de-duplicating valids', () => {
        const text = '68134.8360.729\n02676.15.42\n\nbad-line\n68134.8360.729\n  \n6813.1.2';
        const { valid, invalid } = parseIdentifierList(text);
        expect(valid).toEqual(['68134.8360.729', '02676.15.42']);
        expect(invalid).toEqual(['bad-line', '6813.1.2']);
    });
    it('handles CRLF line endings', () => {
        const { valid } = parseIdentifierList('68134.8360.729\r\n02676.15.42');
        expect(valid).toEqual(['68134.8360.729', '02676.15.42']);
    });
});

describe('groupByEkatte', () => {
    it('groups identifiers by their ЕКАТТЕ prefix, preserving order', () => {
        const groups = groupByEkatte(['68134.8360.729', '02676.15.42', '68134.100.5']);
        expect([...groups.keys()]).toEqual(['68134', '02676']);
        expect(groups.get('68134')).toEqual(['68134.8360.729', '68134.100.5']);
        expect(groups.get('02676')).toEqual(['02676.15.42']);
    });
});
