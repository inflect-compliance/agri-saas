/**
 * R25-PR-A — Processes page (Server Component shell).
 *
 * Canvas-centric page under the Manage section. Inspired by Alteryx
 * in layout: slim top tools area + large canvas body. Visual-only
 * authoring surface for representing business + IT processes and
 * placing controls on the connections between process steps.
 *
 * Out-of-scope per the R25 brief:
 *   - Persistence (canvas state is in-memory only)
 *   - Process execution / simulation
 *   - Templates / process library
 *   - Inspector / properties panel
 *
 * PR-A scope: route + page shell + Manage-nav entry. The canvas
 * itself lands in PR-B (xyflow integration); custom nodes/edges in
 * PR-C/D; interaction model in PR-E; polish in PR-F.
 */
import { ProcessesClient } from "./ProcessesClient";

export const dynamic = "force-dynamic";

export default async function ProcessesPage({
    params,
}: {
    params: Promise<{ tenantSlug: string }>;
}) {
    const { tenantSlug } = await params;
    return <ProcessesClient tenantSlug={tenantSlug} />;
}
