-- Offline exactly-once: idempotency key for journal-entry (LogEntry) creation.
--
-- `createLogEntry` minted a brand-new LogEntry on EVERY call. Over a flaky
-- rural-LTE link the offline outbox re-sends a queued journal entry, so the
-- same note could post twice. The client now transmits its outbox-item id as
-- the `Idempotency-Key` header; the usecase dedupes on
-- (tenantId, clientMutationId) and returns the original entry. This unique
-- index is the race-safe DB backstop for a concurrent replay. Mirrors
-- 20260710120000_task_client_mutation_idempotency.
--
-- The column is NULLABLE and Postgres unique indexes are NULLS DISTINCT by
-- default, so ordinary online creates (no key) each store NULL and never
-- collide — only real Idempotency-Key replays are constrained.
--
-- ADD COLUMN is DDL (not a row UPDATE); existing rows get NULL.

ALTER TABLE "LogEntry" ADD COLUMN "clientMutationId" TEXT;

CREATE UNIQUE INDEX "LogEntry_tenantId_clientMutationId_key"
    ON "LogEntry" ("tenantId", "clientMutationId");
