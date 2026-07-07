import { getTenantCtx } from '@/app-layer/context';
import { listCropPlans, listSeasons, listCropTypes, listCropVarieties } from '@/app-layer/usecases/crop-planning';
import { listLocations } from '@/app-layer/usecases/location';
import { CropPlansClient } from './CropPlansClient';

export const dynamic = 'force-dynamic';

/**
 * Crop Planning — Server Component wrapper.
 *
 * Fetches the crop plans + the catalogs the create-plan modal needs
 * (seasons / crop types / varieties) server-side, then delegates
 * interaction to the client island. Mirrors the Journal page.
 */
export default async function PlanningPage({
    params,
}: {
    params: Promise<{ tenantSlug: string }>;
}) {
    const { tenantSlug } = await params;
    const ctx = await getTenantCtx({ tenantSlug });

    const [plans, seasons, cropTypes, varieties, locations] = await Promise.all([
        listCropPlans(ctx),
        listSeasons(ctx),
        listCropTypes(ctx),
        listCropVarieties(ctx),
        listLocations(ctx),
    ]);

    // The create-plan modal only needs id + name to scope its parcel picker.
    const locationOptions = locations.map((l) => ({ id: l.id, name: l.name }));

    return (
        <div className="space-y-section animate-fadeIn">
            <CropPlansClient
                initialPlans={JSON.parse(JSON.stringify(plans))}
                seasons={JSON.parse(JSON.stringify(seasons))}
                cropTypes={JSON.parse(JSON.stringify(cropTypes))}
                varieties={JSON.parse(JSON.stringify(varieties))}
                locations={JSON.parse(JSON.stringify(locationOptions))}
                tenantSlug={tenantSlug}
                permissions={{ canWrite: ctx.permissions.canWrite }}
            />
        </div>
    );
}
