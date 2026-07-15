/**
 * Unit tests for the news feed registry + env override parser.
 *
 * `parseFeedsEnv` is pure (no env read) so it tests deterministically: valid
 * JSON overrides the defaults; anything malformed returns null so the caller
 * falls back to the curated defaults rather than shipping a broken empty feed.
 */
import { DEFAULT_NEWS_FEEDS, parseFeedsEnv } from '@/lib/news/feeds';
import { NEWS_CATEGORIES } from '@/lib/news/categorize';

describe('DEFAULT_NEWS_FEEDS', () => {
    it('every default feed has a slug, an https url, and a valid category', () => {
        expect(DEFAULT_NEWS_FEEDS.length).toBeGreaterThan(0);
        for (const f of DEFAULT_NEWS_FEEDS) {
            expect(f.slug).toMatch(/^[a-z0-9-]+$/);
            expect(f.url).toMatch(/^https:\/\//);
            expect([...NEWS_CATEGORIES]).toContain(f.defaultCategory);
        }
    });

    it('slugs are unique', () => {
        const slugs = DEFAULT_NEWS_FEEDS.map((f) => f.slug);
        expect(new Set(slugs).size).toBe(slugs.length);
    });
});

describe('parseFeedsEnv', () => {
    it('returns null for unset / blank input (caller uses defaults)', () => {
        expect(parseFeedsEnv(undefined)).toBeNull();
        expect(parseFeedsEnv('')).toBeNull();
        expect(parseFeedsEnv('   ')).toBeNull();
    });

    it('parses a valid JSON array of feeds', () => {
        const raw = JSON.stringify([
            { slug: 'x', url: 'https://x.example/rss', category: 'market' },
            { slug: 'y', url: 'https://y.example/atom', category: 'policy' },
        ]);
        expect(parseFeedsEnv(raw)).toEqual([
            { slug: 'x', url: 'https://x.example/rss', defaultCategory: 'market' },
            { slug: 'y', url: 'https://y.example/atom', defaultCategory: 'policy' },
        ]);
    });

    it('drops entries with a missing url or an invalid category', () => {
        const raw = JSON.stringify([
            { slug: 'ok', url: 'https://ok.example/rss', category: 'general' },
            { slug: 'nourl', category: 'market' },
            { slug: 'badcat', url: 'https://bad.example/rss', category: 'sports' },
        ]);
        expect(parseFeedsEnv(raw)).toEqual([
            { slug: 'ok', url: 'https://ok.example/rss', defaultCategory: 'general' },
        ]);
    });

    it('defaults a missing category to general', () => {
        const raw = JSON.stringify([{ slug: 'nocat', url: 'https://nocat.example/rss' }]);
        expect(parseFeedsEnv(raw)).toEqual([
            { slug: 'nocat', url: 'https://nocat.example/rss', defaultCategory: 'general' },
        ]);
    });

    it('returns null on malformed JSON (caller falls back to defaults)', () => {
        expect(parseFeedsEnv('{not json')).toBeNull();
        expect(parseFeedsEnv('"a string"')).toBeNull();
        expect(parseFeedsEnv('{"an":"object"}')).toBeNull();
    });

    it('returns null when the array has no usable entries', () => {
        const raw = JSON.stringify([{ slug: 'nourl' }]);
        expect(parseFeedsEnv(raw)).toBeNull();
    });
});
