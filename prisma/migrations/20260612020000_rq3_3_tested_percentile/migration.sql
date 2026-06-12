-- RQ3-3 — which simulated portfolio percentile the appetite ceiling is
-- tested at (board-level policy, default P80).
ALTER TABLE "RiskAppetiteConfig" ADD COLUMN "testedPercentile" INTEGER NOT NULL DEFAULT 80;
