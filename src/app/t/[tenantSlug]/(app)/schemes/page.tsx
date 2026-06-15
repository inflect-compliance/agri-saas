import { getTenantCtx } from '@/app-layer/context';
import { listSchemes } from '@/app-layer/usecases/certification-scheme';
import { SchemesClient } from './SchemesClient';

export const dynamic = 'force-dynamic';

/**
 * Certification Schemes — Server Component.
 * Fetches the global AG_SCHEME framework catalog server-side and
 * delegates all interaction to the client island.
 */
export default async function SchemesPage({
    params,
}: {
    params: Promise<{ tenantSlug: string }>;
}) {
    const { tenantSlug } = await params;
    const ctx = await getTenantCtx({ tenantSlug });

    const schemes = await listSchemes(ctx);

    return (
        <SchemesClient
            initialSchemes={JSON.parse(JSON.stringify(schemes))}
            tenantSlug={tenantSlug}
            permissions={{ canAdmin: ctx.permissions.canAdmin }}
        />
    );
}
