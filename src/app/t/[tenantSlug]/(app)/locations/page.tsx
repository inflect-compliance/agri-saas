import { getTenantCtx } from '@/app-layer/context';
import { LocationsClient } from './LocationsClient';

export default async function LocationsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    // getTenantCtx also guards tenant access (throws/redirects on no-access).
    await getTenantCtx({ tenantSlug });
    return <LocationsClient tenantSlug={tenantSlug} />;
}
