-- GLOBAL agriculture-events catalogue (#15). NO tenantId (like "Unit") → not
-- tenant-scoped, no RLS: every tenant reads the same shared list.
CREATE TABLE "AgriEvent" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'fair',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "place" TEXT,
    "url" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgriEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgriEvent_startsAt_idx" ON "AgriEvent"("startsAt");
