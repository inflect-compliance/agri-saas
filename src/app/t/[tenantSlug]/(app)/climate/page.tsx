import { getTenantCtx } from '@/app-layer/context';
import { getMeteobotStationUrl } from '@/app-layer/usecases/modules';
import { ClimateClient } from './ClimateClient';

/**
 * Climate (Климат) — #14. Embeds the tenant's Meteobot station when
 * configured; otherwise links to the built-in Open-Meteo weather layer as a
 * fallback. Placeholder integration (embed/link) with a clear seam for the
 * real Meteobot API later.
 */
export default async function ClimatePage({ params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    const ctx = await getTenantCtx({ tenantSlug });
    const meteobotStationUrl = await getMeteobotStationUrl(ctx);

    return (
        <ClimateClient
            tenantSlug={tenantSlug}
            meteobotStationUrl={meteobotStationUrl}
            canAdmin={!!ctx.permissions.canAdmin}
        />
    );
}
