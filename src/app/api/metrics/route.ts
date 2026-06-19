import { NextRequest } from 'next/server';
import { logger } from '@/lib/observability/logger';

/**
 * Anonymous web-vitals RUM sink. Public (see `isPublicPath`) and bare (no
 * mutation rate-limit — vitals beacon several times per page load). No PII:
 * only the metric name / value / rating. Always 204s; a malformed beacon is
 * ignored.
 */
export async function POST(req: NextRequest) {
    try {
        const m = (await req.json()) as {
            name?: unknown;
            value?: unknown;
            rating?: unknown;
            navigationType?: unknown;
        };
        if (typeof m?.name === 'string' && typeof m?.value === 'number' && Number.isFinite(m.value)) {
            logger.info('web-vital', {
                component: 'web-vitals',
                metric: m.name,
                value: Math.round(m.value * 1000) / 1000,
                rating: typeof m.rating === 'string' ? m.rating : undefined,
                navigationType: typeof m.navigationType === 'string' ? m.navigationType : undefined,
            });
        }
    } catch {
        /* malformed beacon — ignore */
    }
    return new Response(null, { status: 204 });
}
