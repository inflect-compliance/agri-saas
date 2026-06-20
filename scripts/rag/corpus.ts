/**
 * RAG corpus — licence gating + the GLOBAL sample corpus (feat/ai-rag).
 *
 * ════════════════════════════════════════════════════════════════════
 *  LICENCE GATING (CRITICAL — read before adding any corpus)
 * ════════════════════════════════════════════════════════════════════
 *
 *  RAG ingests third-party agricultural knowledge into the GLOBAL
 *  catalog. Only PERMISSIVELY-licensed corpora may be ingested as TEXT.
 *  The `LICENSED_SOURCES` allowlist below is the single source of truth;
 *  `assertLicensedSource()` REFUSES any source not on it.
 *
 *  HARD PROHIBITION — GlobalG.A.P.: GlobalG.A.P. standards, checklists,
 *  and control points are PROPRIETARY / COPYRIGHTED. They are CITE-ONLY:
 *  the product may reference that a requirement exists and point the user
 *  to the official document, but it MUST NEVER ingest GlobalG.A.P. text
 *  into a chunk. `assertLicensedSource()` hard-refuses anything matching
 *  /globalg\.?a\.?p/i regardless of the allowlist. See THIRD_PARTY_NOTICES.md.
 *
 *  Each ingested chunk records its `source` (provenance + licence), so
 *  every retrieved answer can be traced back to a licensed origin.
 * ════════════════════════════════════════════════════════════════════
 */
import type { PrismaClient } from '@prisma/client';
import { getAiProvider } from '../../src/app-layer/ai/provider';
import { toVectorLiteral } from '../../src/lib/db/embeddings';

/**
 * The ONLY corpora permitted for TEXT ingestion. Each value is the exact
 * provenance+licence label stamped onto every chunk's `source`. Add a
 * corpus here ONLY after confirming its licence permits redistribution
 * of the text AND adding a matching entry to THIRD_PARTY_NOTICES.md.
 */
export const LICENSED_SOURCES = [
    'KCC (GODL)',
    'FAIR-Forward / Digital Green QA',
    'EU 2018/848',
    'USDA 7 CFR 205',
] as const;

export type LicensedSource = (typeof LICENSED_SOURCES)[number];

const LICENSED_SET: ReadonlySet<string> = new Set(LICENSED_SOURCES);

/** Proprietary / cite-only — NEVER ingested as text. */
const PROHIBITED_PATTERN = /globalg\.?\s*a\.?\s*p/i;

/**
 * Refuse any source that is not on the allowlist, and HARD-refuse
 * anything matching GlobalG.A.P. (proprietary; cite-only). Throws with a
 * clear message — the ingest path calls this before writing any chunk.
 */
export function assertLicensedSource(source: string): void {
    if (PROHIBITED_PATTERN.test(source)) {
        throw new Error(
            `REFUSED: "${source}" matches GlobalG.A.P., which is PROPRIETARY / ` +
                `copyrighted and CITE-ONLY. Never ingest GlobalG.A.P. text into a ` +
                `RAG chunk — reference the official document instead. See ` +
                `THIRD_PARTY_NOTICES.md.`,
        );
    }
    if (!LICENSED_SET.has(source)) {
        throw new Error(
            `REFUSED: "${source}" is not on the licensed-corpus allowlist ` +
                `(${LICENSED_SOURCES.join(', ')}). Only permissively-licensed ` +
                `corpora may be ingested. Add it to LICENSED_SOURCES in ` +
                `scripts/rag/corpus.ts AND THIRD_PARTY_NOTICES.md only after ` +
                `confirming the licence permits text redistribution.`,
        );
    }
}

/** One sample passage from a licensed corpus. */
export interface CorpusEntry {
    source: LicensedSource;
    /** Stable external doc/QA id for provenance (the chunk's sourceRef). */
    sourceRef: string;
    text: string;
}

/**
 * A SMALL sample GLOBAL corpus — a few public-domain / open-licence
 * Q&A snippets per allowed source, clearly attributed. Intentionally
 * tiny: this seeds retrieval end-to-end; production ingestion points at
 * the real corpora. NO GlobalG.A.P. content — it is cite-only.
 */
