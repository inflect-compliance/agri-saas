-- Audit S2 — Control Framework & Testing (2026-05-24)
--
-- Add `ARCHIVED` value to the `TestPlanStatus` enum. The terminal
-- state is what the lifecycle was missing — over time stale plans
-- accumulated on PAUSED with no clean retirement path. `createTestRun`
-- (which gates on `status === 'ACTIVE'`) rejects ARCHIVED runs
-- automatically; no separate guard needed.

ALTER TYPE "TestPlanStatus" ADD VALUE IF NOT EXISTS 'ARCHIVED';
