/**
 * Curated registry of the RSS/Atom feeds the News tab aggregates, plus the
 * `MARKET_NEWS_FEEDS` env override parser.
 *
 * Feeds are FREE, public agricultural news sources — no API key, no secret —
 * so the default list lives in source. Each feed declares a `defaultCategory`
 * that stands unless the deterministic keyword categoriser
 * (`src/lib/news/categorize.ts`) promotes an individual item.
 *
 * Operators can override the whole list without a redeploy via the
 * `MARKET_NEWS_FEEDS` env var (a JSON array of `{ slug, url, category }`). This
 * is the escape hatch for tuning sources in prod (a feed dies, a better one
 * appears) and for verifying feed URLs against the live sources — the default
 * URLs below are best-effort. A malformed value falls back to the defaults, and
 * the daily pull is fail-soft per feed, so a dead URL simply yields no items.
 *
 * @module lib/news/feeds
 */
import { NEWS_CATEGORIES, type NewsCategory } from './categorize';

/** One aggregation source: a feed URL + the category its items default to. */
export interface NewsFeed {
    /** Stable slug stored on every item as `source` (kebab-case). */
    slug: string;
    /** RSS 2.0 or Atom feed URL. */
    url: string;
    /** Category applied to an item unless a keyword promotes it. */
    defaultCategory: NewsCategory;
}

/**
 * Default feeds — Bulgarian agri news portals, each VERIFIED live from a cloud
 * IP on 2026-07-15 (200 + valid RSS + real items), representative of what the
 * server-side pull sees. All default to `general` (broad portals); the keyword
 * categoriser promotes individual market/policy items. Operators can still
 * override via `MARKET_NEWS_FEEDS`, and the pull is fail-soft so a feed that
 * later dies just contributes nothing.
 *
 * Notable rejects (do NOT re-add without re-verifying): agri.bg + sinor.bg
 * (WAF 403 from datacenter IPs — unusable for a server pull), agroclub.bg /
 * dfz.bg / mzh.government.bg (no working RSS / 404 — the Ministry + State Fund
 * expose none), agroportal.bg + agri-press.network.europa.eu (HTML, not a
 * feed). EC general-news + Eurostat feeds work but are NOT agri-specific, so
 * they'd pollute the tab — left out deliberately.
 */
export const DEFAULT_NEWS_FEEDS: readonly NewsFeed[] = [
    { slug: 'agro-bg', url: 'https://agro.bg/rss', defaultCategory: 'general' },
    { slug: 'agrovest', url: 'https://agrovest.bg/feed/', defaultCategory: 'general' },
    { slug: 'agrozona', url: 'https://agrozona.bg/feed/', defaultCategory: 'general' },
    { slug: 'agrotv', url: 'https://agrotv.bg/feed/', defaultCategory: 'general' },
];

const isCategory = (v: unknown): v is NewsCategory =>
    typeof v === 'string' && (NEWS_CATEGORIES as readonly string[]).includes(v);

/**
 * Parse a `MARKET_NEWS_FEEDS` env value into a feed list. PURE — takes the raw
 * string, does not read `process.env`. Returns `null` when unset, blank,
 * malformed, or containing no usable entry, so the caller falls back to
 * {@link DEFAULT_NEWS_FEEDS}. Individual entries without a `url` are dropped; an
 * invalid `category` is dropped; a missing `category` defaults to `general`.
 */
export function parseFeedsEnv(raw: string | undefined | null): NewsFeed[] | null {
    const trimmed = (raw ?? '').trim();
    if (!trimmed) return null;

    let parsed: unknown;
    try {
        parsed = JSON.parse(trimmed);
    } catch {
        return null;
    }
    if (!Array.isArray(parsed)) return null;

    const feeds: NewsFeed[] = [];
    for (const entry of parsed) {
        if (!entry || typeof entry !== 'object') continue;
        const e = entry as Record<string, unknown>;
        const slug = typeof e.slug === 'string' ? e.slug.trim() : '';
        const url = typeof e.url === 'string' ? e.url.trim() : '';
        if (!slug || !url) continue;
        // Missing category → general; present-but-invalid → drop the entry.
        let defaultCategory: NewsCategory;
        if (e.category === undefined || e.category === null) {
            defaultCategory = 'general';
        } else if (isCategory(e.category)) {
            defaultCategory = e.category;
        } else {
            continue;
        }
        feeds.push({ slug, url, defaultCategory });
    }

    return feeds.length > 0 ? feeds : null;
}

/**
 * Resolve the effective feed list: the `MARKET_NEWS_FEEDS` override when it
 * parses to at least one usable feed, else the curated defaults.
 */
export function resolveNewsFeeds(envValue: string | undefined | null): readonly NewsFeed[] {
    return parseFeedsEnv(envValue) ?? DEFAULT_NEWS_FEEDS;
}
