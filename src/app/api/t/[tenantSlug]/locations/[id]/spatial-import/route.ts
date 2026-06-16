/**
 * POST /api/t/[tenantSlug]/locations/[id]/spatial-import
 *
 * Stages a parcel-boundary upload (shapefile .zip / KML / GeoJSON) and
 * enqueues the off-thread `spatial-import` job. The handler's contract
 * is just "validate cheaply + stage + enqueue"; the worker parses,
 * validates topology, and replaces the location's parcels.
 *
 * Abuse hardening (Epic harden-security #2): the parse never runs on the
 * request thread, and the per-format byte cap (shapefile 5 MB /
 * GeoJSON·KML 10 MB) is enforced HERE, before the body is even buffered,
 * so an oversized upload gets an immediate 413.
 */
import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { stageLocationSpatialImport } from '@/app-layer/usecases/spatial-import';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';
import { detectFormat } from '@/lib/spatial/parse';
import { assertUploadWithinSize, SpatialLimitError } from '@/lib/spatial/limits';

const ALLOWED_EXT = ['.zip', '.kml', '.kmz', '.geojson', '.json'];

export const POST = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; id: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);

    const formData = await req.formData();
    const file = formData.get('file');
    if (!file || !(file instanceof File)) {
        return jsonResponse({ error: 'Missing or invalid file in form data' }, { status: 400 });
    }
    if (file.size === 0) {
        return jsonResponse({ error: 'File is empty' }, { status: 400 });
    }
    const lower = (file.name || '').toLowerCase();
    if (!ALLOWED_EXT.some((ext) => lower.endsWith(ext))) {
        return jsonResponse(
            { error: 'Unsupported file type. Upload a shapefile (.zip), KML (.kml/.kmz), or GeoJSON (.geojson/.json).' },
            { status: 415 },
        );
    }

    // Per-format byte cap — enforced on `file.size` BEFORE buffering the
    // body, so a hostile/oversized upload is refused without ever loading
    // its bytes into memory. detectFormat is non-null here (extension
    // already validated above).
    const format = detectFormat(file.name, file.type || undefined)!;
    try {
        assertUploadWithinSize(format, file.size);
    } catch (err) {
        if (err instanceof SpatialLimitError) {
            return jsonResponse({ error: err.message }, { status: err.statusCode });
        }
        throw err;
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await stageLocationSpatialImport(ctx, params.id, {
        filename: file.name,
        buffer,
        mimeType: file.type || undefined,
    });

    // 202 Accepted — the parse + persist runs off-thread. The client
    // polls GET .../spatial-import/:jobId for completion.
    return jsonResponse({ ...result, status: 'queued' }, { status: 202 });
});
