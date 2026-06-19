-- ═══════════════════════════════════════════════════════════════════
--  feat/ai-rag — pgvector + KnowledgeChunk (RAG retrieval store)
-- ═══════════════════════════════════════════════════════════════════
--
--  Adds the retrieval-augmented-generation chunk store that grounds the
--  general LLM in agricultural knowledge. Hand-authored (like the
--  PostGIS spray-map migration) because Prisma's generated SQL cannot
--  emit the `vector(768)` column type or the ivfflat index — the
--  `embedding` column is an `Unsupported(...)` in the Prisma schema.
--
--  Structure mirrors the PostGIS feature-1 migration:
--    1. CREATE EXTENSION (vector, like postgis).
--    2. CREATE TYPE for the new enum.
--    3. CREATE TABLE with the raw vector column hand-written.
--    4. The Prisma @@index + a vector ivfflat cosine index.
--    5. FKs.
--    6. The RLS block — single asymmetric policy because tenantId is
--       NULLABLE (NULL = GLOBAL licensed catalog). Mirrors the Epic D.1
--       UserSession migration: USING (NULL OR own) WITH CHECK (own). A
--       split tenant_isolation_insert policy would be a permissive
--       sibling that lets app_user UPDATE a NULL row to a foreign tenant.
--
--  Idempotent on the extension + policies; safe to re-run.
-- ═══════════════════════════════════════════════════════════════════

-- ─── pgvector (required before any vector column) ───
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "KnowledgeChunkSourceType" AS ENUM ('KB', 'JOURNAL', 'CROP_PLAN', 'LABEL', 'EXTERNAL');

-- CreateTable
--   `embedding vector(768)` is hand-written — Prisma's generated SQL
--   would emit it wrong because the model declares it Unsupported(...).
CREATE TABLE "KnowledgeChunk" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "articleId" TEXT,
    "source" TEXT NOT NULL,
    "sourceType" "KnowledgeChunkSourceType" NOT NULL,
    "sourceRef" TEXT,
    "text" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL DEFAULT 0,
    "embedding" vector(768),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (Layer A — tenantId-leading; also covers the articleId FK)
CREATE INDEX "KnowledgeChunk_tenantId_articleId_idx" ON "KnowledgeChunk"("tenantId", "articleId");

-- CreateIndex (vector — ivfflat with cosine ops for ANN retrieval)
CREATE INDEX "KnowledgeChunk_embedding_ivfflat" ON "KnowledgeChunk" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);

-- AddForeignKey
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "KnowledgeArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════
--  Row-Level Security — single asymmetric policy (nullable tenantId).
--
--  tenantId NULL  → GLOBAL licensed catalog, readable by every tenant.
--  tenantId set   → tenant-private, read + write only by its tenant.
--
--  WHY the single-policy form (USING + WITH CHECK on ONE policy):
--    tenantId is nullable. A split `tenant_isolation_insert` FOR INSERT
--    WITH CHECK would be a PERMISSIVE sibling; Postgres OR's permissive
--    policies and a permissive policy without WITH CHECK implicitly
--    grants WITH CHECK(true) on UPDATE — so app_user could UPDATE a
--    NULL-tenant GLOBAL row to ANY tenantId. Combining the asymmetric
--    USING (NULL OR own) with the strict WITH CHECK (own) on a single
--    policy closes that leak. Same shape proven on UserSession +
--    IntegrationWebhookEvent. superuser_bypass permits the ingestion
--    script (runs as postgres) to mint NULL-tenant GLOBAL rows.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE "KnowledgeChunk" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KnowledgeChunk" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "KnowledgeChunk";
CREATE POLICY tenant_isolation ON "KnowledgeChunk"
    USING ("tenantId" IS NULL OR "tenantId" = current_setting('app.tenant_id', true)::text)
    WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
DROP POLICY IF EXISTS superuser_bypass ON "KnowledgeChunk";
CREATE POLICY superuser_bypass ON "KnowledgeChunk"
    USING (current_setting('role') != 'app_user');
