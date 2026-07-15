/**
 * RSS 2.0 / Atom feed client — PURE parse + a thin HTTP wrapper, no DB.
 *
 * `parseFeedXml` turns a feed document into normalised {@link RawNewsItem}s and
 * is side-effect-free (string in → items out), so it unit-tests against fixture
 * XML without a network. `fetchFeed` wraps it with one GET, an AbortController
 * timeout, and a throw on any non-2xx — the same contract as
 * `ec-agrifood-client.ts`. The daily pull job calls `fetchFeed` per feed and is
 * fail-soft, so a single unreachable feed never fails the batch.
 *
 * Both dialects are supported because the sources are mixed: Bulgarian portals
 * ship RSS 2.0 (`rss > channel > item`, RFC-822 `pubDate`) and the EC agri
 * press ships Atom (`feed > entry`, ISO-8601 `updated`). Items missing a title,
 * a link, or a parseable date are dropped rather than persisted as noise.
 *
 * Text fields are returned as-is from the parser (entities decoded); the job
 * runs them through `sanitizePlainText` before persisting — parse here,
 * sanitise at the write boundary.
 *
 * @module lib/news/rss-client
 */
import { XMLParser } from 'fast-xml-parser';

/** One normalised feed item (pre-sanitisation, pre-categorisation). */
export interface RawNewsItem {
    /** Headline text. */
    title: string;
    /** Canonical article URL. */
    url: string;
    /** Short description/summary, or null when the feed omits it. */
    summary: string | null;
    /** Publish time (RSS pubDate / Atom updated|published). */
    publishedAt: Date;
    /** Stable per-item id (guid / atom id), falling back to the link. */
    guid: string;
    /** Lead image (RSS enclosure / media:content), or null. */
    imageUrl: string | null;
}

/** Injectable fetch (defaults to global fetch). */
type FetchFn = typeof fetch;

export interface FetchFeedOptions {
    timeoutMs?: number;
    fetchImpl?: FetchFn;
    /** Cap on items returned from one feed. */
    maxItems?: number;
}

const FETCH_TIMEOUT_MS = 15_000;
/** Default per-feed item cap — a feed's newest slice is plenty for the tab. */
const DEFAULT_MAX_ITEMS = 40;

/** One parser instance — attributes kept so we can read link href / enclosure url. */
const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    // Keep CDATA + entity text intact; do not coerce numeric-looking ids.
    parseTagValue: false,
    trimValues: true,
});

/** Coerce a fast-xml-parser node (string | number | {#text,@_*}) to trimmed text. */
function text(node: unknown): string {
    if (node == null) return '';
    if (typeof node === 'string') return node.trim();
    if (typeof node === 'number') return String(node);
    if (typeof node === 'object') {
        const t = (node as Record<string, unknown>)['#text'];
        if (typeof t === 'string') return t.trim();
        if (typeof t === 'number') return String(t);
    }
    return '';
}

/** Normalise an XML child that may be a single node or an array into an array. */
function asArray<T>(v: T | T[] | undefined): T[] {
    if (v == null) return [];
    return Array.isArray(v) ? v : [v];
}

/** Parse a date string; return null when absent or unparseable. */
function parseDate(raw: string): Date | null {
    const s = raw.trim();
    if (!s) return null;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
}

/** Resolve the best image URL from an RSS/Atom item's enclosure / media:content. */
function imageFrom(item: Record<string, unknown>): string | null {
    const enclosure = asArray(item.enclosure as unknown)[0] as Record<string, unknown> | undefined;
    const encUrl = enclosure?.['@_url'];
    const encType = enclosure?.['@_type'];
    if (typeof encUrl === 'string' && (typeof encType !== 'string' || encType.startsWith('image'))) {
        return encUrl;
    }
    const media = asArray(item['media:content'] as unknown)[0] as Record<string, unknown> | undefined;
    const medUrl = media?.['@_url'];
    if (typeof medUrl === 'string') return medUrl;
    return null;
}

