-- Exchange inquiry dedup: a tenant may inquire on a given listing at most once.
--
-- Defensive de-dup first so the unique index can be created even if repeat
-- inquiries already exist in the wild (keep the earliest per listing+inquirer).
DELETE FROM "ExchangeInquiry" a
USING "ExchangeInquiry" b
WHERE a."listingId" = b."listingId"
  AND a."inquirerTenantId" = b."inquirerTenantId"
  AND (
    a."createdAt" > b."createdAt"
    OR (a."createdAt" = b."createdAt" AND a."id" > b."id")
  );

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeInquiry_listingId_inquirerTenantId_key"
  ON "ExchangeInquiry"("listingId", "inquirerTenantId");
