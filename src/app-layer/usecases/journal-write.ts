/**
 * The single audited seam for creating a journal entry.
 *
 * Lives in its own module because BOTH origins need it — the manual journal
 * usecase and the field-operation path in `inventory.ts` — and those two
 * already import each other (`journal.ts` → `recordHarvestLot`). Putting the
 * helper in either one would close that loop into a cycle.
 */
import type { RequestContext } from '../types';
import type { PrismaTx } from '@/lib/db-context';
import { JournalRepository } from '../repositories/JournalRepository';
import { logEvent } from '../events/audit';

/**
 * Create a LogEntry AND write its CREATE audit event — the single seam both
 * journal-entry origins go through.
 *
 * Journal entries (including the auto-generated INPUT_APPLICATION records the
 * field-op path mints) stay fully editable and deletable by any writer: the
 * regulated ДНЕВНИК sources its tables from `OperationParcel`, not `LogEntry`,
 * so an edit can never corrupt the filed diary. That makes the hash-chained
 * audit trail — not immutability — the accountability layer, which is exactly
 * why every origin must emit CREATE. The field-op path previously called the
 * repository directly and wrote no CREATE, leaving auto entries with an
 * edit/delete history but no beginning.
 *
 * `origin` is recorded in `detailsJson` (the schema is `.passthrough()`) so the
 * two are distinguishable without minting a second action string — `CREATE`
 * keeps its meaning and the audit-action registry needs no churn.
 *
 * Takes `db` so it can participate in an already-open transaction (the field-op
 * path runs inside `markOperationParcel`'s).
 */
export async function createLogEntryWithAudit(
    db: PrismaTx,
    ctx: RequestContext,
    input: Parameters<typeof JournalRepository.createLogEntry>[2],
    origin: 'manual' | 'field_operation',
) {
    const entry = await JournalRepository.createLogEntry(db, ctx, input);

    await logEvent(db, ctx, {
        action: 'CREATE',
        entityType: 'LogEntry',
        entityId: entry.id,
        details: `Created journal entry: ${entry.title}`,
        detailsJson: {
            category: 'entity_lifecycle',
            entityName: 'LogEntry',
            operation: 'created',
            origin,
            ...(input.operationParcelId ? { operationParcelId: input.operationParcelId } : {}),
            after: {
                type: entry.type,
                title: entry.title,
                status: entry.status,
                quantityCount: input.quantities?.length ?? 0,
            },
            summary: `Created journal entry: ${entry.title}`,
        },
    });

    return entry;
}

