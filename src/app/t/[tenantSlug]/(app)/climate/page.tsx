import { getTenantCtx } from '@/app-layer/context';
import { listWeatherLocations, getLocationClimate } from '@/app-layer/usecases/climate';
import { ClimateClient } from './ClimateClient';

/**
 * Climate (Климат) — the farm's weather page. Renders the tenant's own
 * Open-Meteo `WeatherObservation` data (collected daily by the `weather-pull`
 * job): current conditions, a recent + forecast temperature chart, and today's
 * spray window, for a selected location (via the `?location=` query param,
 * defaulting to the first location).
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

    return (
        <ClimateClient
            tenantSlug={tenantSlug}
            locations={locations}
            selectedLocationId={selectedLocationId}
            climate={climate}
        />
    );
}
