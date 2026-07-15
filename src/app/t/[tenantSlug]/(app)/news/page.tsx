import { NewsPageClient } from '@/components/trends/NewsPageClient';

/**
 * News page — aggregated agricultural news feed.
 *
 * A dashboard-style page visible to every tenant (news is global, not
 * module-gated — same posture as Trends / Offers / Events). The feed is fetched
 * client-side from `/api/t/<slug>/trends/news`; the page renders an
 * empty/operator state when no items are cached yet. The client shell lives in
 * `src/components/trends/` because it mounts the shared tab primitive (the
 * category filter), which the `single-tab-pattern` guard forbids inside
 * `src/app/**`.
 */
export default function NewsPage() {
    return <NewsPageClient />;
}
