/**
 * composeDisplayName — first + last name → single display string (UI 14b).
 * Mock prisma so we only test the pure compose/validate logic.
 */
jest.mock('@/lib/prisma', () => ({ __esModule: true, default: { user: { update: jest.fn() } } }));
import { composeDisplayName, DISPLAY_NAME_MAX } from '@/lib/account/profile';

describe('composeDisplayName', () => {
    it('joins first + last', () => {
        expect(composeDisplayName('Ada', 'Lovelace')).toBe('Ada Lovelace');
    });
    it('accepts first-only or last-only', () => {
        expect(composeDisplayName('Ada', '')).toBe('Ada');
        expect(composeDisplayName('', 'Lovelace')).toBe('Lovelace');
        expect(composeDisplayName('Ada', null)).toBe('Ada');
    });
    it('trims and strips HTML (sanitised)', () => {
        expect(composeDisplayName('  Ada  ', '  Lovelace ')).toBe('Ada Lovelace');
        expect(composeDisplayName('<b>Ada</b>', 'Lovelace')).not.toContain('<');
    });
    it('throws when nothing usable remains', () => {
        expect(() => composeDisplayName('', '')).toThrow();
        expect(() => composeDisplayName('   ', null)).toThrow();
    });
    it('throws when over the length cap', () => {
        expect(() => composeDisplayName('a'.repeat(DISPLAY_NAME_MAX + 1), '')).toThrow();
    });
});
