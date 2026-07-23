-- Give CropVariety the GDD parameters the plan board needs to show a real
-- maturity %: a per-crop base temperature and an accumulated-GDD-to-maturity
-- target. Both nullable — a variety without them falls back to the 10°C
-- conventional base and shows raw accumulated GDD only (no maturity %).
-- Modelled agronomic norms seeded by scripts/import-crop-varieties.ts.
ALTER TABLE "CropVariety" ADD COLUMN "gddBaseC" DECIMAL(4,1);
ALTER TABLE "CropVariety" ADD COLUMN "gddToMaturity" INTEGER;
