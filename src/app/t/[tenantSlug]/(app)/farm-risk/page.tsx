import { getTenantCtx } from '@/app-layer/context';
import { listLocations } from '@/app-layer/usecases/location';
import { FarmRiskClient } from './FarmRiskClient';

export const dynamic = 'force-dynamic';

/**
 * Farm Risk (#13) — the per-parcel, satellite-driven AI risk page for farm
 * tenants. Replaces the GRC Risk Register in the farm nav (the GRC module
 * stays available at /risks behind CERTIFICATION). Server shell fetches the
 * tenant's locations; the client picks one and shows each parcel's satellite
 * risk + an insurer "ask for offer".
 */
export default async function FarmRiskPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    const ctx = await getTenantCtx({ tenantSlug });
    const locations = await listLocations(ctx);
    const options = locations.map((l) => ({ id: l.id, name: l.name }));

    return (
        <FarmRiskClient tenantSlug={tenantSlug} locations={JSON.parse(JSON.stringify(options))} />
    );
}
