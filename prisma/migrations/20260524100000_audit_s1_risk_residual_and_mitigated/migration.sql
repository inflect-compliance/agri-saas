-- Audit S1 — Risk Lifecycle & Treatment Plans (2026-05-24)
--
-- Two schema changes to address the audit's S1 gaps:
--
-- 1. Add `MITIGATED` value to the `RiskStatus` enum. The MITIGATE
--    treatment-strategy completion no longer collapses into CLOSED;
--    the residual-risk-reduced state is now distinct (ISO 27001
--    Annex A residual-risk reporting expectation).
--
-- 2. Add `residualScore` (Int, nullable) and `residualScoreSetAt`
--    (TIMESTAMP, nullable) to the `Risk` model. NULL until the
--    first treatment plan completes; thereafter reflects the
--    strategy-specific reduction (see `completePlan` in
--    risk-treatment-plan.ts).

-- 1. RiskStatus enum — add MITIGATED.
ALTER TYPE "RiskStatus" ADD VALUE IF NOT EXISTS 'MITIGATED' BEFORE 'ACCEPTED';

-- 2. Risk model — residualScore + residualScoreSetAt.
ALTER TABLE "Risk"
  ADD COLUMN IF NOT EXISTS "residualScore" INTEGER,
  ADD COLUMN IF NOT EXISTS "residualScoreSetAt" TIMESTAMP(3);
