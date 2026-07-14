/**
 * GET /api/t/[tenantSlug]/reports/rent-roll
 *
 * The tenant rent roll & obligations (roadmap 3/3). Default → JSON; `?format=csv`
 * → a UTF-8 (BOM'd) CSV of rent-by-lessor; `?format=pdf` → the Cyrillic PDF.
 * Read-only, authorised via `assertCanRead` inside `getRentRoll` (reports are not
 * a `requirePermission` route root).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { getRentRoll } from '@/app-layer/usecases/rent-roll';
import { generateRentRollPdf } from '@/app-layer/reports/pdf/rent-roll';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

// PDFKit needs the Node runtime (stream/zlib/Buffer).
export const runtime = 'nodejs';
export const maxDuration = 60;

type Ctx = { params: Promise<{ tenantSlug: string }> };

function csvCell(v: string | number | null): string {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function collectPdfBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        doc.on('data', (c: Buffer) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        doc.end();
    });
}

export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: Ctx) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const url = new URL(req.url);
    const format = url.searchParams.get('format');
    const locationId = url.searchParams.get('locationId') ?? undefined;

    if (format === 'pdf') {
        const doc = await generateRentRollPdf(ctx, { locationId });
        const buf = await collectPdfBuffer(doc);
        return new NextResponse(new Uint8Array(buf), {
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': 'attachment; filename="rent-roll.pdf"',
            },
        });
    }

    const data = await getRentRoll(ctx, { expiringWithinDays: 90, locationId });

    if (format === 'csv') {
        const rows = [
            ['Наемодател', 'ЕИК', 'Договори', 'Площ (дка)', 'Рента/сезон', 'Единица'],
            ...data.byLessor.map((l) => [
                l.lessorName,
                l.lessorEik ?? '',
                l.leaseCount,
                l.leasedDca,
                l.rentTotal ?? '',
                l.rentUnit ?? '',
            ]),
        ];
        const csv = '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\n');
        return new NextResponse(csv, {
            headers: {
                'Content-Type': 'text/csv; charset=utf-8',
                'Content-Disposition': 'attachment; filename="rent-roll.csv"',
            },
        });
    }

    return jsonResponse(data);
});
