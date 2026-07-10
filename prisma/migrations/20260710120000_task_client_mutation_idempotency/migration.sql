-- Offline exactly-once: idempotency key for FIELD_OPERATION task creation.
--
-- `createFieldOperation` used to mint a brand-new Task on EVERY call. Over a
-- flaky rural-LTE link the offline outbox re-sends a queued spray job, so the
-- same operation could post two Tasks (two TSK-N keys, two prescription sets).
-- The client now transmits its outbox-item id as the `Idempotency-Key` header;
-- the usecase dedupes on (tenantId, clientMutationId) and returns the original
-- task. This unique index is the race-safe DB backstop for a concurrent replay.
--
-- The column is NULLABLE and Postgres unique indexes are NULLS DISTINCT by
-- default, so ordinary online creates (no key) each store NULL and never
-- collide — only real Idempotency-Key replays are constrained.
--
-- ADD COLUMN is DDL (not a row UPDATE); existing rows get NULL.

ALTER TABLE "Task" ADD COLUMN "clientMutationId" TEXT;

CREATE UNIQUE INDEX "Task_tenantId_clientMutationId_key"
    ON "Task" ("tenantId", "clientMutationId");
