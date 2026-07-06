'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useTenantSWR, usePrefetchTenant } from '@/lib/hooks/use-tenant-swr';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';
import { apiPost } from '@/lib/api-client';
import { ListPageShell } from '@/components/layout/ListPageShell';
import { PageBreadcrumbs } from '@/components/layout/PageBreadcrumbs';
import { DataTable, createColumns, useBulkDelete } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Heading } from '@/components/ui/typography';
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

export function LocationsClient({ tenantSlug, canAdmin = false }: { tenantSlug: string; canAdmin?: boolean }) {
    const t = useTranslations('locations');
    const tCommon = useTranslations('common');
    const buildUrl = useTenantApiUrl();
    const prefetchData = usePrefetchTenant();
    const { data, mutate, isLoading } = useTenantSWR<LocationItem[]>('/locations');

    const { batchAction: locationBulkDelete, dialog: locationDeleteDialog } =
        useBulkDelete<LocationItem>({
            entitySingular: 'location',
            entityPlural: 'locations',
            onDelete: async (ids) => {
                const res = await fetch(`/api/t/${tenantSlug}/locations/bulk/delete`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ locationIds: ids }),
                });
                if (!res.ok) throw new Error('Failed to delete locations');
                await mutate();
            },
        });
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
                header: t('colName'),
                cell: ({ row }) => (
                    <Link
                        href={`/t/${tenantSlug}/locations/${row.original.id}`}
                        className="font-medium text-content-link hover:underline"
                    >
                        {row.original.name}
                    </Link>
                ),
            },
            { accessorKey: 'status', header: t('colStatus') },
            {
                id: 'parcels',
                header: t('colParcels'),
                cell: ({ row }) => row.original._count?.parcels ?? 0,
            },
        ]),
        [tenantSlug, t],
    );

    const rows = data ?? [];

    return (
        <ListPageShell className="gap-section">
            <ListPageShell.Header>
                <div className="flex items-center justify-between">
                    <div>
                        <PageBreadcrumbs
                            items={[
                                { label: t('bcDashboard'), href: `/t/${tenantSlug}/dashboard` },
                                { label: t('bcLocations') },
                            ]}
                            className="mb-1"
                        />
                        <Heading level={1}>{t('title')}</Heading>
                        <p className="text-sm text-content-secondary">{t('description')}</p>
                    </div>
                    <Button variant="primary" size="sm" onClick={() => setShowNew(true)}>{t('newLocation')}</Button>
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
                    // Hover-warm the detail SWR cache (the row's title Link
                    // already prefetches the route) so list→detail is instant.
                    onRowPrefetch={(row) => prefetchData(`/locations/${row.original.id}`)}
                    batchActions={canAdmin ? [locationBulkDelete] : undefined}
                    emptyState={(
                        <EmptyState
                            size="sm"
                            variant="no-records"
                            title={t('emptyTitle')}
                            description={t('emptyDesc')}
                            primaryAction={{ label: t('newLocation'), onClick: () => setShowNew(true) }}
                        />
                    )}
                />
            </ListPageShell.Body>

            <Modal showModal={showNew} setShowModal={setShowNew} size="md" title={t('modalTitle')} description={t('modalDescription')}>
                <Modal.Header title={t('modalTitle')} description={t('modalHeaderDescription')} />
                <Modal.Form id="new-location-form" onSubmit={create}>
                    <Modal.Body>
                        {error && (
                            <div role="alert" className="mb-4 rounded-lg border border-border-error bg-bg-error px-3 py-2 text-sm text-content-error">
                                {error}
                            </div>
                        )}
                        <FormField label={t('fieldName')} required>
                            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('fieldNamePlaceholder')} />
                        </FormField>
                    </Modal.Body>
                    <Modal.Actions>
                        <Button variant="secondary" size="sm" type="button" onClick={() => setShowNew(false)}>{tCommon('cancel')}</Button>
                        <Button variant="primary" size="sm" type="submit" loading={busy} disabled={!name || busy}>{tCommon('create')}</Button>
                    </Modal.Actions>
                </Modal.Form>
            </Modal>

            {locationDeleteDialog}
        </ListPageShell>
    );
}
