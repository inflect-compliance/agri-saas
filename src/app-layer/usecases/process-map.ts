/**
 * Roadmap-26 PR-A — Process Map usecases.
 *
 * Thin orchestration: auth → tenant context → repo → audit.
 */

import { RequestContext } from '../types';
import { ProcessMapRepository } from '../repositories/ProcessMapRepository';
import { assertCanRead, assertCanWrite } from '../policies/common';
import { logEvent } from '../events/audit';
import { notFound } from '@/lib/errors/types';
import { runInTenantContext } from '@/lib/db-context';
import type {
    CreateProcessMapInput,
    SaveProcessMapInput,
} from '../schemas/process-map';

export async function listProcessMaps(ctx: RequestContext) {
    assertCanRead(ctx);
    return runInTenantContext(ctx, (db) =>
        ProcessMapRepository.list(db, ctx),
    );
}

export async function getProcessMap(ctx: RequestContext, id: string) {
    assertCanRead(ctx);
    return runInTenantContext(ctx, async (db) => {
        const map = await ProcessMapRepository.getByIdWithGraph(db, ctx, id);
        if (!map) throw notFound('Process map not found');
        return map;
    });
}

export async function createProcessMap(
    ctx: RequestContext,
    input: CreateProcessMapInput,
) {
    assertCanWrite(ctx);

    return runInTenantContext(ctx, async (db) => {
        const map = await ProcessMapRepository.create(db, ctx, {
            name: input.name,
            description: input.description ?? null,
            status: input.status,
            createdByUserId: ctx.userId,
        });

        await logEvent(db, ctx, {
            action: 'CREATE',
            entityType: 'ProcessMap',
            entityId: map.id,
            details: `Created process map: ${map.name}`,
            detailsJson: {
                category: 'entity_lifecycle',
                entityName: 'ProcessMap',
                operation: 'created',
                after: { name: map.name, status: map.status },
                summary: `Created process map: ${map.name}`,
            },
        });

        return map;
    });
}

export async function saveProcessMap(
    ctx: RequestContext,
    id: string,
    input: SaveProcessMapInput,
) {
    assertCanWrite(ctx);

    return runInTenantContext(ctx, async (db) => {
        const map = await ProcessMapRepository.replaceGraph(db, ctx, id, {
            name: input.name,
            description: input.description ?? undefined,
            status: input.status,
            nodes: input.nodes,
            edges: input.edges,
            // Epic P1 — optimistic concurrency. Forward the
            // client's claimed version so the repo can refuse the
            // write on conflict (HTTP 409 / `STALE_DATA`).
            expectedVersion: input.expectedVersion,
        });
        if (!map) throw notFound('Process map not found');

        await logEvent(db, ctx, {
            action: 'UPDATE',
            entityType: 'ProcessMap',
            entityId: id,
            details: `Saved process map: ${map.name} (v${map.version})`,
            detailsJson: {
                category: 'entity_lifecycle',
                entityName: 'ProcessMap',
                operation: 'updated',
                after: {
                    name: map.name,
                    status: map.status,
                    version: map.version,
                    nodeCount: map.nodes.length,
                    edgeCount: map.edges.length,
                },
                summary: `Saved process map: ${map.name} (v${map.version})`,
            },
        });

        return map;
    });
}

/**
 * Epic P2-PR-C — reverse lookup. Returns the process maps + edges
 * referencing a given control. Read-only; surfaces "Where is this
 * control used?" on the Control detail page.
 */
export async function listMapsUsingControl(
    ctx: RequestContext,
    controlId: string,
) {
    assertCanRead(ctx);
    return runInTenantContext(ctx, (db) =>
        ProcessMapRepository.listMapsByControl(db, ctx, controlId),
    );
}

/**
 * Epic P5-PR-A — list snapshots for a process map. Read-only;
 * surfaces the version-history sidebar.
 */
export async function listProcessMapSnapshots(
    ctx: RequestContext,
    mapId: string,
) {
    assertCanRead(ctx);
    return runInTenantContext(ctx, (db) =>
        ProcessMapRepository.listSnapshots(db, ctx, mapId),
    );
}

export async function deleteProcessMap(ctx: RequestContext, id: string) {
    assertCanWrite(ctx);

    return runInTenantContext(ctx, async (db) => {
        const ok = await ProcessMapRepository.softDelete(db, ctx, id, ctx.userId);
        if (!ok) throw notFound('Process map not found');

        await logEvent(db, ctx, {
            action: 'DELETE',
            entityType: 'ProcessMap',
            entityId: id,
            details: `Deleted process map`,
            detailsJson: {
                category: 'entity_lifecycle',
                entityName: 'ProcessMap',
                operation: 'deleted',
                summary: `Deleted process map ${id}`,
            },
        });

        return { id };
    });
}
