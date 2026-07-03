-- CreateEnum
CREATE TYPE "ExchangeSide" AS ENUM ('SELL', 'BUY');

-- CreateEnum
CREATE TYPE "ExchangeListingStatus" AS ENUM ('ACTIVE', 'FULFILLED', 'WITHDRAWN', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ExchangeInquiryStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

-- AlterEnum
ALTER TYPE "ModuleKey" ADD VALUE 'EXCHANGE';

-- CreateTable
CREATE TABLE "ExchangeListing" (
    "id" TEXT NOT NULL,
    "sellerTenantId" TEXT NOT NULL,
    "sellerUserId" TEXT NOT NULL,
    "side" "ExchangeSide" NOT NULL,
    "commodity" TEXT NOT NULL,
    "quantityTonnes" DECIMAL(14,3) NOT NULL,
    "pricePerTonne" DECIMAL(12,2),
    "priceCurrency" TEXT NOT NULL DEFAULT 'BGN',
    "regionCode" TEXT NOT NULL,
    "regionName" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "description" TEXT,
    "sellerDisplayName" TEXT,
    "status" "ExchangeListingStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExchangeListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeInquiry" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "inquirerTenantId" TEXT NOT NULL,
    "inquirerUserId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "quantityTonnes" DECIMAL(14,3),
    "status" "ExchangeInquiryStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeInquiry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExchangeListing_sellerTenantId_idx" ON "ExchangeListing"("sellerTenantId");

-- CreateIndex
CREATE INDEX "ExchangeListing_side_status_idx" ON "ExchangeListing"("side", "status");

-- CreateIndex
CREATE INDEX "ExchangeListing_regionCode_idx" ON "ExchangeListing"("regionCode");

-- CreateIndex
CREATE INDEX "ExchangeListing_status_expiresAt_idx" ON "ExchangeListing"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "ExchangeInquiry_listingId_idx" ON "ExchangeInquiry"("listingId");

-- CreateIndex
CREATE INDEX "ExchangeInquiry_inquirerTenantId_idx" ON "ExchangeInquiry"("inquirerTenantId");

-- AddForeignKey
ALTER TABLE "ExchangeInquiry" ADD CONSTRAINT "ExchangeInquiry_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "ExchangeListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

