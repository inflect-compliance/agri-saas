/**
 * createLogEntryWithAudit — the single audited seam both journal-entry
 * origins go through (the manual usecase and the field-operation path).
 *
 * Journal entries stay fully editable and deletable, so the hash-chained audit
 * trail is the accountability layer that replaces immutability. That only
 * holds if EVERY origin emits a CREATE — the field-op path used to call the
 * repository directly, leaving auto entries with an edit/delete history but no
 * beginning. These tests lock the seam shut.
 */
export {};

const mockCreateLogEntry = jest.fn();
const mockLogEvent = jest.fn();

jest.mock('@/app-layer/repositories/JournalRepository', () => ({
    JournalRepository: { createLogEntry: (...a: unknown[]) => mockCreateLogEntry(...a) },
}));
jest.mock('@/app-layer/events/audit', () => ({ logEvent: (...a: unknown[]) => mockLogEvent(...a) }));

import { createLogEntryWithAudit } from '@/app-layer/usecases/journal-write';
import { makeRequestContext } from '../helpers/make-context';

const ctx = makeRequestContext('EDITOR', { userId: 'u-1', tenantId: 't-1', tenantSlug: 'acme' });
const db = {} as never;

beforeEach(() => {
    jest.clearAllMocks();
    mockCreateLogEntry.mockResolvedValue({
        id: 'log-1',
        type: 'INPUT_APPLICATION',
        title: 'Applied X to Parcel A',
        status: 'DONE',
    });
});

describe('createLogEntryWithAudit', () => {
    it('creates the entry and emits a CREATE audit event', async () => {
        const entry = await createLogEntryWithAudit(
            db,
            ctx,
            { type: 'OBSERVATION', title: 'Scouting' } as never,
            'manual',
        );

        expect(entry.id).toBe('log-1');
        expect(mockCreateLogEntry).toHaveBeenCalledTimes(1);
        expect(mockLogEvent).toHaveBeenCalledTimes(1);
        expect(mockLogEvent).toHaveBeenCalledWith(
            db,
            ctx,
            expect.objectContaining({
                action: 'CREATE',
                entityType: 'LogEntry',
                entityId: 'log-1',
                detailsJson: expect.objectContaining({
                    category: 'entity_lifecycle',
                    entityName: 'LogEntry',
                    operation: 'created',
                    origin: 'manual',
                }),
            }),
        );
    });

    it('tags the field-operation origin and carries the operationParcelId', async () => {
        await createLogEntryWithAudit(
            db,
            ctx,
            { type: 'INPUT_APPLICATION', title: 'Applied X', operationParcelId: 'op-9' } as never,
            'field_operation',
        );

        const payload = mockLogEvent.mock.calls[0][2];
        expect(payload.detailsJson.origin).toBe('field_operation');
        expect(payload.detailsJson.operationParcelId).toBe('op-9');
    });

    it('omits operationParcelId when the entry has none', async () => {
        await createLogEntryWithAudit(db, ctx, { type: 'OBSERVATION', title: 'Scouting' } as never, 'manual');

        const payload = mockLogEvent.mock.calls[0][2];
        expect(payload.detailsJson).not.toHaveProperty('operationParcelId');
    });

    it('records the created shape so the chain has a meaningful beginning', async () => {
        await createLogEntryWithAudit(
            db,
            ctx,
            { type: 'INPUT_APPLICATION', title: 'Applied X', quantities: [{}, {}] } as never,
            'field_operation',
        );

        const payload = mockLogEvent.mock.calls[0][2];
        expect(payload.detailsJson.after).toEqual({
            type: 'INPUT_APPLICATION',
            title: 'Applied X to Parcel A',
            status: 'DONE',
            quantityCount: 2,
        });
    });
});
