'use client';

import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { useTenantSWR } from '@/lib/hooks/use-tenant-swr';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';
import { apiPost } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Plus, CalendarIcon } from '@/components/ui/icons/nucleo';
import { Tooltip } from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/hooks';
import { createColumns } from '@/components/ui/table';
import { EntityListPage } from '@/components/layout/EntityListPage';
import { EmptyState } from '@/components/ui/empty-state';
import { AgStatusBadge } from '@/components/ag/ag-status';
import { Modal } from '@/components/ui/modal';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { DatePicker } from '@/components/ui/date-picker';
import { formatDate } from '@/lib/format-date';

interface SeasonRow {
    id: string;
    name: string;
    status: string;
    startDate: string;
    endDate: string;
    _count?: { cropPlans?: number };
}

interface SeasonsClientProps {
    initialSeasons: SeasonRow[];
    tenantSlug: string;
    permissions: { canWrite: boolean };
}

const STATUS_OPTIONS: ComboboxOption[] = [
    { value: 'PLANNING', label: 'Planning' },
    { value: 'ACTIVE', label: 'Active' },
    { value: 'CLOSED', label: 'Closed' },
];

export function SeasonsClient({ initialSeasons, tenantSlug, permissions }: SeasonsClientProps) {
    const tenantHref = (path: string) => `/t/${tenantSlug}${path}`;
    const buildUrl = useTenantApiUrl();
    const toast = useToast();
    const [isCreateOpen, setIsCreateOpen] = useState(false);

    // Season-wide БАБХ ДНЕВНИК — one combined diary across every location with
    // completed ops in the season (one section-set per location, page-break
    // between). Backend: POST /reports/season-diary?seasonId=… streams the PDF.
    const downloadSeasonDiary = useCallback(
        async (season: SeasonRow) => {
            try {
                const res = await fetch(buildUrl(`/reports/season-diary?seasonId=${season.id}`), {
                    method: 'POST',
                });
                if (!res.ok) throw new Error('season diary failed');
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `dnevnik-season-${season.name.replace(/\s+/g, '_')}.pdf`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            } catch {
                toast.error('Неуспешно генериране на дневника за сезона.');
            }
        },
        [buildUrl, toast],
    );

    const seasonsSWR = useTenantSWR<SeasonRow[]>('/planning/seasons', {
        fallbackData: initialSeasons,
    });
    const seasons = seasonsSWR.data ?? [];
    const loading = seasonsSWR.isLoading && !seasonsSWR.data;

    const columns = useMemo(
        () =>
            createColumns<SeasonRow>([
                {
                    accessorKey: 'name',
                    header: 'Season',
                    cell: ({ getValue }) => (
                        <span className="text-sm text-content-emphasis">{getValue() as string}</span>
                    ),
                },
                {
                    id: 'window',
                    header: 'Window',
                    accessorFn: (s) => s.startDate,
                    cell: ({ row }) => (
                        <span className="text-xs text-content-muted">
                            {formatDate(row.original.startDate)} – {formatDate(row.original.endDate)}
                        </span>
                    ),
                    meta: { disableTruncate: true },
                },
                {
                    id: 'plans',
                    header: 'Plans',
                    accessorFn: (s) => s._count?.cropPlans ?? 0,
                    cell: ({ getValue }) => (
                        <span className="text-xs text-content-muted tabular-nums">{getValue() as number}</span>
                    ),
                },
                {
                    accessorKey: 'status',
                    header: 'Status',
                    cell: ({ row }) => (
                        <AgStatusBadge entity="season" status={row.original.status} />
                    ),
                },
                {
                    id: 'actions',
                    header: '',
                    enableHiding: false,
                    cell: ({ row }) => (
                        <div className="flex items-center justify-end gap-tight">
                            <Tooltip content="Дневник (PDF) за сезона">
                                <button
                                    type="button"
                                    aria-label="Дневник (PDF)"
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-content-muted hover:bg-bg-muted hover:text-content-emphasis"
                                    data-testid={`season-diary-${row.original.id}`}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        void downloadSeasonDiary(row.original);
                                    }}
                                >
                                    <CalendarIcon className="h-3.5 w-3.5" aria-hidden />
                                </button>
                            </Tooltip>
                        </div>
                    ),
                },
            ]),
        [downloadSeasonDiary],
    );

    return (
        <EntityListPage<SeasonRow>
            className="animate-fadeIn gap-section"
            header={{
                breadcrumbs: [
                    { label: 'Dashboard', href: tenantHref('/dashboard') },
                    { label: 'Planting', href: tenantHref('/planning') },
                    { label: 'Seasons' },
                ],
                title: 'Seasons',
                description: 'Planting season windows — each crop plan belongs to a season.',
                actions: permissions.canWrite ? (
                    <Button
                        variant="primary"
                        icon={<Plus className="-ml-0.5 -mr-2.5" />}
                        onClick={() => setIsCreateOpen(true)}
                        id="new-season-btn"
                    >
                        Season
                    </Button>
                ) : null,
            }}
            table={{
                data: seasons,
                columns,
                loading,
                getRowId: (s) => s.id,
                emptyState: (
                    <EmptyState
                        size="sm"
                        variant="no-records"
                        title="No seasons yet"
                        description="Create a season window to start planning crop successions."
                        primaryAction={
                            permissions.canWrite
                                ? { label: 'Add season', onClick: () => setIsCreateOpen(true) }
                                : undefined
                        }
                    />
                ),
                resourceName: (p) => (p ? 'seasons' : 'season'),
                'data-testid': 'seasons-table',
                className: 'hover:bg-bg-muted',
            }}
        >
            {permissions.canWrite && (
                <NewSeasonModal
                    open={isCreateOpen}
                    setOpen={setIsCreateOpen}
                    onSaved={() => void seasonsSWR.mutate()}
                />
            )}
        </EntityListPage>
    );
}

