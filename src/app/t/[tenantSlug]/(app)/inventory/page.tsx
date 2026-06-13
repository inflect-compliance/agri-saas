import { InventoryClient } from './InventoryClient';

export default async function InventoryPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    return <InventoryClient tenantSlug={tenantSlug} />;
}
