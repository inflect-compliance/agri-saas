/**
 * Outbound-webhook header conventions.
 *
 * Every outbound webhook this repo emits (audit-stream today; future
 * SCIM push, billing fanout, SIEM pluralisation) goes through this
 * module. Two invariants worth protecting:
 *
 *   1. Header names are defined once, in one place. Callers never
 *      spell the header name inline — they read the const / call
 *      `buildOutboundHeaders`.
 *   2. The Batch-Id IS the Idempotency-Key. A retry carries the same
 *      id, so SIEM consumers dedupe without knowing anything about
 *      our retry policy. Determinism of `computeBatchId` is the
 *      load-bearing property — never switch to a random id.
 *
 * ## Brand migration (Roadmap-5 PR3)
 *
 * The canonical headers are now `X-Agrent-*`. The legacy `X-Inflect-*`
 * headers carry IDENTICAL values and are emitted ALONGSIDE the new ones by
 * default so existing tenant SIEM integrations don't break on rename. The
 * dual-emit is controlled by `AUDIT_STREAM_LEGACY_HEADERS`:
 *   • unset / '1' (default) → emit BOTH X-Agrent-* and X-Inflect-*.
 *   • '0'                   → emit ONLY X-Agrent-* (flip once every consumer
 *                             has migrated; see the runbook deprecation window).
 * Read via `process.env` directly (mirrors `isRateLimitBypassed`) so an
 * operator can flip it without a redeploy; the var is declared in src/env.ts.
 */

import { createHash } from 'node:crypto';

/** Canonical (Agrent) outbound header names. */
export const OUTBOUND_WEBHOOK_HEADERS = {
    CONTENT_TYPE: 'Content-Type',
    USER_AGENT: 'User-Agent',
    BATCH_ID: 'X-Agrent-Batch-Id',
    SIGNATURE: 'X-Agrent-Signature',
    IDEMPOTENCY_KEY: 'X-Agrent-Idempotency-Key',
    SCHEMA_VERSION: 'X-Agrent-Schema-Version',
} as const;

/**
 * Legacy (inflect) header names — dual-emitted with identical values for
 * back-compat. Consumers migrate off these on their own schedule; the
 * `AUDIT_STREAM_LEGACY_HEADERS=0` switch drops them once nobody reads them.
 */
export const LEGACY_OUTBOUND_WEBHOOK_HEADERS = {
    BATCH_ID: 'X-Inflect-Batch-Id',
    SIGNATURE: 'X-Inflect-Signature',
    IDEMPOTENCY_KEY: 'X-Inflect-Idempotency-Key',
    SCHEMA_VERSION: 'X-Inflect-Schema-Version',
} as const;

export const SIGNATURE_PREFIX = 'sha256=';

/** Default ON — legacy X-Inflect-* headers stay until consumers migrate. */
export function legacyOutboundHeadersEnabled(): boolean {
    return process.env.AUDIT_STREAM_LEGACY_HEADERS !== '0';
}

interface BuildOutboundHeadersArgs {
    /** Deterministic batch id from `computeBatchId`. Also used as the Idempotency-Key. */
    batchId: string;
    /** Raw hex HMAC-SHA256 of the request body. The builder adds the 'sha256=' prefix. */
    signatureHex: string;
    /** Caller User-Agent string (e.g. 'Agrent-Audit-Stream/1'). */
    userAgent: string;
    /** Payload schema version. Matches `payload.schemaVersion` for consumer routing. */
    schemaVersion: number;
    /**
     * Override the legacy dual-emit (defaults to the AUDIT_STREAM_LEGACY_HEADERS
     * env flag). Explicit in tests so they don't depend on ambient env.
     */
    includeLegacy?: boolean;
}

export function buildOutboundHeaders(args: BuildOutboundHeadersArgs): Record<string, string> {
    const includeLegacy = args.includeLegacy ?? legacyOutboundHeadersEnabled();
    const signature = `${SIGNATURE_PREFIX}${args.signatureHex}`;
    const schemaVersion = String(args.schemaVersion);

    const headers: Record<string, string> = {
        [OUTBOUND_WEBHOOK_HEADERS.CONTENT_TYPE]: 'application/json',
        [OUTBOUND_WEBHOOK_HEADERS.USER_AGENT]: args.userAgent,
        [OUTBOUND_WEBHOOK_HEADERS.BATCH_ID]: args.batchId,
        [OUTBOUND_WEBHOOK_HEADERS.SIGNATURE]: signature,
        [OUTBOUND_WEBHOOK_HEADERS.IDEMPOTENCY_KEY]: args.batchId,
        [OUTBOUND_WEBHOOK_HEADERS.SCHEMA_VERSION]: schemaVersion,
    };

    if (includeLegacy) {
        // Identical values under the legacy names — a SIEM reading either set
        // sees the same batch id / signature / idempotency key.
        headers[LEGACY_OUTBOUND_WEBHOOK_HEADERS.BATCH_ID] = args.batchId;
        headers[LEGACY_OUTBOUND_WEBHOOK_HEADERS.SIGNATURE] = signature;
        headers[LEGACY_OUTBOUND_WEBHOOK_HEADERS.IDEMPOTENCY_KEY] = args.batchId;
        headers[LEGACY_OUTBOUND_WEBHOOK_HEADERS.SCHEMA_VERSION] = schemaVersion;
    }

    return headers;
}

/**
 * Deterministic batch id. Same (tenant, schema, eventIds) → same id.
 * A PR-4 retry of a failed delivery carries an identical Batch-Id,
 * letting consumers dedupe without any retry-aware code on our side.
 *
 * Hashes inputs stable across payload-body tweaks (only ids are hashed,
 * not event bodies) so re-formatting the payload doesn't change the id.
 *
 * Output is 128 bits (32 hex chars) — sufficient collision space for
 * per-tenant dedup windows (SIEMs typically retain ids for hours-days).
 */
export function computeBatchId(args: {
    tenantId: string;
    schemaVersion: number;
    eventIds: readonly string[];
}): string {
    const h = createHash('sha256');
    h.update(args.tenantId);
    h.update('|');
    h.update(String(args.schemaVersion));
    h.update('|');
    h.update(String(args.eventIds.length));
    for (const id of args.eventIds) {
        h.update('|');
        h.update(id);
    }
    return h.digest('hex').slice(0, 32);
}
