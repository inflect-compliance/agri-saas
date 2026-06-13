import { OfflineFieldPanel } from '@/components/offline/OfflineFieldPanel';

/**
 * Operator field-execution page — the offline-capable, phones-with-gloves
 * surface for executing a spray job. Mark lines done/skip in the field;
 * the marks queue + sync via the outbox when signal returns.
 */
export default async function OperatorFieldPage({ params }: { params: Promise<{ tenantSlug: string; taskId: string }> }) {
    const { taskId } = await params;
    return <OfflineFieldPanel taskId={taskId} />;
}
