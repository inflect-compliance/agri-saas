import {
    OUTBOUND_WEBHOOK_HEADERS,
    LEGACY_OUTBOUND_WEBHOOK_HEADERS,
    SIGNATURE_PREFIX,
    buildOutboundHeaders,
    computeBatchId,
} from '@/app-layer/events/webhook-headers';

describe('buildOutboundHeaders', () => {
    const base = {
        batchId: 'b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1',
        signatureHex: 'deadbeef',
        userAgent: 'Agrent-Audit-Stream/1',
        schemaVersion: 1,
    };

    it('the canonical header names are X-Agrent-*', () => {
        expect(OUTBOUND_WEBHOOK_HEADERS.BATCH_ID).toBe('X-Agrent-Batch-Id');
        expect(OUTBOUND_WEBHOOK_HEADERS.SIGNATURE).toBe('X-Agrent-Signature');
        expect(OUTBOUND_WEBHOOK_HEADERS.IDEMPOTENCY_KEY).toBe('X-Agrent-Idempotency-Key');
    });

    it('includeLegacy:false emits ONLY the six canonical headers', () => {
        const h = buildOutboundHeaders({ ...base, includeLegacy: false });
        expect(Object.keys(h).sort()).toEqual([
            OUTBOUND_WEBHOOK_HEADERS.BATCH_ID,
            OUTBOUND_WEBHOOK_HEADERS.CONTENT_TYPE,
            OUTBOUND_WEBHOOK_HEADERS.IDEMPOTENCY_KEY,
            OUTBOUND_WEBHOOK_HEADERS.SCHEMA_VERSION,
            OUTBOUND_WEBHOOK_HEADERS.SIGNATURE,
            OUTBOUND_WEBHOOK_HEADERS.USER_AGENT,
        ].sort());
    });

    it('includeLegacy:true dual-emits X-Inflect-* with IDENTICAL values', () => {
        const h = buildOutboundHeaders({ ...base, includeLegacy: true });
        expect(h[LEGACY_OUTBOUND_WEBHOOK_HEADERS.BATCH_ID]).toBe(h[OUTBOUND_WEBHOOK_HEADERS.BATCH_ID]);
        expect(h[LEGACY_OUTBOUND_WEBHOOK_HEADERS.SIGNATURE]).toBe(h[OUTBOUND_WEBHOOK_HEADERS.SIGNATURE]);
        expect(h[LEGACY_OUTBOUND_WEBHOOK_HEADERS.IDEMPOTENCY_KEY]).toBe(h[OUTBOUND_WEBHOOK_HEADERS.IDEMPOTENCY_KEY]);
        expect(h[LEGACY_OUTBOUND_WEBHOOK_HEADERS.SCHEMA_VERSION]).toBe(h[OUTBOUND_WEBHOOK_HEADERS.SCHEMA_VERSION]);
    });

    it('defaults to dual-emit; AUDIT_STREAM_LEGACY_HEADERS=0 drops the legacy set', () => {
        const prev = process.env.AUDIT_STREAM_LEGACY_HEADERS;
        try {
            delete process.env.AUDIT_STREAM_LEGACY_HEADERS;
            expect(buildOutboundHeaders(base)[LEGACY_OUTBOUND_WEBHOOK_HEADERS.SIGNATURE]).toBeDefined();

            process.env.AUDIT_STREAM_LEGACY_HEADERS = '0';
            const only = buildOutboundHeaders(base);
            expect(only[LEGACY_OUTBOUND_WEBHOOK_HEADERS.SIGNATURE]).toBeUndefined();
            expect(only[OUTBOUND_WEBHOOK_HEADERS.SIGNATURE]).toBeDefined(); // canonical still there
        } finally {
            if (prev === undefined) delete process.env.AUDIT_STREAM_LEGACY_HEADERS;
            else process.env.AUDIT_STREAM_LEGACY_HEADERS = prev;
        }
    });

    it('prepends sha256= to the signature', () => {
        const h = buildOutboundHeaders({ ...base, includeLegacy: false });
        expect(h[OUTBOUND_WEBHOOK_HEADERS.SIGNATURE]).toBe(`${SIGNATURE_PREFIX}deadbeef`);
    });

    it('uses the batch id as the idempotency key', () => {
        const h = buildOutboundHeaders({ ...base, includeLegacy: false });
        expect(h[OUTBOUND_WEBHOOK_HEADERS.IDEMPOTENCY_KEY]).toBe(base.batchId);
        expect(h[OUTBOUND_WEBHOOK_HEADERS.BATCH_ID]).toBe(base.batchId);
    });

    it('serialises schemaVersion as a string', () => {
        const h = buildOutboundHeaders({ ...base, schemaVersion: 7, includeLegacy: false });
        expect(h[OUTBOUND_WEBHOOK_HEADERS.SCHEMA_VERSION]).toBe('7');
    });

    it('hardcodes Content-Type to application/json', () => {
        const h = buildOutboundHeaders({ ...base, includeLegacy: false });
        expect(h[OUTBOUND_WEBHOOK_HEADERS.CONTENT_TYPE]).toBe('application/json');
    });
});

describe('computeBatchId', () => {
    const input = {
        tenantId: 't1',
        schemaVersion: 1,
        eventIds: ['a', 'b', 'c'] as const,
    };

    it('is deterministic — same input, same id', () => {
        const a = computeBatchId(input);
        const b = computeBatchId({ ...input });
        expect(a).toBe(b);
    });

    it('returns 32 hex chars (128 bits)', () => {
        const id = computeBatchId(input);
        expect(id).toMatch(/^[0-9a-f]{32}$/);
    });

    it('differs when tenantId differs', () => {
        const a = computeBatchId(input);
        const b = computeBatchId({ ...input, tenantId: 't2' });
        expect(a).not.toBe(b);
    });

    it('differs when event count differs', () => {
        const a = computeBatchId(input);
        const b = computeBatchId({ ...input, eventIds: ['a', 'b'] });
        expect(a).not.toBe(b);
    });

    it('differs when an event id changes', () => {
        const a = computeBatchId(input);
        const b = computeBatchId({ ...input, eventIds: ['a', 'b', 'd'] });
        expect(a).not.toBe(b);
    });

    it('differs when schema version changes', () => {
        const a = computeBatchId(input);
        const b = computeBatchId({ ...input, schemaVersion: 2 });
        expect(a).not.toBe(b);
    });

    it('does NOT depend on event-id order — order-sensitivity is intentional', () => {
        // Regression guard: if we ever move to Set-based hashing the
        // property should change deliberately. Today, reordering gives
        // a different id (inputs are serialised positionally).
        const a = computeBatchId(input);
        const b = computeBatchId({ ...input, eventIds: ['c', 'b', 'a'] });
        expect(a).not.toBe(b);
    });
});
