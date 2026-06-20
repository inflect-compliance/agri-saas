/**
 * pgvector helpers — the ONLY place raw `vector` / `<=>` SQL is built.
 *
 * `KnowledgeChunk.embedding` is a Prisma `Unsupported("vector(768)")`
 * column (feat/ai-rag): the Prisma client cannot read or write it
 * through the normal API, so all embedding I/O goes through the
 * `Prisma.sql` fragments here and is run via `$executeRaw` / `$queryRaw`
 * in the RAG ingestion + retrieval paths. Mirrors `src/lib/db/geo.ts`
 * (the PostGIS containment pattern).
 */
import { Prisma } from '@prisma/client';

/**
 * Embedding dimensionality — nomic-embed-text emits 768-dim vectors,
 * which is the `vector(768)` column width in the migration. The
 * embedding model (`AI_EMBED_MODEL`) MUST emit this many dimensions or
 * the `::vector` cast in Postgres rejects the literal.
 */
export const EMBED_DIM = 768;

/**
 * Serialize a number[] into a pgvector literal string: `'[0.1,0.2,...]'`.
 * The result is passed as a bound parameter and cast to `::vector` in
 * the SQL fragment (NEVER string-interpolated — keeps it injection-safe).
 *
 * Throws on a wrong-width vector so a model misconfiguration surfaces at
 * the write/query boundary rather than as an opaque Postgres cast error.
 * Non-finite values (NaN / Infinity) are rejected for the same reason.
 */
export function toVectorLiteral(v: number[]): string {
    if (v.length !== EMBED_DIM) {
        throw new Error(
            `Embedding vector has ${v.length} dims, expected ${EMBED_DIM} ` +
                `(the vector(${EMBED_DIM}) column width). Check AI_EMBED_MODEL.`,
        );
    }
    for (const n of v) {
        if (!Number.isFinite(n)) {
            throw new Error('Embedding vector contains a non-finite value (NaN/Infinity).');
        }
    }
    return `[${v.join(',')}]`;
}

/**
 * SQL fragment: cosine DISTANCE between the `embedding` column and a
 * query vector literal — pgvector's `<=>` operator (0 = identical,
 * 2 = opposite). Smaller is closer. Order ASC by this for nearest-
 * neighbour retrieval. The literal is a bound parameter cast to vector.
 */
export function cosineDistanceSql(queryVectorLiteral: string): Prisma.Sql {
    return Prisma.sql`"embedding" <=> ${queryVectorLiteral}::vector`;
}

/**
 * SQL fragment: cosine SIMILARITY (1 - distance), in [-1, 1] where 1 is
 * identical. Convenience for ranking/scoring where a "higher is better"
 * score reads more naturally than a distance.
 */
export function cosineSimilaritySql(queryVectorLiteral: string): Prisma.Sql {
    return Prisma.sql`(1 - ("embedding" <=> ${queryVectorLiteral}::vector))`;
}
