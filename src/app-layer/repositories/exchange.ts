import { PrismaTx } from '@/lib/db-context';
import {
    Prisma,
    ExchangeSide,
    ExchangeListingStatus,
} from '@prisma/client';

/**
 * Exchange repository — all Prisma queries for the cross-tenant marketplace.
 *
 * CRITICAL: unlike every other repository in this codebase, these reads are
 * GLOBAL — they DELIBERATELY do NOT filter by `tenantId`. The Exchange's
 * whole purpose is that tenants read each other's offers, so
 * `ExchangeListing` / `ExchangeInquiry` are global tables (no `tenantId`
 * column, no RLS — see prisma/schema/exchange.prisma). Cross-tenant WRITE
 * safety is therefore enforced ONE layer up, in
 * `src/app-layer/usecases/exchange.ts` (every mutation asserts
 * `ctx.tenantId === listing.sellerTenantId`) — never here.
 *
 * These methods take `db` + explicit params (NOT a `RequestContext`) exactly
 * because there is no tenant axis to scope by; the caller-tenant filters on
 * the inquiry lists are ordinary "my rows" views, not isolation.
 */

/** Bounded read cap (query-shape guardrail D2 forbids unbounded findMany). */
const LIST_TAKE = 100;

export interface ListingFilters {
    side?: ExchangeSide;
    commodity?: string;
    regionCode?: string;
    minTonnes?: number;
    maxTonnes?: number;
}

export class ExchangeRepository {
    /**
     * GLOBAL browse of ACTIVE, not-yet-expired listings across ALL tenants,
     * newest first. Optional facet filters. Bounded to LIST_TAKE.
     */
    static async listActiveListings(db: PrismaTx, filters: ListingFilters = {}) {
        const where: Prisma.ExchangeListingWhereInput = {
            status: ExchangeListingStatus.ACTIVE,
            // An ACTIVE row past its expiry is stale — hide it until the
            // sweep flips it to EXPIRED.
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        };
        if (filters.side) where.side = filters.side;
        if (filters.commodity) {
            where.commodity = { contains: filters.commodity, mode: 'insensitive' };
        }
        if (filters.regionCode) where.regionCode = filters.regionCode;
        if (filters.minTonnes != null || filters.maxTonnes != null) {
            where.quantityTonnes = {
                ...(filters.minTonnes != null ? { gte: filters.minTonnes } : {}),
                ...(filters.maxTonnes != null ? { lte: filters.maxTonnes } : {}),
            };
        }

        return db.exchangeListing.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: LIST_TAKE,
        });
    }

    /** GLOBAL read of a single listing by id (any tenant's). */
    static async getListing(db: PrismaTx, id: string) {
        return db.exchangeListing.findUnique({ where: { id } });
    }

    /** Create a listing. Ownership fields (`sellerTenantId`/`sellerUserId`) are
     *  set by the usecase from the request context. */
    static async createListing(
        db: PrismaTx,
        data: Prisma.ExchangeListingUncheckedCreateInput,
    ) {
        return db.exchangeListing.create({ data });
    }

    /** Flip a listing's lifecycle status (FULFILLED / WITHDRAWN / EXPIRED). */
    static async updateListingStatus(
        db: PrismaTx,
        id: string,
        status: ExchangeListingStatus,
    ) {
        return db.exchangeListing.update({ where: { id }, data: { status } });
    }

    /** Create an inquiry against a listing. */
    static async createInquiry(
        db: PrismaTx,
        data: Prisma.ExchangeInquiryUncheckedCreateInput,
    ) {
        return db.exchangeInquiry.create({ data });
    }

    /**
     * Inquiries received on listings OWNED by `sellerTenantId` (the seller's
     * inbox), newest first. Scoped by the seller's own tenant — a "my
     * inquiries" view, not RLS. Bounded.
     */
    static async listInquiriesForSeller(db: PrismaTx, sellerTenantId: string) {
        return db.exchangeInquiry.findMany({
            where: { listing: { sellerTenantId } },
            orderBy: { createdAt: 'desc' },
            take: LIST_TAKE,
            include: { listing: true },
        });
    }

    /**
     * Inquiries SENT by `inquirerTenantId` (the buyer's outbox), newest
     * first. Scoped by the inquirer's own tenant. Bounded.
     */
    static async listInquiriesByInquirer(db: PrismaTx, inquirerTenantId: string) {
        return db.exchangeInquiry.findMany({
            where: { inquirerTenantId },
            orderBy: { createdAt: 'desc' },
            take: LIST_TAKE,
            include: { listing: true },
        });
    }
}
