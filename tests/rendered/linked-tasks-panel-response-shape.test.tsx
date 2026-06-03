/**
 * Hotfix regression — LinkedTasksPanel must accept BOTH the legacy
 * raw-array response and the new `{ rows, truncated }` envelope from
 * `/api/t/<slug>/tasks` (introduced by PR #158).
 *
 * Without the defensive read, mounting the panel after the response
 * shape flipped crashed every detail page that includes it (risk,
 * control, vendor, asset) with `tasks.map is not a function`.
 *
 *   1. `{ rows: [...] }` — current shape; renders the rows.
 *   2. `[...]`            — legacy shape (older deploys); renders too.
 *   3. malformed payload  — degrades to the empty state, no crash.
 */
import * as React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

// The Tasks tab is now a <DataTable> whose row-click navigates via
// the Next app-router. LinkedTasksPanel also statically imports
// NewTaskModal, which pulls router hooks at module load. Mock
// next/navigation so the import resolves and useRouter() doesn't trip
// the "expected app router to be mounted" invariant under jsdom.
jest.mock('next/navigation', () => ({
    useRouter: () => ({
        push: jest.fn(),
        replace: jest.fn(),
        back: jest.fn(),
        forward: jest.fn(),
        refresh: jest.fn(),
        prefetch: jest.fn(),
    }),
    usePathname: () => '/t/acme/risks/r-1',
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({ tenantSlug: 'acme' }),
}));

// EditTaskModal (mounted when canWrite) reads the tenant API base +
// slug from the provider. Stub them so the modal mounts under jsdom.
jest.mock('@/lib/tenant-context-provider', () => ({
    useTenantApiUrl:
        () => (path: string) =>
            `/api/t/acme${path.startsWith('/') ? path : `/${path}`}`,
    useTenantContext: () => ({ tenantSlug: 'acme' }),
    useTenantHref: () => (path: string) => `/t/acme${path}`,
}));

import LinkedTasksPanel from '@/components/LinkedTasksPanel';

const tenantHref = (p: string) => `/t/acme${p}`;

function mountFetchWith(payload: unknown) {
    (global as unknown as { fetch: jest.Mock }).fetch = jest.fn(
        async () =>
            ({
                ok: true,
                json: async () => payload,
            }) as Response,
    );
}

afterEach(() => {
    jest.restoreAllMocks();
});

describe('LinkedTasksPanel — response-shape resilience', () => {
    it('renders rows from the modern { rows, truncated } envelope', async () => {
        mountFetchWith({
            rows: [
                {
                    id: 'task-1',
                    title: 'Triage finding',
                    status: 'OPEN',
                    severity: 'HIGH',
                    key: 'TSK-1',
                },
            ],
            truncated: false,
        });
        render(
            <LinkedTasksPanel
                apiBase="/api/t/acme"
                entityType="risk"
                entityId="r-1"
                tenantHref={tenantHref}
            />,
        );
        expect(await screen.findByText('Triage finding')).toBeInTheDocument();
    });

    it('still renders rows from the legacy raw-array shape', async () => {
        mountFetchWith([
            {
                id: 'task-2',
                title: 'Old shape task',
                status: 'OPEN',
                severity: 'MEDIUM',
                key: 'TSK-2',
            },
        ]);
        render(
            <LinkedTasksPanel
                apiBase="/api/t/acme"
                entityType="risk"
                entityId="r-1"
                tenantHref={tenantHref}
            />,
        );
        expect(await screen.findByText('Old shape task')).toBeInTheDocument();
    });

    it('falls back to the empty state on a malformed payload — no crash', async () => {
        mountFetchWith({ unexpected: 'shape' });
        render(
            <LinkedTasksPanel
                apiBase="/api/t/acme"
                entityType="risk"
                entityId="r-1"
                tenantHref={tenantHref}
            />,
        );
        await waitFor(() => {
            expect(screen.getByText(/no linked tasks/i)).toBeInTheDocument();
        });
    });

    // Phase 2 — per-row edit affordance. The pencil opens the task in
    // <EditTaskModal>. entityType "risk" (lowercase) is non-canonical,
    // so the create modal stays unmounted — this isolates the edit
    // button. Gated on canWrite.
    it('renders a per-row edit pencil when canWrite is set', async () => {
        mountFetchWith({
            rows: [
                {
                    id: 'task-9',
                    title: 'Editable task',
                    status: 'OPEN',
                    severity: 'LOW',
                    key: 'TSK-9',
                },
            ],
            truncated: false,
        });
        render(
            <LinkedTasksPanel
                apiBase="/api/t/acme"
                entityType="risk"
                entityId="r-1"
                tenantHref={tenantHref}
                canWrite
            />,
        );
        expect(await screen.findByText('Editable task')).toBeInTheDocument();
        expect(
            screen.getByTestId('linked-task-quick-edit-task-9'),
        ).toBeInTheDocument();
    });

    it('hides the edit pencil for read-only viewers (no canWrite)', async () => {
        mountFetchWith({
            rows: [
                {
                    id: 'task-10',
                    title: 'Read-only task',
                    status: 'OPEN',
                    severity: 'LOW',
                    key: 'TSK-10',
                },
            ],
            truncated: false,
        });
        render(
            <LinkedTasksPanel
                apiBase="/api/t/acme"
                entityType="risk"
                entityId="r-1"
                tenantHref={tenantHref}
            />,
        );
        expect(await screen.findByText('Read-only task')).toBeInTheDocument();
        expect(
            screen.queryByTestId('linked-task-quick-edit-task-10'),
        ).not.toBeInTheDocument();
    });
});
