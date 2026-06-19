/**
 * RAG hybrid retrieve (feat/ai-rag) — merge / dedupe / rank.
 *
 * Fully mocked: the AiProvider.embed() returns a fixed query vector, and
 * the db is a fake where the keyword branch (knowledgeChunk.findMany) and
 * the vector branch ($queryRaw) return canned hits. Asserts:
 *   - vector + keyword hits merge, deduping by id
 *   - a chunk that hits BOTH branches gets a corroboration score bump
 *   - results are ranked by score desc and trimmed to topK
 *   - includeGlobal toggles the NULL-tenant OR filter
 *   - an empty query short-circuits
 */
const mockEmbed = jest.fn();
jest.mock('@/app-layer/ai/provider', () => ({
    getAiProvider: () => ({ embed: mockEmbed }),
}));

// runInTenantContext(ctx, cb) just calls cb with our fake db.
let fakeDb: {
    knowledgeChunk: { findMany: jest.Mock };
    $queryRaw: jest.Mock;
};
jest.mock('@/lib/db-context', () => ({
    runInTenantContext: (_ctx: unknown, cb: (db: unknown) => unknown) => cb(fakeDb),
}));

// Embeddings helper — avoid the 768-dim width check in the unit test.
jest.mock('@/lib/db/embeddings', () => ({
    toVectorLiteral: (v: number[]) => `[${v.join(',')}]`,
    EMBED_DIM: 768,
}));

import { retrieve } from '@/app-layer/ai/rag/retrieve';
import { makeRequestContext } from '../helpers/make-context';

beforeEach(() => {
    mockEmbed.mockReset();
    mockEmbed.mockResolvedValue([{ text: 'q', vector: [0.1, 0.2] }]);
    fakeDb = {
        knowledgeChunk: { findMany: jest.fn().mockResolvedValue([]) },
        $queryRaw: jest.fn().mockResolvedValue([]),
    };
});

const ctx = makeRequestContext('READER', { tenantId: 'tenant-1' });

describe('retrieve — hybrid merge', () => {
    it('returns [] (and does not embed) for an empty query', async () => {
        const out = await retrieve(ctx, { query: '   ' });
        expect(out).toEqual([]);
        expect(mockEmbed).not.toHaveBeenCalled();
    });

    it('merges vector + keyword hits and dedupes by id', async () => {
        fakeDb.$queryRaw.mockResolvedValueOnce([
            { id: 'v1', source: 'KCC (GODL)', sourceType: 'EXTERNAL', text: 'vector hit', similarity: 0.8 },
        ]);
        fakeDb.knowledgeChunk.findMany.mockResolvedValueOnce([
            { id: 'k1', source: 'Field journal', sourceType: 'JOURNAL', text: 'keyword hit' },
        ]);

        const out = await retrieve(ctx, { query: 'blight', topK: 10 });

        const ids = out.map((c) => c.id).sort();
        expect(ids).toEqual(['k1', 'v1']);
        // Vector hit outranks the keyword-only floor.
        expect(out[0].id).toBe('v1');
    });

    it('bumps the score of a chunk that hits BOTH branches', async () => {
        fakeDb.$queryRaw.mockResolvedValueOnce([
            { id: 'dup', source: 'KCC (GODL)', sourceType: 'EXTERNAL', text: 'both', similarity: 0.5 },
        ]);
        fakeDb.knowledgeChunk.findMany.mockResolvedValueOnce([
            { id: 'dup', source: 'KCC (GODL)', sourceType: 'EXTERNAL', text: 'both' },
        ]);

        const out = await retrieve(ctx, { query: 'both', topK: 10 });
        expect(out).toHaveLength(1);
        // 0.5 (vector) + 0.2 (keyword corroboration floor) = 0.7.
        expect(out[0].score).toBeCloseTo(0.7, 5);
    });

    it('ranks by score desc and trims to topK', async () => {
        fakeDb.$queryRaw.mockResolvedValueOnce([
            { id: 'a', source: 's', sourceType: 'EXTERNAL', text: 'a', similarity: 0.9 },
            { id: 'b', source: 's', sourceType: 'EXTERNAL', text: 'b', similarity: 0.7 },
            { id: 'c', source: 's', sourceType: 'EXTERNAL', text: 'c', similarity: 0.3 },
        ]);
        const out = await retrieve(ctx, { query: 'x', topK: 2 });
        expect(out.map((c) => c.id)).toEqual(['a', 'b']);
    });

    it('keyword branch filters tenant + global OR when includeGlobal (default)', async () => {
        await retrieve(ctx, { query: 'x' });
        const where = fakeDb.knowledgeChunk.findMany.mock.calls[0][0].where;
        expect(where.OR).toEqual([{ tenantId: 'tenant-1' }, { tenantId: null }]);
    });

    it('keyword branch filters tenant only when includeGlobal=false', async () => {
        await retrieve(ctx, { query: 'x', includeGlobal: false });
        const where = fakeDb.knowledgeChunk.findMany.mock.calls[0][0].where;
        expect(where.tenantId).toBe('tenant-1');
        expect(where.OR).toBeUndefined();
    });
});
