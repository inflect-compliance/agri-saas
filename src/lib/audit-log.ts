import { withTenantDb, PrismaTx } from './db-context';
import type { JwtPayload } from './auth';

/**
 * @deprecated Use the Prisma audit middleware instead. CRUD mutations are logged automatically.
 * For domain events, use logEvent() from src/app-layer/events/audit.ts.
 *
 * This function is retained only for backward compatibility with legacy code paths.
 * No new code should call logAudit().
 *
 * Audit logger — records critical actions to an immutable log.
 * When called with a PrismaTx (from inside withTenantDb), it uses that transaction directly.
 * When called without one (legacy API routes), it wraps the insert in withTenantDb automatically.
 */
export async function logAudit(
    dbOrSession: PrismaTx | JwtPayload,
    sessionOrEntity: JwtPayload | string,
    entityOrEntityId: string,
    entityIdOrAction: string,
    actionOrDetails?: string,
    detailsOnly?: string
) {
    // Detect which overload is being used:
    // New: logAudit(db, session, entity, entityId, action, details?)
    // Old: logAudit(session, entity, entityId, action, details?)
    if (typeof sessionOrEntity === 'string') {
        // Old signature: logAudit(session, entity, entityId, action, details?)
        const session = dbOrSession as JwtPayload;
        const entity = sessionOrEntity;
        const entityId = entityOrEntityId;
        const action = entityIdOrAction;
        const details = actionOrDetails;

        // Wrap in withTenantDb for RLS enforcement
        await withTenantDb(session.tenantId, async (db) => {
            await db.auditLog.create({
                data: {
                    tenantId: session.tenantId,
                    userId: session.userId,
                    entity,
                    entityId,
                    action,
                    details,
                },
            });
        });
    } else {
        // New signature: logAudit(db, session, entity, entityId, action, details?)
        const db = dbOrSession as PrismaTx;
        const session = sessionOrEntity as JwtPayload;
        const entity = entityOrEntityId;
        const entityId = entityIdOrAction;
        const action = actionOrDetails!;
        const details = detailsOnly;

        await db.auditLog.create({
            data: {
                tenantId: session.tenantId,
                userId: session.userId,
                entity,
                entityId,
                action,
                details,
            },
        });
    }
}
