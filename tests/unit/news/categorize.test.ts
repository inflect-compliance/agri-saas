/**
 * Unit tests for the pure news categoriser.
 *
 * The categoriser is deterministic (no I/O, no AI): a BG+EN keyword match
 * promotes an item to 'policy' or 'market', otherwise the feed's default
 * category stands. These tests pin the precedence, the Bulgarian stemming
 * behaviour, and the fallback.
 */
import { categorize, NEWS_CATEGORIES } from '@/lib/news/categorize';

describe('categorize', () => {
    it('exposes exactly the three buckets', () => {
        expect([...NEWS_CATEGORIES]).toEqual(['market', 'policy', 'general']);
    });

    describe('policy keywords (BG + EN) win', () => {
        it.each([
            'Нови директни плащания по ДФЗ за 2026',
            'Субсидиите за площ се увеличават',
            'ЕК одобри промяна в регламента за ОСП',
            'Наредба за еко схемите влиза в сила',
            'New CAP subsidy scheme approved by the Commission',
            'Ministry updates the direct payments regulation',
        ])('promotes %j to policy even from a general feed', (title) => {
            expect(categorize(title, null, 'general')).toBe('policy');
        });
    });

    describe('market keywords (BG + EN) win', () => {
        it.each([
            'Цената на пшеницата се покачва',
            'Реколтата от слънчоглед е рекордна',
            'Износът на зърно през Черно море се възстановява',
            'Пазарът на ечемик остава стабилен',
            'Wheat price rises on export demand',
            'Grain harvest outlook improves',
        ])('promotes %j to market even from a general feed', (title) => {
            expect(categorize(title, null, 'general')).toBe('market');
        });
    });

    it('prefers policy over market when both signals appear', () => {
        // A subsidy headline that also mentions price stays policy — the
        // subsidy/regulation signal is the more actionable classification.
        expect(
            categorize('Субсидиите ще повлияят на цената на зърното', null, 'general'),
        ).toBe('policy');
    });

    it('matches Bulgarian stems across inflections (substring)', () => {
        expect(categorize('Плащанията стартират', null, 'general')).toBe('policy');
        expect(categorize('Цени на тон', null, 'general')).toBe('market');
    });

    it('matches against the summary too, not only the title', () => {
        expect(
            categorize('Седмичен обзор', 'Новите субсидии за фермерите', 'general'),
        ).toBe('policy');
    });

    it('is case-insensitive', () => {
        expect(categorize('WHEAT PRICE JUMPS', null, 'general')).toBe('market');
    });

    it('falls back to the feed default when no keyword matches', () => {
        expect(categorize('Времето през уикенда', null, 'general')).toBe('general');
        expect(categorize('Времето през уикенда', null, 'market')).toBe('market');
        expect(categorize('Времето през уикенда', null, 'policy')).toBe('policy');
    });

    it('handles empty / whitespace input by using the default', () => {
        expect(categorize('', '', 'general')).toBe('general');
        expect(categorize('   ', null, 'market')).toBe('market');
    });
});
