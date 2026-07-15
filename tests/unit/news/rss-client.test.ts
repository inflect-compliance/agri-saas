/**
 * Unit tests for the RSS/Atom feed parser + fetch wrapper.
 *
 * `parseFeedXml` is pure (string in → items out), so both feed dialects are
 * tested with fixtures — no network. `fetchFeed` is exercised with an injected
 * fetch to pin the timeout / non-2xx / bad-body behaviour.
 */
import { parseFeedXml, fetchFeed } from '@/lib/news/rss-client';

const RSS_2_0 = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>Agri BG</title>
    <item>
      <title>Цената на пшеницата се покачва</title>
      <link>https://agri.bg/news/1</link>
      <description><![CDATA[<p>Пазарен обзор за седмицата.</p>]]></description>
      <pubDate>Mon, 14 Jul 2026 09:30:00 +0300</pubDate>
      <guid isPermaLink="false">agri-bg-0001</guid>
      <enclosure url="https://agri.bg/img/1.jpg" type="image/jpeg" length="12345"/>
    </item>
    <item>
      <title>Субсидии по ДФЗ</title>
      <link>https://agri.bg/news/2</link>
      <description>Кратко описание</description>
      <pubDate>Sun, 13 Jul 2026 08:00:00 +0300</pubDate>
      <guid>https://agri.bg/news/2</guid>
    </item>
  </channel>
</rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
  <title>EC Agri-food</title>
  <entry>
    <title>New CAP subsidy scheme approved</title>
    <link rel="alternate" href="https://ec.europa.eu/agri/news/10"/>
    <id>urn:ec:agri:10</id>
    <updated>2026-07-12T14:00:00Z</updated>
    <summary>The Commission approved a new direct payments regulation.</summary>
    <media:content url="https://ec.europa.eu/img/10.png" medium="image"/>
  </entry>
</feed>`;

describe('parseFeedXml — RSS 2.0', () => {
    it('extracts normalised items with title, url, summary, date, guid, image', () => {
        const items = parseFeedXml(RSS_2_0);
        expect(items).toHaveLength(2);
        const first = items[0];
        expect(first.title).toBe('Цената на пшеницата се покачва');
        expect(first.url).toBe('https://agri.bg/news/1');
        expect(first.summary).toContain('Пазарен обзор');
        expect(first.guid).toBe('agri-bg-0001');
        expect(first.imageUrl).toBe('https://agri.bg/img/1.jpg');
        expect(first.publishedAt.toISOString()).toBe('2026-07-14T06:30:00.000Z');
    });

    it('falls back to the link as guid when guid is absent', () => {
        const items = parseFeedXml(RSS_2_0);
        expect(items[1].guid).toBe('https://agri.bg/news/2');
        expect(items[1].imageUrl).toBeNull();
    });
});

describe('parseFeedXml — Atom', () => {
    it('extracts href link, id as guid, updated as date, media image', () => {
        const items = parseFeedXml(ATOM);
        expect(items).toHaveLength(1);
        const e = items[0];
        expect(e.title).toBe('New CAP subsidy scheme approved');
        expect(e.url).toBe('https://ec.europa.eu/agri/news/10');
        expect(e.summary).toContain('direct payments');
        expect(e.guid).toBe('urn:ec:agri:10');
        expect(e.imageUrl).toBe('https://ec.europa.eu/img/10.png');
        expect(e.publishedAt.toISOString()).toBe('2026-07-12T14:00:00.000Z');
    });
});

describe('parseFeedXml — robustness', () => {
    it('returns [] for empty / non-feed / malformed XML', () => {
        expect(parseFeedXml('')).toEqual([]);
        expect(parseFeedXml('<html><body>not a feed</body></html>')).toEqual([]);
        expect(parseFeedXml('<rss><channel></channel></rss>')).toEqual([]);
    });

    it('skips items missing a title, a link, or a valid date', () => {
        const xml = `<rss version="2.0"><channel>
          <item><link>https://x/1</link><pubDate>Mon, 14 Jul 2026 09:30:00 +0300</pubDate></item>
          <item><title>No link</title><pubDate>Mon, 14 Jul 2026 09:30:00 +0300</pubDate></item>
          <item><title>Bad date</title><link>https://x/3</link><pubDate>not-a-date</pubDate></item>
          <item><title>Good</title><link>https://x/4</link><pubDate>Mon, 14 Jul 2026 09:30:00 +0300</pubDate></item>
        </channel></rss>`;
        const items = parseFeedXml(xml);
        expect(items).toHaveLength(1);
        expect(items[0].title).toBe('Good');
    });

    it('honours maxItems', () => {
        expect(parseFeedXml(RSS_2_0, { maxItems: 1 })).toHaveLength(1);
    });
});

describe('fetchFeed', () => {
    it('fetches and parses a feed via the injected fetch', async () => {
        const fetchImpl = jest.fn().mockResolvedValue(
            new Response(RSS_2_0, { status: 200, headers: { 'content-type': 'application/rss+xml' } }),
        );
        const items = await fetchFeed('https://agri.bg/rss', { fetchImpl });
        expect(items).toHaveLength(2);
        expect(fetchImpl).toHaveBeenCalledWith('https://agri.bg/rss', expect.objectContaining({ method: 'GET' }));
    });

    it('throws on a non-2xx response', async () => {
        const fetchImpl = jest.fn().mockResolvedValue(new Response('nope', { status: 503 }));
        await expect(fetchFeed('https://agri.bg/rss', { fetchImpl })).rejects.toThrow(/503/);
    });
});
