import { TrendsPageClient } from '@/components/trends/TrendsPageClient';

/**
 * Trends page — market-price charts.
 *
 * A dashboard-style page visible to every tenant (market data is global, not
 * module-gated — same posture as Offers / Events). The payload is fetched
 * client-side from `/api/t/<slug>/trends/prices`; the page renders an
 * unconfigured/empty state when the backend has no data. The client shell lives
 * in `src/components/trends/` because it mounts the shared tab primitive, which
 * the `single-tab-pattern` guard forbids inside `src/app/**`.
 */
export default function TrendsPage() {
    return <TrendsPageClient />;
}
