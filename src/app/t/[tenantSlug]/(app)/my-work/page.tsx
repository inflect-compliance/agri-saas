import { MyWorkClient } from './MyWorkClient';

export const dynamic = 'force-dynamic';

/**
 * "My work" — the machine-operator / sprayer (MECHANISATOR) landing screen.
 *
 * A deliberately minimal surface: the operator's OPEN assigned jobs as big
 * tap targets. A field operation opens the offline parcel-marking panel
 * (`/field/[taskId]`); a plain farm task is completed inline. For a
 * MECHANISATOR this is the ONLY reachable screen (middleware pins them here
 * and the app shell renders no navigation); for anyone else it's a handy
 * "what's on my plate" view.
 */
export default async function MyWorkPage({
    params,
}: {
    params: Promise<{ tenantSlug: string }>;
}) {
    const { tenantSlug } = await params;
    return <MyWorkClient tenantSlug={tenantSlug} />;
}
