import { RequestContext } from '../types';
import { assertCanViewAdminSettings } from '../policies/admin.policies';
import { assertCanAdmin } from '../policies/common';
import { logEvent } from '../events/audit';
import { runInTenantContext } from '@/lib/db-context';
import { sanitizePlainText } from '@/lib/security/sanitize';

/**
 * БАБХ farm-record — the one-per-tenant FarmProfile identity block printed on
 * the "ДНЕВНИК за проведените растителнозащитни мероприятия и торене"
 * (Прил. 1 към заповед РД 11-3194/31.12.2021). Every field is optional (the
 * paper form tolerates blanks). egn/eik are encrypted at rest via the Epic B
 * manifest — this usecase reads/writes plaintext; the Prisma extension does
 * the crypto transparently.
 */

export interface FarmProfileFields {
    producerName?: string | null;
    egn?: string | null;
    eik?: string | null;
    address?: string | null;
    municipality?: string | null;
    settlement?: string | null;
    agricultureDirectorateCity?: string | null;
    registrationPlace?: string | null;
    registrationEkatte?: string | null;
    odbhCity?: string | null;
}

/** Ordered list of the editable string fields (single source of truth). */
const PROFILE_FIELDS = [
    'producerName',
    'egn',
    'eik',
    'address',
    'municipality',
    'settlement',
    'agricultureDirectorateCity',
    'registrationPlace',
    'registrationEkatte',
    'odbhCity',
] as const;

type ProfileShape = Record<(typeof PROFILE_FIELDS)[number], string | null>;

const EMPTY_PROFILE: ProfileShape = PROFILE_FIELDS.reduce(
    (acc, k) => ({ ...acc, [k]: null }),
    {} as ProfileShape,
);

/** Admin read — the tenant's farm profile (an all-null shape when unset). */
export async function getFarmProfile(ctx: RequestContext): Promise<ProfileShape> {
    assertCanViewAdminSettings(ctx);
    return runInTenantContext(ctx, async (db) => {
        const row = await db.farmProfile.findUnique({
            where: { tenantId: ctx.tenantId },
        });
        if (!row) return { ...EMPTY_PROFILE };
        return PROFILE_FIELDS.reduce(
            (acc, k) => ({ ...acc, [k]: (row as Record<string, unknown>)[k] ?? null }),
            {} as ProfileShape,
        );
    });
}

/** Admin write — upsert the tenant's farm profile. Blank strings clear a field. */
export async function upsertFarmProfile(
    ctx: RequestContext,
    input: FarmProfileFields,
): Promise<ProfileShape> {
    assertCanAdmin(ctx);

    // Every field is optional free text — trim + sanitise, blank → null.
    const norm = (v: string | null | undefined): string | null => {
        if (v == null) return null;
        return sanitizePlainText(v.trim()) || null;
    };
    const data: ProfileShape = PROFILE_FIELDS.reduce(
        (acc, k) => ({ ...acc, [k]: norm(input[k]) }),
        {} as ProfileShape,
    );

    return runInTenantContext(ctx, async (db) => {
        const row = await db.farmProfile.upsert({
            where: { tenantId: ctx.tenantId },
            create: { tenantId: ctx.tenantId, ...data },
            update: data,
        });

        await logEvent(db, ctx, {
            action: 'FARM_PROFILE_UPDATED',
            entityType: 'FarmProfile',
            entityId: row.id,
            details: 'Farm profile updated',
            detailsJson: {
                category: 'entity_lifecycle',
                entityName: 'FarmProfile',
                operation: 'updated',
                summary: 'Farm profile updated',
            },
        });

        return PROFILE_FIELDS.reduce(
            (acc, k) => ({ ...acc, [k]: (row as Record<string, unknown>)[k] ?? null }),
            {} as ProfileShape,
        );
    });
}
