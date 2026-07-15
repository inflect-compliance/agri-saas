import { getTenantCtx } from '@/app-layer/context';
import { RentClient } from './RentClient';

export default async function RentPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    // getTenantCtx also guards tenant access (throws/redirects on no-access).
    await getTenantCtx({ tenantSlug });
    return <RentClient tenantSlug={tenantSlug} />;
}
