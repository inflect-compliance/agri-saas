import { RequestContext } from '../types';
import { ExchangeRepository, ListingFilters } from '../repositories/exchange';
import { assertCanRead, assertCanWrite } from '../policies/common';
import { logEvent } from '../events/audit';
import { runInTenantContext, PrismaTx } from '@/lib/db-context';
import { forbidden, notFound, badRequest } from '@/lib/errors/types';
import { sanitizePlainText } from '@/lib/security/sanitize';
import { regionByCode } from '@/lib/geo/bulgaria-regions';
import {
    ExchangeSide,
    ExchangeListingStatus,
} from '@prisma/client';

/**
 * Cross-tenant Exchange usecases.
 *
 * The Exchange tables are GLOBAL (no RLS — see prisma/schema/exchange.prisma
 * + repositories/exchange.ts). That makes THIS layer the ONLY thing standing
 * between a tenant and another tenant's rows:
 *   - every browse/read is intentionally global (returns rows across tenants);
 *   - every WRITE re-loads the target listing and asserts
 *     `ctx.tenantId === listing.sellerTenantId` before mutating.
 * Removing that assertion would let any tenant withdraw/fulfil anyone's
 * listing, so treat it as a security invariant, not a nicety.
 */

/** Preserve the undefined/null/string three-state for optional free-text
 *  columns so an untouched value is never overwritten with '' (mirrors the
 *  per-usecase helper used across the codebase). */
function sanitizeOptional(v: string | null | undefined): string | null | undefined {
    if (v === undefined) return undefined;
    if (v === null) return null;
    return sanitizePlainText(v);
}

export interface CreateListingInput {
    side: ExchangeSide;
    commodity: string;
    quantityTonnes: number | string;
    pricePerTonne?: number | string | null;
    priceCurrency?: string;
    /** ISO 3166-2:BG oblast code — regionName/lat/lon are derived from it. */
    regionCode: string;
    description?: string | null;
    sellerDisplayName?: string | null;
    expiresAt?: Date | null;
}

export interface CreateInquiryInput {
    listingId: string;
    message: string;
    quantityTonnes?: number | string | null;
}

// ─── Reads (GLOBAL — cross-tenant by design) ─────────────────────────

/** Browse ACTIVE listings across ALL tenants. */
export async function listActiveListings(ctx: RequestContext, filters: ListingFilters = {}) {
    assertCanRead(ctx);
    return runInTenantContext(ctx, (db) => ExchangeRepository.listActiveListings(db, filters));
}

/** Read one listing by id (any tenant's). */
export async function getListing(ctx: RequestContext, id: string) {
    assertCanRead(ctx);
    return runInTenantContext(ctx, async (db) => {
        const listing = await ExchangeRepository.getListing(db, id);
        if (!listing) throw notFound('Listing not found');
        return listing;
    });
}

/** The seller's inbox — inquiries received on this tenant's listings. */
export async function listInquiriesForSeller(ctx: RequestContext) {
    assertCanRead(ctx);
    return runInTenantContext(ctx, (db) =>
        ExchangeRepository.listInquiriesForSeller(db, ctx.tenantId),
    );
}

/** The buyer's outbox — inquiries this tenant has sent. */
export async function listInquiriesByInquirer(ctx: RequestContext) {
    assertCanRead(ctx);
    return runInTenantContext(ctx, (db) =>
        ExchangeRepository.listInquiriesByInquirer(db, ctx.tenantId),
    );
}

// ─── Writes ──────────────────────────────────────────────────────────

/** Publish a new listing owned by the caller's tenant. */
export async function createListing(ctx: RequestContext, input: CreateListingInput) {
    assertCanWrite(ctx);

    const region = regionByCode(input.regionCode);
    if (!region) throw badRequest('invalid_region', `Unknown region code: ${input.regionCode}`);

    return runInTenantContext(ctx, async (db) => {
        const listing = await ExchangeRepository.createListing(db, {
            // Ownership is fixed to the caller — a tenant can only ever create
            // its OWN listing.
            sellerTenantId: ctx.tenantId,
            sellerUserId: ctx.userId,
            side: input.side,
            // commodity + description + sellerDisplayName are PUBLIC free text
            // (every tenant reads them) → sanitize before persisting.
            commodity: sanitizePlainText(input.commodity),
            quantityTonnes: input.quantityTonnes,
            pricePerTonne: input.pricePerTonne ?? null,
            priceCurrency: input.priceCurrency ?? 'BGN',
            regionCode: region.code,
            regionName: region.nameEn,
            lat: region.lat,
            lon: region.lon,
            description: sanitizeOptional(input.description) ?? null,
            sellerDisplayName: sanitizeOptional(input.sellerDisplayName) ?? null,
            expiresAt: input.expiresAt ?? null,
        });

        await logEvent(db, ctx, {
            action: 'CREATE',
            entityType: 'ExchangeListing',
            entityId: listing.id,
            details: `Created ${listing.side} listing: ${listing.commodity}`,
            detailsJson: {
                category: 'entity_lifecycle',
                entityName: 'ExchangeListing',
                operation: 'created',
                after: { side: listing.side, commodity: listing.commodity, regionCode: listing.regionCode },
                summary: `Created ${listing.side} listing: ${listing.commodity}`,
            },
        });

        return listing;
    });
}

