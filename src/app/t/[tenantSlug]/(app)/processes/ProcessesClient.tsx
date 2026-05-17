"use client";

/**
 * R25-PR-A — Processes page client shell.
 *
 * PR-A wires the `<WorkspaceShell>` layout with a placeholder
 * canvas body. PR-B replaces the placeholder with the xyflow
 * canvas + top palette.
 */
import { WorkspaceShell } from "@/components/layout/WorkspaceShell";
import { Heading } from "@/components/ui/typography";
import { PageBreadcrumbs } from "@/components/layout/PageBreadcrumbs";

interface ProcessesClientProps {
    tenantSlug: string;
}

export function ProcessesClient({ tenantSlug }: ProcessesClientProps) {
    const tenantHref = (path: string) => `/t/${tenantSlug}${path}`;

    return (
        <WorkspaceShell className="animate-fadeIn">
            <WorkspaceShell.Header>
                <PageBreadcrumbs
                    items={[
                        { label: "Dashboard", href: tenantHref("/dashboard") },
                        { label: "Processes" },
                    ]}
                    className="mb-1"
                />
                <Heading level={1}>Processes</Heading>
                <p className="text-sm text-content-muted mt-1">
                    Map business and IT processes. Place controls on the
                    connections between steps.
                </p>
            </WorkspaceShell.Header>

            <WorkspaceShell.Toolbar
                className="border border-border-subtle rounded-[8px] px-3 py-2"
            >
                {/* PR-B replaces this placeholder with the process-step
                    palette. PR-A locks the toolbar slot's position
                    (above the canvas body, slim, restrained). */}
                <span className="text-xs text-content-muted">
                    Tool palette (PR-B)
                </span>
            </WorkspaceShell.Toolbar>

            <WorkspaceShell.Body className="border border-border-subtle rounded-[8px] bg-bg-default/30">
                {/* PR-B mounts the <ProcessCanvas> here (xyflow's
                    <ReactFlow> wrapped with IC token theming). The
                    placeholder communicates the intended visual
                    weight — canvas should dominate the viewport. */}
                <div
                    className="flex h-full min-h-[60vh] items-center justify-center text-sm text-content-muted"
                    data-testid="processes-canvas-placeholder"
                >
                    Canvas (PR-B)
                </div>
            </WorkspaceShell.Body>
        </WorkspaceShell>
    );
}
