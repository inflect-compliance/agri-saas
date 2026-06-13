'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useTenantSWR } from '@/lib/hooks/use-tenant-swr';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';
import { apiPost } from '@/lib/api-client';
import { ListPageShell } from '@/components/layout/ListPageShell';
import { DataTable, createColumns } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';

interface LocationItem {
    id: string;
    name: string;
    description?: string | null;
    status: string;
    _count?: { parcels?: number };
}

export function LocationsClient({ tenantSlug }: { tenantSlug: string }) {
    const buildUrl = useTenantApiUrl();
    const { data, mutate, isLoading } = useTenantSWR<LocationItem[]>('/locations');
    const [showNew, setShowNew] = useState(false);
    const [name, setName] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const create = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
            await apiPost(buildUrl('/locations'), { name });
            setShowNew(false);
            setName('');
            await mutate();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to create location');
        } finally {
            setBusy(false);
        }
    };

    const columns = useMemo(
        () => createColumns<LocationItem>([
            {
                accessorKey: 'name',
                header: 'Name',
                cell: ({ row }) => (
                    <Link
                        href={`/t/${tenantSlug}/locations/${row.original.id}`}
                        className="font-medium text-content-link hover:underline"
                    >
                        {row.original.name}
                    </Link>
                ),
            },
            { accessorKey: 'status', header: 'Status' },
            {
                id: 'parcels',
                header: 'Parcels',
                cell: ({ row }) => row.original._count?.parcels ?? 0,
            },
        ]),
        [tenantSlug],
    );

    const rows = data ?? [];

    return (
        <ListPageShell className="gap-section">
            <ListPageShell.Header>
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-xl font-semibold">Locations</h1>
                        <p className="text-sm text-content-secondary">Field blocks and their parcels.</p>
                    </div>
                    <Button variant="primary" size="sm" onClick={() => setShowNew(true)}>New location</Button>
                </div>
            </ListPageShell.Header>
            <ListPageShell.Body>
                <DataTable
                    fillBody
                    data-testid="locations-table"
                    data={rows}
                    columns={columns}
                    loading={isLoading && !data}
                    getRowId={(l) => l.id}
                    emptyState={(
                        <EmptyState
                            size="sm"
                            variant="no-records"
                            title="No locations yet"
                            description="Create one, then import a shapefile, KML, or GeoJSON to populate parcels."
                        />
                    )}
                />
            </ListPageShell.Body>

            <Modal showModal={showNew} setShowModal={setShowNew} size="md" title="New location" description="Create a field block.">
                <Modal.Header title="New location" description="Create a field block; import parcels next." />
                <Modal.Form id="new-location-form" onSubmit={create}>
                    <Modal.Body>
                        {error && (
                            <div role="alert" className="mb-4 rounded-lg border border-border-error bg-bg-error px-3 py-2 text-sm text-content-error">
                                {error}
                            </div>
                        )}
                        <FormField label="Name" required>
                            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Home Farm" />
                        </FormField>
                    </Modal.Body>
                    <Modal.Actions>
                        <Button variant="secondary" size="sm" type="button" onClick={() => setShowNew(false)}>Cancel</Button>
                        <Button variant="primary" size="sm" type="submit" loading={busy} disabled={!name || busy}>Create</Button>
                    </Modal.Actions>
                </Modal.Form>
            </Modal>
        </ListPageShell>
    );
}
