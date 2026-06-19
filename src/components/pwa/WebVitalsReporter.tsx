'use client';

/**
 * WebVitalsReporter — beacons Core Web Vitals (LCP, INP, CLS, FCP, TTFB) to
 * /api/metrics for real-user monitoring. INP in particular is a FIELD-only
 * metric (Lighthouse lab uses TBT as its proxy), so this is how we track it.
 *
 * `web-vitals` is dynamically imported so it never lands in the initial
 * bundle, and reporting uses `sendBeacon` so it survives page unload.
 * Entirely best-effort — any failure is swallowed.
 */
import { useEffect } from 'react';
import type { Metric } from 'web-vitals';

export function WebVitalsReporter() {
    useEffect(() => {
        let cancelled = false;
        const report = (metric: Metric) => {
            try {
                const body = JSON.stringify({
                    name: metric.name,
                    value: metric.value,
                    rating: metric.rating,
                    id: metric.id,
                    navigationType: metric.navigationType,
                });
                if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
                    navigator.sendBeacon('/api/metrics', body);
                } else {
                    void fetch('/api/metrics', {
                        method: 'POST',
                        body,
                        headers: { 'Content-Type': 'application/json' },
                        keepalive: true,
                    }).catch(() => {});
                }
            } catch {
                /* ignore */
            }
        };
        import('web-vitals')
            .then(({ onCLS, onINP, onLCP, onFCP, onTTFB }) => {
                if (cancelled) return;
                onCLS(report);
                onINP(report);
                onLCP(report);
                onFCP(report);
                onTTFB(report);
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, []);
    return null;
}

export default WebVitalsReporter;