function NewSeasonModal({
    open,
    setOpen,
    onSaved,
}: {
    open: boolean;
    setOpen: Dispatch<SetStateAction<boolean>>;
    onSaved?: () => void;
}) {
    const buildUrl = useTenantApiUrl();
    const [name, setName] = useState('');
    const [status, setStatus] = useState('PLANNING');
    const [startDate, setStartDate] = useState<Date | null>(new Date());
    const [endDate, setEndDate] = useState<Date | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const canSubmit = name.trim().length > 0 && startDate && endDate && !submitting;

    const submit = async () => {
        if (!canSubmit || !startDate || !endDate) return;
        setSubmitting(true);
        setError(null);
        try {
            await apiPost(buildUrl('/planning/seasons'), {
                name: name.trim(),
                status,
                startDate: startDate.toISOString(),
                endDate: endDate.toISOString(),
                year: startDate.getUTCFullYear(),
            });
            setName('');
            setStatus('PLANNING');
            setStartDate(new Date());
            setEndDate(null);
            setOpen(false);
            onSaved?.();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to create season');
        } finally {
            setSubmitting(false);
        }
    };

    const heading = 'New season';
    const description = 'Define a planting season window.';

    return (
        <Modal
            showModal={open}
            setShowModal={setOpen}
            size="md"
            title={heading}
            description={description}
            preventDefaultClose={submitting}
        >
            <Modal.Header title={heading} description={description} />
            <Modal.Form
                id="season-form"
                onSubmit={(e) => {
                    e.preventDefault();
                    void submit();
                }}
            >
                <Modal.Body>
                    {error && (
                        <div
                            className="mb-4 rounded-lg border border-border-error bg-bg-error px-3 py-2 text-sm text-content-error"
                            id="season-error"
                            role="alert"
                        >
                            {error}
                        </div>
                    )}
                    <fieldset disabled={submitting} className="m-0 p-0 border-0 space-y-default">
                        <FormField label="Name" required>
                            <Input
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="e.g. 2026 Main Season"
                                id="season-name"
                            />
                        </FormField>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-default">
                            <FormField label="Start" required>
                                <DatePicker value={startDate} onChange={setStartDate} placeholder="Start date" />
                            </FormField>
                            <FormField label="End" required>
                                <DatePicker value={endDate} onChange={setEndDate} placeholder="End date" />
                            </FormField>
                            <FormField label="Status">
                                <Combobox
                                    options={STATUS_OPTIONS}
                                    selected={STATUS_OPTIONS.find((o) => o.value === status) ?? null}
                                    setSelected={(o) => setStatus(o?.value ?? 'PLANNING')}
                                    aria-label="Season status"
                                    matchTriggerWidth
                                />
                            </FormField>
                        </div>
                    </fieldset>
                </Modal.Body>
                <Modal.Actions>
                    <Button
                        variant="secondary"
                        size="sm"
                        type="button"
                        onClick={() => setOpen(false)}
                        disabled={submitting}
                        id="season-cancel"
                    >
                        Cancel
                    </Button>
                    <Button
                        type="submit"
                        variant="primary"
                        size="sm"
                        disabled={!canSubmit}
                        loading={submitting}
                        id="season-submit"
                    >
                        Create season
                    </Button>
                </Modal.Actions>
            </Modal.Form>
        </Modal>
    );
}
