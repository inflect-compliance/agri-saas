#!/usr/bin/env tsx
/**
 * Ingest the GLOBAL RAG catalog (feat/ai-rag).
 *
 * Writes the licensed sample corpus (KCC / FAIR-Forward QA / EU 2018/848 /
 * USDA 7 CFR 205) as GLOBAL KnowledgeChunks (tenantId NULL) WITH
 * embeddings. GLOBAL rows are readable by every tenant via the asymmetric
 * RLS policy; they can only be WRITTEN off the app_user path, so this
 * script uses the default (superuser-bypassed) Prisma client.
 *
 * LICENCE GATING is enforced in scripts/rag/corpus.ts —
 * `assertLicensedSource()` refuses any non-allowlisted source and
 * hard-refuses GlobalG.A.P. (proprietary; cite-only). See
 * THIRD_PARTY_NOTICES.md.
 *
 * Idempotent on (source, sourceRef). Mirrors scripts/import-knowledge.ts
 * (PrismaPg adapter + force-exit main()).
 *
 * Usage:
 *   tsx scripts/rag/ingest-corpus.ts        # ingest the sample corpus
 *   npm run rag:ingest
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { ingestGlobalCorpus, SAMPLE_GLOBAL_CORPUS } from './corpus';

async function main(): Promise<number> {
    const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
    const prisma = new PrismaClient({ adapter });
    try {
        const res = await ingestGlobalCorpus(prisma, SAMPLE_GLOBAL_CORPUS);
        console.log(
            `RAG GLOBAL corpus: ${res.created} chunk(s) created, ` +
                `${res.skipped} already present.`,
        );
        return 0;
    } finally {
        await prisma.$disconnect();
    }
}

if (require.main === module) {
    main().then((code) => process.exit(code)).catch((err) => {
        console.error('RAG corpus ingestion failed:', err);
        process.exit(1);
    });
}
