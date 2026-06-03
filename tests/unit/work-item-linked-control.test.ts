/**
 * Unit test — tasks linked to a control surface via controlId too.
 *
 * Bug: installing a framework pack creates tasks with the direct
 * `Task.controlId` FK (no generic TaskLink row). The control detail
 * page's "Tasks" tab lists tasks via `linkedEntityType=CONTROL`, which
 * the repository previously translated to a TaskLink-only filter — so
 * pack-installed tasks (controlId set, no TaskLink) never appeared,
 * even though the task's OWN view shows the control.
 *
 * Fix: for `linkedEntityType === 'CONTROL'`, match via TaskLink OR the
 * `controlId` FK. This test locks the where-clause shape (the
 * repository's filter is the single source of truth for "tasks linked
 * to a control").
 */

import { WorkItemRepository } from '@/app-layer/repositories/WorkItemRepository';
import type { RequestContext } from '@/app-layer/types';

const ctx = { tenantId: 'tenant-1' } as RequestContext;

function mockDb() {
    const findMany = jest.fn().mockResolvedValue([]);
    return { db: { task: { findMany } } as never, findMany };
}

function whereOf(findMany: jest.Mock) {
    return findMany.mock.calls[0][0].where;
}

describe('WorkItemRepository — control-linked tasks', () => {
    it('CONTROL link matches via TaskLink OR the controlId FK', async () => {
        const { db, findMany } = mockDb();
        await WorkItemRepository.list(db, ctx, {
            linkedEntityType: 'CONTROL',
            linkedEntityId: 'ctrl-1',
        });
        const where = whereOf(findMany);
        const orClause = (where.AND as any[]).find((c) => Array.isArray(c.OR));
        expect(orClause).toBeTruthy();
        // one branch is the TaskLink join, the other is the direct FK
        expect(orClause.OR).toEqual(
            expect.arrayContaining([
                { controlId: 'ctrl-1' },
                {
                    links: {
                        some: { entityType: 'CONTROL', entityId: 'ctrl-1' },
                    },
                },
            ]),
        );
    });

    it('non-control links stay TaskLink-only (no controlId branch)', async () => {
        const { db, findMany } = mockDb();
        await WorkItemRepository.list(db, ctx, {
            linkedEntityType: 'ASSET',
            linkedEntityId: 'asset-1',
        });
        const where = whereOf(findMany);
        const serialized = JSON.stringify(where);
        expect(serialized).toContain('"entityType":"ASSET"');
        // No controlId match for asset/risk/etc. — those have no FK on Task.
        expect(serialized).not.toContain('controlId');
    });
});

describe('WorkItemRepository.countLinkedToControl', () => {
    function mockCountDb() {
        // Promise.all order: total query first, done query second.
        const count = jest
            .fn()
            .mockResolvedValueOnce(5)
            .mockResolvedValueOnce(2);
        return { db: { task: { count } } as never, count };
    }

    it('counts via the SAME TaskLink-OR-controlId where the panel lists', async () => {
        const { db, count } = mockCountDb();
        const result = await WorkItemRepository.countLinkedToControl(
            db,
            ctx,
            'ctrl-1',
        );
        expect(result).toEqual({ total: 5, done: 2 });

        // total query — the control-link OR clause, no status filter.
        const totalOr = (count.mock.calls[0][0].where.AND as any[]).find(
            (c) => Array.isArray(c.OR),
        );
        expect(totalOr.OR).toEqual(
            expect.arrayContaining([
                { controlId: 'ctrl-1' },
                { links: { some: { entityType: 'CONTROL', entityId: 'ctrl-1' } } },
            ]),
        );

        // done query — same where AND status in the completed set
        // (RESOLVED/CLOSED — CANCELED is terminal but not completed).
        expect(count.mock.calls[1][0].where.AND).toEqual(
            expect.arrayContaining([
                { status: { in: ['RESOLVED', 'CLOSED'] } },
            ]),
        );
    });
});
