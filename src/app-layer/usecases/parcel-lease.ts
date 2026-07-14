/**
 * Parcel lease register (roadmap 2/3) — the land-use agreements (аренда/наем)
 * under which the tenant farms parcels it does not own. Tenant-scoped (RLS);
 * free-text fields are sanitised before persist. The lessor pre-fills from the
 * parcel's КАИС legal-entity owner in the UI, but is stored as free text here so
 * a non-cadastre lessor is equally recordable.
 */
import { Prisma } from '@prisma/client';
import type { RequestContext } from '../types';
import { assertCanRead, assertCanWrite } from '../policies/common';
import { runInTenantContext } from '@/lib/db-context';
import { logEvent } from '../events/audit';
import { sanitizePlainText } from '@/lib/security/sanitize';
import { badRequest, notFound } from '@/lib/errors/types';

export type LeaseKindInput = 'ARENDA' | 'NAEM';

export interface ParcelLeaseInput {
    lessorName: string;
    lessorEik?: string | null;
    kind: LeaseKindInput;
    rentAmount?: number | null;
    rentUnit?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    documentRef?: string | null;
    notes?: string | null;
}

const LEASE_SELECT = {
    id: true,
    parcelId: true,
    lessorName: true,
    lessorEik: true,
    kind: true,
    rentAmount: true,
    rentUnit: true,
    startDate: true,
    endDate: true,
    documentRef: true,
    notes: true,
    createdAt: true,
    updatedAt: true,
} satisfies Prisma.ParcelLeaseSelect;

function toDate(v?: string | null): Date | null {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
}

/** Build the persist payload from validated input — sanitises every free text. */
function mapLeaseData(input: ParcelLeaseInput) {
    const lessorName = sanitizePlainText((input.lessorName ?? '').trim());
    if (!lessorName) throw badRequest('Lessor name is required.');
    return {
        lessorName,
        lessorEik: input.lessorEik ? sanitizePlainText(input.lessorEik.trim()) : null,
        kind: input.kind,
        rentAmount: input.rentAmount != null ? new Prisma.Decimal(input.rentAmount) : null,
        rentUnit: input.rentUnit ? sanitizePlainText(input.rentUnit.trim()) : null,
        startDate: toDate(input.startDate),
        endDate: toDate(input.endDate),
        documentRef: input.documentRef ? sanitizePlainText(input.documentRef.trim()) : null,
        notes: input.notes ? sanitizePlainText(input.notes.trim()) : null,
    };
}

/** Every (non-deleted) lease for a parcel, newest term first. */
export async function listParcelLeases(ctx: RequestContext, parcelId: string) {
    assertCanRead(ctx);
    return runInTenantContext(ctx, (db) =>
        db.parcelLease.findMany({
            where: { parcelId, tenantId: ctx.tenantId, deletedAt: null },
            select: LEASE_SELECT,
            orderBy: [{ endDate: 'desc' }, { createdAt: 'desc' }],
            take: 100, // a parcel realistically carries a handful of leases
        }),
    );
}

export async function createParcelLease(ctx: RequestContext, parcelId: string, input: ParcelLeaseInput) {
    assertCanWrite(ctx);
    return runInTenantContext(ctx, async (db) => {
        const parcel = await db.parcel.findFirst({
            where: { id: parcelId, tenantId: ctx.tenantId, deletedAt: null },
            select: { id: true, name: true },
        });
        if (!parcel) throw notFound('Parcel not found');
        const lease = await db.parcelLease.create({
            data: { tenantId: ctx.tenantId, parcelId, ...mapLeaseData(input) },
            select: LEASE_SELECT,
        });
        await logEvent(db, ctx, {
            action: 'PARCEL_LEASE_CREATED',
            entityType: 'ParcelLease',
            entityId: lease.id,
            details: `Recorded ${input.kind} lease for parcel ${parcel.name}`,
            detailsJson: {
                category: 'entity_lifecycle',
                entityName: 'ParcelLease',
                operation: 'created',
                summary: `Recorded a lease for ${parcel.name}`,
            },
        });
        return lease;
    });
}

export async function updateParcelLease(ctx: RequestContext, leaseId: string, input: ParcelLeaseInput) {
    assertCanWrite(ctx);
    return runInTenantContext(ctx, async (db) => {
        const existing = await db.parcelLease.findFirst({
            where: { id: leaseId, tenantId: ctx.tenantId, deletedAt: null },
            select: { id: true },
        });
        if (!existing) throw notFound('Lease not found');
        const lease = await db.parcelLease.update({
            where: { id: leaseId },
            data: mapLeaseData(input),
            select: LEASE_SELECT,
        });
        await logEvent(db, ctx, {
            action: 'PARCEL_LEASE_UPDATED',
            entityType: 'ParcelLease',
            entityId: leaseId,
            details: 'Updated a parcel lease',
            detailsJson: {
                category: 'entity_lifecycle',
                entityName: 'ParcelLease',
                operation: 'updated',
                summary: 'Updated a parcel lease',
            },
        });
        return lease;
    });
}

export async function deleteParcelLease(ctx: RequestContext, leaseId: string) {
    assertCanWrite(ctx);
    return runInTenantContext(ctx, async (db) => {
        const existing = await db.parcelLease.findFirst({
            where: { id: leaseId, tenantId: ctx.tenantId, deletedAt: null },
            select: { id: true },
        });
        if (!existing) throw notFound('Lease not found');
        await db.parcelLease.update({ where: { id: leaseId }, data: { deletedAt: new Date() } });
        await logEvent(db, ctx, {
            action: 'PARCEL_LEASE_DELETED',
            entityType: 'ParcelLease',
            entityId: leaseId,
            details: 'Removed a parcel lease',
            detailsJson: {
                category: 'entity_lifecycle',
                entityName: 'ParcelLease',
                operation: 'deleted',
                summary: 'Removed a parcel lease',
            },
        });
        return { id: leaseId };
    });
}
