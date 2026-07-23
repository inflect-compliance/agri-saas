import { getTenantCtx } from '@/app-layer/context';
import { listWeatherLocations, getLocationClimate } from '@/app-layer/usecases/climate';
import { getMeteobotStationUrl } from '@/app-layer/usecases/modules';
import { ClimateClient } from './ClimateClient';

/**
 * Climate (Климат) — the farm's weather page. Renders the tenant's own
 * Open-Meteo `WeatherObservation` data (collected daily by the `weather-pull`
 * job): current conditions, a recent + forecast temperature chart, and today's
 * spray window, for a selected location (via the `?location=` query param,
 * defaulting to the first location). Below it, the tenant's own Meteobot station
 * dashboard is embedded when configured (admins set/clear the URL inline).
 */
export default async function ClimatePage({
    params,
    searchParams,
}: {
    params: Promise<{ tenantSlug: string }>;
    searchParams: Promise<{ location?: string }>;
}) {
    const { tenantSlug } = await params;
    const { location } = await searchParams;
    const ctx = await getTenantCtx({ tenantSlug });

    const locations = await listWeatherLocations(ctx);
    // Selected location: the ?location param when it's a real location of this
    // tenant, else the first location. null when the tenant has no locations.
    const selectedLocationId =
        (location && locations.some((l) => l.id === location) ? location : locations[0]?.id) ?? null;
    const climate = selectedLocationId ? await getLocationClimate(ctx, selectedLocationId) : null;
    // The tenant's Meteobot station embed (if configured) + whether this user
    // can set/clear it. Read alongside the Open-Meteo weather.
    const meteobotStationUrl = await getMeteobotStationUrl(ctx);
    const canConfigure = ctx.permissions.canAdmin;

    return (
        <ClimateClient
            tenantSlug={tenantSlug}
            locations={locations}
            selectedLocationId={selectedLocationId}
            climate={climate}
            meteobotStationUrl={meteobotStationUrl}
            canConfigure={canConfigure}
        />
    );
}