/** Resolve an Atom entry's alternate link href. */
function atomLink(entry: Record<string, unknown>): string {
    const links = asArray(entry.link as unknown);
    // Prefer rel="alternate"; else the first link that carries an href.
    const alt = links.find(
        (l) => typeof l === 'object' && l && (l as Record<string, unknown>)['@_rel'] === 'alternate',
    ) as Record<string, unknown> | undefined;
    const chosen =
        alt ??
        (links.find(
            (l) => typeof l === 'object' && l && typeof (l as Record<string, unknown>)['@_href'] === 'string',
        ) as Record<string, unknown> | undefined);
    const href = chosen?.['@_href'];
    return typeof href === 'string' ? href.trim() : '';
}

function rssItemToRaw(item: Record<string, unknown>): RawNewsItem | null {
    const title = text(item.title);
    const url = text(item.link);
    const publishedAt = parseDate(text(item.pubDate) || text(item['dc:date']));
    if (!title || !url || !publishedAt) return null;
    const summaryRaw = text(item.description);
    const guidRaw = text(item.guid);
    return {
        title,
        url,
        summary: summaryRaw || null,
        publishedAt,
        guid: guidRaw || url,
        imageUrl: imageFrom(item),
    };
}

function atomEntryToRaw(entry: Record<string, unknown>): RawNewsItem | null {
    const title = text(entry.title);
    const url = atomLink(entry);
    const publishedAt = parseDate(text(entry.updated) || text(entry.published));
    if (!title || !url || !publishedAt) return null;
    const summaryRaw = text(entry.summary) || text(entry.content);
    const idRaw = text(entry.id);
    return {
        title,
        url,
        summary: summaryRaw || null,
        publishedAt,
        guid: idRaw || url,
        imageUrl: imageFrom(entry),
    };
}

/**
 * Parse an RSS 2.0 or Atom document into normalised items. Returns `[]` for
 * empty, non-feed, or malformed input (never throws). `maxItems` caps the
 * result (newest-first order is preserved as the feed presents it).
 */
export function parseFeedXml(xml: string, opts: { maxItems?: number } = {}): RawNewsItem[] {
    const max = opts.maxItems ?? DEFAULT_MAX_ITEMS;
    if (!xml || !xml.trim()) return [];

    let doc: Record<string, unknown>;
    try {
        doc = parser.parse(xml) as Record<string, unknown>;
    } catch {
        return [];
    }

    const items: RawNewsItem[] = [];

    // RSS 2.0
    const rss = doc.rss as Record<string, unknown> | undefined;
    const channel = rss?.channel as Record<string, unknown> | undefined;
    if (channel) {
        for (const raw of asArray(channel.item as unknown)) {
            if (typeof raw !== 'object' || !raw) continue;
            const it = rssItemToRaw(raw as Record<string, unknown>);
            if (it) items.push(it);
            if (items.length >= max) return items;
        }
    }

    // Atom
    const feed = doc.feed as Record<string, unknown> | undefined;
    if (feed) {
        for (const raw of asArray(feed.entry as unknown)) {
            if (typeof raw !== 'object' || !raw) continue;
            const it = atomEntryToRaw(raw as Record<string, unknown>);
            if (it) items.push(it);
            if (items.length >= max) return items;
        }
    }

    return items;
}

/**
 * Fetch one feed URL and parse it. One GET, an AbortController timeout, a throw
 * on any non-2xx (the caller — the pull job — catches per feed so one dead feed
 * never fails the batch).
 */
export async function fetchFeed(url: string, opts: FetchFeedOptions = {}): Promise<RawNewsItem[]> {
    const doFetch = opts.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? FETCH_TIMEOUT_MS);
    let response: Response;
    try {
        response = await doFetch(url, {
            method: 'GET',
            headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timer);
    }
    if (!response.ok) {
        throw new Error(`news feed error ${response.status} for ${url}`);
    }
    const body = await response.text();
    return parseFeedXml(body, { maxItems: opts.maxItems });
}