/**
 * Load a listing and assert the caller's tenant OWNS it. The cross-tenant
 * write guard — throws notFound if it doesn't exist, forbidden if it belongs
 * to another tenant.
 */
async function loadOwnedListing(db: PrismaTx, ctx: RequestContext, id: string) {
    const listing = await ExchangeRepository.getListing(db, id);
    if (!listing) throw notFound('Listing not found');
    if (listing.sellerTenantId !== ctx.tenantId) {
        throw forbidden('You can only modify your own listings');
    }
    return listing;
}

/** Withdraw one of the caller-tenant's own listings. */
export async function withdrawListing(ctx: RequestContext, id: string) {
    assertCanWrite(ctx);
    return runInTenantContext(ctx, async (db) => {
        const listing = await loadOwnedListing(db, ctx, id);
        const updated = await ExchangeRepository.updateListingStatus(
            db, id, ExchangeListingStatus.WITHDRAWN,
        );
        await logEvent(db, ctx, {
            action: 'UPDATE',
            entityType: 'ExchangeListing',
            entityId: id,
            details: `Withdrew listing: ${listing.commodity}`,
            detailsJson: {
                category: 'status_change',
                entityName: 'ExchangeListing',
                fromStatus: listing.status,
                toStatus: ExchangeListingStatus.WITHDRAWN,
                summary: `Withdrew listing: ${listing.commodity}`,
            },
        });
        return updated;
    });
}

/** Mark one of the caller-tenant's own listings as fulfilled. */
export async function fulfillListing(ctx: RequestContext, id: string) {
    assertCanWrite(ctx);
    return runInTenantContext(ctx, async (db) => {
        const listing = await loadOwnedListing(db, ctx, id);
        const updated = await ExchangeRepository.updateListingStatus(
            db, id, ExchangeListingStatus.FULFILLED,
        );
        await logEvent(db, ctx, {
            action: 'UPDATE',
            entityType: 'ExchangeListing',
            entityId: id,
            details: `Fulfilled listing: ${listing.commodity}`,
            detailsJson: {
                category: 'status_change',
                entityName: 'ExchangeListing',
                fromStatus: listing.status,
                toStatus: ExchangeListingStatus.FULFILLED,
                summary: `Fulfilled listing: ${listing.commodity}`,
            },
        });
        return updated;
    });
}

/** Send an inquiry against another tenant's ACTIVE listing. */
export async function createInquiry(ctx: RequestContext, input: CreateInquiryInput) {
    assertCanWrite(ctx);
    return runInTenantContext(ctx, async (db) => {
        const listing = await ExchangeRepository.getListing(db, input.listingId);
        if (!listing) throw notFound('Listing not found');
        if (listing.status !== ExchangeListingStatus.ACTIVE) {
            throw badRequest('listing_not_active', 'This listing is no longer active');
        }
        // You cannot inquire on your OWN listing.
        if (listing.sellerTenantId === ctx.tenantId) {
            throw forbidden('You cannot inquire on your own listing');
        }

        const inquiry = await ExchangeRepository.createInquiry(db, {
            listingId: listing.id,
            inquirerTenantId: ctx.tenantId,
            inquirerUserId: ctx.userId,
            // Public free text shown to the seller → sanitize.
            message: sanitizePlainText(input.message),
            quantityTonnes: input.quantityTonnes ?? null,
        });

        await logEvent(db, ctx, {
            action: 'CREATE',
            entityType: 'ExchangeInquiry',
            entityId: inquiry.id,
            details: `Inquiry on listing ${listing.id}`,
            detailsJson: {
                category: 'entity_lifecycle',
                entityName: 'ExchangeInquiry',
                operation: 'created',
                after: { listingId: listing.id },
                summary: `Inquiry on ${listing.side} listing: ${listing.commodity}`,
            },
        });

        return inquiry;
    });
}
