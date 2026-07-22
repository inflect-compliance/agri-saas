/**
 * Promotion artwork (#12) — upload, serve, removal.
 *
 * Structurally this is the `lib/account/avatar.ts` path: a flat, non-tenant
 * storage key, a client-side canvas round-trip that emits webp with EXIF
 * already stripped, and a server that validates bytes rather than processing
 * them. `buildTenantObjectKey` is deliberately not used — it requires a
 * tenantId, and a promotion belongs to every tenant.
 *
 * ── One deliberate difference from avatars: this path SCANS ──────────────
 *
 * An avatar is a user's own photo, shown to their colleagues. A promotion
 * image is **third-party artwork, emailed to support by an outside company,
 * and rendered in every tenant's feed**. That is a materially worse threat
 * model, and the two existing precedents both fail it:
 *
 *   - Evidence uploads are scanned ASYNCHRONOUSLY and enforced at DOWNLOAD
 *     time. An `<img>` in the offers feed never passes through that gate.
 *   - Avatars are not scanned at all (no FileRecord, no scanStatus).
 *
 * So the scan happens inline, before the bytes are ever stored. This is
 * affordable precisely because the volume is low — a handful of uploads a
 * week by support staff, not a bulk evidence pipeline.
 *
 * The accept/reject policy mirrors `isDownloadAllowed` rather than inventing
 * a second one: INFECTED is refused in every mode; a scanner ERROR (which is
 * what "ClamAV not configured" resolves to outside `disabled` mode) is refused
 * under `strict` and allowed with a warning under `permissive`.
 *
 * @module lib/promotions/promotion-image
 */
import type { Readable } from 'node:stream';

import { prisma } from '@/lib/prisma';
import { getStorageProvider } from '@/lib/storage';
import { isWebp } from '@/lib/account/avatar';
import { scanBuffer } from '@/lib/storage/av-scan';
import { badRequest } from '@/lib/errors/types';
import { logger } from '@/lib/observability/logger';
import { env } from '@/env';

/**
 * Hard upload cap. A promotion card renders at roughly banner width; an
 * 800–1200px webp off the client canvas is ~40–150KB, so 512KB is a generous
 * ceiling for the honest path while still bounding a canvas-bypassing client.
 * Same number as `AVATAR_MAX_BYTES` — deliberately, since the shape of the
 * argument is the same.
 */
export const PROMOTION_IMAGE_MAX_BYTES = 512 * 1024;

/** Deterministic storage key — one image per promotion, always webp. */
export function promotionImageStorageKey(promotionId: string): string {
    return `promotions/${promotionId}.webp`;
}

/** The stable in-app URL written to `Promotion.mediaUrl`. */
export function promotionImageServeUrl(promotionId: string): string {
    return `/api/promotions/${promotionId}/image`;
}

/**
 * Decide whether a scan result may be stored.
 *
 * Returns null to accept, or a reason to refuse. Kept separate from the upload
 * so the policy is unit-testable without a storage backend or a live scanner.
 */
export function scanVerdictBlocks(status: string): string | null {
    if (status === 'INFECTED') {
        return 'This image was rejected by the malware scanner.';
    }
    if (status === 'ERROR') {
        // `strict` is the default. Outside `disabled` mode, an unconfigured
        // scanner also lands here — refusing is the point: unscanned
        // third-party bytes must not reach a cross-tenant surface.
        if (env.AV_SCAN_MODE === 'strict') {
            return 'The malware scanner is unavailable, so the image was not stored. Try again shortly.';
        }
    }
    return null;
}

/**
 * Validate, scan, store, and point `Promotion.mediaUrl` at the serve route.
 *
 * Order matters: every cheap rejection (empty / oversized / not-webp) runs
 * before the scan, so a malformed upload never occupies the scanner, and the
 * scan runs before the write, so refused bytes are never persisted at all.
 */
export async function uploadPromotionImage(
    promotionId: string,
    buf: Buffer,
): Promise<{ mediaUrl: string }> {
    if (buf.length === 0) {
        throw badRequest('The image upload was empty.');
    }
    if (buf.length > PROMOTION_IMAGE_MAX_BYTES) {
        throw badRequest('The processed image is too large — re-select a smaller one.');
    }
    if (!isWebp(buf)) {
        // The client canvas emits webp. Anything else means the canvas step
        // was bypassed, so these bytes are unprocessed and may still carry
        // EXIF (including GPS) — refuse rather than store them.
        throw badRequest('The image must be a WebP file.');
    }

    const scan = await scanBuffer(buf);
    const blocked = scanVerdictBlocks(scan.status);
    if (blocked) {
        logger.warn('promotion-image.rejected', {
            component: 'promotion-image',
            promotionId,
            scanStatus: scan.status,
            engine: scan.engine,
            scanMode: env.AV_SCAN_MODE,
        });
        throw badRequest(blocked);
    }

    await getStorageProvider().write(promotionImageStorageKey(promotionId), buf, {
        mimeType: 'image/webp',
        maxSizeBytes: PROMOTION_IMAGE_MAX_BYTES,
    });

    const mediaUrl = promotionImageServeUrl(promotionId);
    await prisma.promotion.update({ where: { id: promotionId }, data: { mediaUrl } });

    logger.info('promotion-image.stored', {
        component: 'promotion-image',
        promotionId,
        bytes: buf.length,
        scanEngine: scan.engine,
    });
    return { mediaUrl };
}

/**
 * Drop a promotion's artwork. The storage delete is best-effort (the object
 * may already be gone); clearing `mediaUrl` is the operation that matters,
 * since that is what the feed reads.
 */
export async function removePromotionImage(promotionId: string): Promise<void> {
    await getStorageProvider()
        .delete(promotionImageStorageKey(promotionId))
        .catch(() => undefined);
    await prisma.promotion.update({
        where: { id: promotionId },
        data: { mediaUrl: null },
    });
}

/**
 * Resolve stored artwork to a readable stream for the serve route, or null
 * when there is none. The `head` probe turns a missing object into a clean
 * null (→ 404) instead of an async stream error mid-response.
 */
export async function getPromotionImageStream(
    promotionId: string,
): Promise<Readable | null> {
    const provider = getStorageProvider();
    const key = promotionImageStorageKey(promotionId);
    try {
        await provider.head(key);
    } catch {
        return null;
    }
    return provider.readStream(key);
}
