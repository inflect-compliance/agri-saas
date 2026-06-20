/**
 * RAG retrieval (feat/ai-rag) — HYBRID keyword + vector search over
 * KnowledgeChunk.
 *
 * Two branches, merged + deduped + ranked:
 *   (a) KEYWORD — Prisma `text: { contains: query, mode: 'insensitive' }`,
 *       scoped to the tenant (and optionally the GLOBAL catalog).
 *   (b) VECTOR  — embed the query, then a raw `$queryRaw` cosine-distance
 *       nearest-neighbour scan (`embedding <=> ${literal}::vector`).
 *
 * Tenant isolation: the whole call runs inside `runInTenantContext`, so
 * RLS scopes every read. We ALSO filter `tenantId` in the app query
 * (defence-in-depth + satisfies the query-shape / tenant-isolation
 * structural guards). `includeGlobal` widens the read to the NULL-tenant
 * GLOBAL catalog, which RLS permits for every tenant.
 *
 * Prisma `in` cannot carry NULL, so the GLOBAL-or-own filter is an OR:
 *   { OR: [{ tenantId: ctx.tenantId }, { tenantId: null }] }
 */
import { Prisma } from '@prisma/client';
import { getAiProvider } from '@/app-layer/ai/provider';
import { runInTenantContext } from '@/lib/db-context';
import { toVectorLiteral } from '@/lib/db/embeddings';
import { getCachedEmbedding, setCachedEmbedding } from '@/lib/cache/ai-cache';
import { env } from '@/env';
import type { RequestContext } from '@/app-layer/types';
import type { KnowledgeChunkSourceType } from '@prisma/client';

export interface RetrieveOptions {
    query: string;
    /** Include the GLOBAL (tenantId NULL) licensed catalog. Default true. */
    includeGlobal?: boolean;
    /** Max chunks to return after merge + rank. Default 6. */
    topK?: number;
}

export interface RetrievedChunk {
    id: string;
    source: string;
    sourceType: KnowledgeChunkSourceType;
    text: string;
    /** Higher is better. Vector hits carry cosine similarity; keyword-only
     *  hits get a small fixed floor so a strong lexical match still ranks. */
    score: number;
}

const DEFAULT_TOP_K = 6;
/** Score floor for a keyword-only hit (no vector similarity available). */
const KEYWORD_SCORE = 0.2;

/**
 * Hybrid retrieve. Returns the top-K merged chunks, ranked by score
 * (vector similarity, with keyword-only hits floored). Bounded `take`
 * on both branches.
 */
export async function retrieve(
    ctx: RequestContext,
    opts: RetrieveOptions,
): Promise<RetrievedChunk[]> {
    const query = opts.query.trim();
    if (query.length === 0) return [];

    const includeGlobal = opts.includeGlobal !== false;
    const topK = Math.max(1, Math.min(opts.topK ?? DEFAULT_TOP_K, 50));
    // Fetch a wider candidate set per branch so the merge has material
    // to rank, then trim to topK.
    const branchTake = topK * 2;

    // Embed the query up front (one call) for the vector branch. Repeated
    // identical queries are served from the Redis embedding cache (long
    // TTL — embeddings are deterministic). Graceful when Redis is absent.
    const embedModel = env.AI_EMBED_MODEL;
    let queryVector = await getCachedEmbedding(embedModel, query);
    if (!queryVector) {
        const [embedding] = await getAiProvider().embed({ texts: [query] });
        queryVector = embedding.vector;
        await setCachedEmbedding(embedModel, query, queryVector);
    }
    const queryLiteral = toVectorLiteral(queryVector);

    return runInTenantContext(ctx, async (db) => {
        // ── (a) Keyword branch ──
        // Defence-in-depth tenant filter (RLS already scopes; we restate it).
        const tenantFilter = includeGlobal
            ? { OR: [{ tenantId: ctx.tenantId }, { tenantId: null }] }
            : { tenantId: ctx.tenantId };

        const keywordHits = await db.knowledgeChunk.findMany({
            where: {
                ...tenantFilter,
                text: { contains: query, mode: 'insensitive' },
            },
            select: { id: true, source: true, sourceType: true, text: true },
            take: branchTake,
        });

        // ── (b) Vector branch ──
        // Raw cosine-distance NN scan — the `embedding` column is
        // Unsupported in Prisma so it can only be queried via raw SQL.
        // The tenant filter is inlined for defence-in-depth + index use.
        const tenantSql = includeGlobal
            ? Prisma.sql`("tenantId" = ${ctx.tenantId} OR "tenantId" IS NULL)`
            : Prisma.sql`"tenantId" = ${ctx.tenantId}`;

        const vectorHits = await db.$queryRaw<
            Array<{
                id: string;
                source: string;
                sourceType: KnowledgeChunkSourceType;
                text: string;
                similarity: number;
            }>
        >(Prisma.sql`
            SELECT "id", "source", "sourceType", "text",
                   (1 - ("embedding" <=> ${queryLiteral}::vector)) AS "similarity"
            FROM "KnowledgeChunk"
            WHERE ${tenantSql}
              AND "embedding" IS NOT NULL
            ORDER BY "embedding" <=> ${queryLiteral}::vector ASC
            LIMIT ${branchTake}
        `);

        // ── Merge + dedupe by id + rank ──
        const byId = new Map<string, RetrievedChunk>();
        for (const v of vectorHits) {
            byId.set(v.id, {
                id: v.id,
                source: v.source,
                sourceType: v.sourceType,
                text: v.text,
                score: Number(v.similarity),
            });
        }
        for (const k of keywordHits) {
            const existing = byId.get(k.id);
            if (existing) {
                // Already a vector hit — keyword corroboration bumps it.
                existing.score += KEYWORD_SCORE;
            } else {
                byId.set(k.id, {
                    id: k.id,
                    source: k.source,
                    sourceType: k.sourceType,
                    text: k.text,
                    score: KEYWORD_SCORE,
                });
            }
        }

        return [...byId.values()]
            .sort((a, b) => b.score - a.score)
            .slice(0, topK);
    });
}
