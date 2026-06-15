import { FarmTasksClient } from './FarmTasksClient';

export const dynamic = 'force-dynamic';

/**
 * Farm Tasks — Server Component wrapper.
 *
 * The operator queue is read client-side via SWR (GET /farm-tasks), so the
 * wrapper only resolves the tenant slug and mounts the client island.
 * Mirrors the Inventory page shape.
 */
export default async function FarmTasksPage({
    params,
}: {
    params: Promise<{ tenantSlug: string }>;
}) {
    const { tenantSlug } = await params;
    return <FarmTasksClient tenantSlug={tenantSlug} />;
}
