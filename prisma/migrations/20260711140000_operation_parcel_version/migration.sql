-- Optimistic-lock counter for OperationParcel.
--
-- A field mark queued offline at 09:20 can replay hours later. Idempotency
-- (Idempotency-Key) already stops a replay from DUPLICATING the write, but a
-- bare update still lets the stale queued edit silently overwrite whatever the
-- row became if a supervisor changed the job meanwhile. `version` is captured
-- at enqueue and sent back as `If-Match` on replay; the usecase rejects a
-- write whose expected version no longer matches with 409 STALE_DATA.
--
-- NOT NULL DEFAULT 0 — every existing row starts at version 0; the DEFAULT
-- backfills without a table rewrite of user data.

ALTER TABLE "OperationParcel" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