export const SAMPLE_GLOBAL_CORPUS: CorpusEntry[] = [
    // ─── KCC — Kisan Call Centre transcripts, Govt. Open Data Licence India ───
    {
        source: 'KCC (GODL)',
        sourceRef: 'kcc-tomato-blight',
        text:
            'For late blight on tomato, remove and destroy affected leaves early, ' +
            'avoid overhead irrigation that wets foliage, ensure good spacing for air ' +
            'circulation, and apply an approved copper-based or mancozeb fungicide on ' +
            'a preventive schedule before symptoms spread. Source: Kisan Call Centre.',
    },
    {
        source: 'KCC (GODL)',
        sourceRef: 'kcc-paddy-nitrogen',
        text:
            'Apply nitrogen to paddy (rice) in split doses — typically one-third at ' +
            'transplanting/basal, one-third at active tillering, and one-third at ' +
            'panicle initiation — to reduce losses and improve use efficiency. ' +
            'Source: Kisan Call Centre.',
    },
    // ─── FAIR-Forward / Digital Green — open agri-advisory Q&A ───
    {
        source: 'FAIR-Forward / Digital Green QA',
        sourceRef: 'ff-maize-fall-armyworm',
        text:
            'To manage fall armyworm in maize, scout fields twice weekly, look for ' +
            'window-pane leaf damage and frass in the whorl, hand-pick egg masses where ' +
            'feasible, and apply recommended biopesticides such as Bt or neem-based ' +
            'products targeting young larvae in the whorl. Source: Digital Green / FAIR Forward.',
    },
    {
        source: 'FAIR-Forward / Digital Green QA',
        sourceRef: 'ff-compost-basics',
        text:
            'Good compost needs a balance of carbon-rich "brown" material (dry leaves, ' +
            'straw) and nitrogen-rich "green" material (fresh crop residue, manure), ' +
            'kept moist and turned periodically for aeration; it is ready when dark, ' +
            'crumbly, and earthy-smelling. Source: Digital Green / FAIR Forward.',
    },
    // ─── EU Regulation 2018/848 — organic production (EU OJ, reusable) ───
    {
        source: 'EU 2018/848',
        sourceRef: 'eu-2018-848-conversion',
        text:
            'Under EU organic Regulation 2018/848, land must undergo a conversion period ' +
            'before its produce may be marketed as organic — generally two years before ' +
            'sowing for annual crops, and three years before harvest for perennials. ' +
            'Source: Regulation (EU) 2018/848.',
    },
    {
        source: 'EU 2018/848',
        sourceRef: 'eu-2018-848-gmo',
        text:
            'EU organic Regulation 2018/848 prohibits the use of GMOs and products ' +
            'produced from or by GMOs in organic production, except for veterinary ' +
            'medicinal products. Source: Regulation (EU) 2018/848.',
    },
    // ─── USDA 7 CFR 205 — National Organic Program (US Govt., public domain) ───
    {
        source: 'USDA 7 CFR 205',
        sourceRef: 'usda-7cfr205-buffer',
        text:
            'The USDA National Organic Program (7 CFR Part 205) requires a buffer zone ' +
            'or other physical barrier to prevent unintended contact of organic land or ' +
            'crops with prohibited substances applied to adjacent non-organic land. ' +
            'Source: 7 CFR 205.',
    },
    {
        source: 'USDA 7 CFR 205',
        sourceRef: 'usda-7cfr205-records',
        text:
            'Certified organic operations under 7 CFR Part 205 must keep records ' +
            'sufficient to demonstrate compliance and to trace product back to the ' +
            'field, retained for at least five years. Source: 7 CFR 205.',
    },
];

/**
 * Write one batch of GLOBAL (tenantId NULL) chunks WITH embeddings.
 *
 * Runs via the supplied raw PrismaClient (the ingestion scripts use the
 * superuser-bypassed global client, since NULL-tenant rows can only be
 * written off the app_user path). Each entry is licence-checked, inserted
 * via Prisma (the non-vector columns), then its embedding is written via
 * raw `$executeRaw` (the Unsupported vector column). Embeds in one batch.
 *
 * Idempotent on (source, sourceRef): existing GLOBAL chunks are skipped.
 */
export async function ingestGlobalCorpus(
    prisma: PrismaClient,
    entries: CorpusEntry[],
): Promise<{ created: number; skipped: number }> {
    for (const e of entries) assertLicensedSource(e.source);

    // Skip already-present GLOBAL chunks (idempotent re-run).
    const refs = entries.map((e) => e.sourceRef);
    const existing = await prisma.knowledgeChunk.findMany({
        where: { tenantId: null, sourceRef: { in: refs } },
        select: { source: true, sourceRef: true },
    });
    const seen = new Set(existing.map((x) => `${x.source}::${x.sourceRef}`));
    const todo = entries.filter((e) => !seen.has(`${e.source}::${e.sourceRef}`));
    if (todo.length === 0) return { created: 0, skipped: entries.length };

    const embeddings = await getAiProvider().embed({ texts: todo.map((e) => e.text) });

    let created = 0;
    for (let i = 0; i < todo.length; i++) {
        const e = todo[i];
        const row = await prisma.knowledgeChunk.create({
            data: {
                tenantId: null,
                source: e.source,
                sourceType: 'EXTERNAL',
                sourceRef: e.sourceRef,
                text: e.text,
                chunkIndex: 0,
            },
            select: { id: true },
        });
        const literal = toVectorLiteral(embeddings[i].vector);
        await prisma.$executeRaw`
            UPDATE "KnowledgeChunk"
            SET "embedding" = ${literal}::vector
            WHERE "id" = ${row.id}
        `;
        created++;
    }
    return { created, skipped: entries.length - todo.length };
}
