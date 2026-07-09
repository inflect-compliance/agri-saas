'use client';

/**
 * Farm Tasks — the operator's field-work queue.
 *
 * Lists GET /farm-tasks (FARM_TASK + FIELD_OPERATION assigned to the caller,
 * soonest-due first) and offers a create modal that POSTs /farm-tasks. A
 * farm task is a thin discriminator over the IC Task module: its
 * LiteFarm-catalog type + category ride in `Task.metadataJson`, and it links
 * to Locations / Equipment via TaskLink.
 *
 * Mirrors the Journal list page: `EntityListPage` shell + `<Combobox>` /
 * `<UserCombobox>` / `<DatePicker>` pickers inside a `<Modal>`.
 *
 * Parcels: the create API accepts `parcelIds`, but the parcel picker is
 * intentionally omitted here — the `/locations/{id}/parcels` endpoint returns
 * a GeoJSON `{ locationId, bounds, parcels }` envelope keyed per location,
 * not a flat `{ id, name }[]`, so wiring a multi-location parcel picker would
 * add disproportionate complexity for an optional field. Location +
 * equipment links cover the common case.
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTenantSWR } from '@/lib/hooks/use-tenant-swr';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';
import { apiPost } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Plus } from '@/components/ui/icons/nucleo';
import { Fab } from '@/components/ui/fab';
import { createColumns } from '@/components/ui/table';
import { EntityListPage } from '@/components/layout/EntityListPage';
import { EmptyState } from '@/components/ui/empty-state';
import { Modal } from '@/components/ui/modal';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { UserCombobox } from '@/components/ui/user-combobox';
import { DatePicker } from '@/components/ui/date-picker';
import { StatusBadge, type StatusBadgeVariant } from '@/components/ui/status-badge';
import { formatDate } from '@/lib/format-date';
import {
    FARM_TASK_TYPES,
    FARM_TASK_CATEGORIES,
    getFarmTaskType,
} from '@/lib/agriculture/farm-task-types';

/**
 * Farm-queue row. The fields the backend's task-list select actually returns
 * plus `priority` / `metadataJson`, both typed optional so the column
 * degrades gracefully if a given row omits them.
 */
interface FarmTaskRow {
    id: string;
    title: string;
    type: string;
    status: string;
    dueAt: string | null;
    createdAt: string;
    priority?: string | null;
    assignee: { id: string; name: string | null; email: string } | null;
    metadataJson?: { farmTaskType?: string; farmTaskCategory?: string } | null;
}

interface EquipmentRow {
    id: string;
    name: string;
    category: string;
    make: string | null;
    model: string | null;
}

interface LocationRow {
    id: string;
    name: string;
}

type Priority = 'P0' | 'P1' | 'P2' | 'P3';

/** Work-item status → badge tone, matching the IC Tasks list page. */
const STATUS_BADGE: Record<string, StatusBadgeVariant> = {
    OPEN: 'neutral',
    TRIAGED: 'info',
    IN_PROGRESS: 'info',
    BLOCKED: 'error',
    RESOLVED: 'success',
    CLOSED: 'neutral',
    CANCELED: 'neutral',
};
/** Priority enum VALUES — labels localised at render via `taskEnums`. */
const PRIORITY_VALUES = ['P0', 'P1', 'P2', 'P3'];

// Task-type options ordered by category (categories in canonical order), so
// the list reads grouped; `optionDescription` surfaces each option's category
// label. The Combobox primitive has no native section headers, so this is the
// faithful "grouped / labelled by category" rendering it supports.
const TYPE_BY_VALUE = new Map(FARM_TASK_TYPES.map((t) => [t.key, t]));
const TYPE_OPTIONS: ComboboxOption[] = FARM_TASK_CATEGORIES.flatMap((cat) =>
    FARM_TASK_TYPES.filter((t) => t.category === cat).map((t) => ({
        value: t.key,
        label: t.name,
    })),
);

/**
 * Resolve a row's farm-task type to its catalog display name. Farm-task
 * catalog names come from `farm-task-types` (already localised there);
 * the fallback work-item type (e.g. FIELD_OPERATION) is localised via the
 * `taskEnums` translator passed in by the client component.
 */
function resolveTaskTypeName(
    row: FarmTaskRow,
    typeLabel: (type: string) => string,
): string {
    const key = row.metadataJson?.farmTaskType;
    if (key) {
        const def = getFarmTaskType(key);
        if (def) return def.name;
    }
    return typeLabel(row.type);
}

export function FarmTasksClient({ tenantSlug }: { tenantSlug: string }) {
    const buildUrl = useTenantApiUrl();
    const tenantHref = (path: string) => `/t/${tenantSlug}${path}`;
    const router = useRouter();
    const t = useTranslations('farmTasks');
    const te = useTranslations('taskEnums');
    const statusLabel = (s: string) => (te.has(`status.${s}`) ? te(`status.${s}`) : s);
    const typeLabel = (ty: string) => (te.has(`type.${ty}`) ? te(`type.${ty}`) : ty.replace(/_/g, ' '));
    const categoryLabel = (c: string) => (te.has(`category.${c}`) ? te(`category.${c}`) : c);
    const PRIORITY_OPTIONS: ComboboxOption[] = PRIORITY_VALUES.map((v) => ({ value: v, label: te(`priority.${v}`) }));

    const { data: tasks, mutate, isLoading } = useTenantSWR<FarmTaskRow[]>('/farm-tasks');

    // Create-modal state.
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [title, setTitle] = useState('');
    const [farmTaskType, setFarmTaskType] = useState('');
    const [priority, setPriority] = useState<Priority>('P2');
    const [dueAt, setDueAt] = useState<Date | null>(null);
    const [assigneeUserId, setAssigneeUserId] = useState<string | null>(null);
    const [locationIds, setLocationIds] = useState<string[]>([]);
    const [equipmentIds, setEquipmentIds] = useState<string[]>([]);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Locations are fetched up-front (small list) — the create-modal picker
    // AND the FAB (which jumps to the first field's parcel map) both need them.
    const { data: locations } = useTenantSWR<LocationRow[]>('/locations');
    // Equipment is only needed inside the modal, so stays lazy.
    const { data: equipment } = useTenantSWR<EquipmentRow[]>(isCreateOpen ? '/equipment' : null);

    // The FAB ("Start Field Operation") jumps straight to a field's parcel
    // map — where a spray/field operation begins by selecting parcels. Uses
    // the first field; falls back to the fields list when none exist yet.
    const goToFieldMap = () => {
        const first = locations?.[0];
        router.push(first ? tenantHref(`/locations/${first.id}?tab=map`) : tenantHref('/locations'));
    };

    const locationOptions: ComboboxOption[] = useMemo(
        () => (locations ?? []).map((l) => ({ value: l.id, label: l.name })),
        [locations],
    );
    const equipmentOptions: ComboboxOption[] = useMemo(
        () =>
            (equipment ?? []).map((e) => ({
                value: e.id,
                label: [e.name, [e.make, e.model].filter(Boolean).join(' ')]
                    .filter(Boolean)
                    .join(' · '),
            })),
        [equipment],
    );

    const resetForm = () => {
        setTitle('');
        setFarmTaskType('');
        setPriority('P2');
        setDueAt(null);
        setAssigneeUserId(null);
        setLocationIds([]);
        setEquipmentIds([]);
        setError(null);
    };

    const openCreate = () => {
        resetForm();
        setIsCreateOpen(true);
    };

    const canSubmit = title.trim().length > 0 && farmTaskType.length > 0 && !submitting;

    const submit = async () => {
        setSubmitting(true);
        setError(null);
        try {
            await apiPost(buildUrl('/farm-tasks'), {
                title: title.trim(),
                farmTaskType,
                priority,
                dueAt: dueAt ? dueAt.toISOString() : null,
                assigneeUserId: assigneeUserId || null,
                locationIds,
                equipmentIds,
            });
            setIsCreateOpen(false);
            resetForm();
            await mutate();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to create task');
        } finally {
            setSubmitting(false);
        }
    };

    const columns = useMemo(
        () =>
            createColumns<FarmTaskRow>([
                {
                    accessorKey: 'title',
                    header: t('colTitle'),
                    cell: ({ row }) => (
                        <span className="font-medium text-content-emphasis">{row.original.title}</span>
                    ),
                    // Mobile (<sm) card heading.
                    meta: { mobileCard: { slot: 'title' } },
                },
                {
                    id: 'taskType',
                    header: t('colTaskType'),
                    accessorFn: (t) => resolveTaskTypeName(t, typeLabel),
                    cell: ({ getValue }) => (
                        <span className="text-content-secondary">{getValue() as string}</span>
                    ),
                    // Mobile card secondary line — the field-work type.
                    meta: { mobileCard: { slot: 'subtitle' } },
                },
                {
                    id: 'dueAt',
                    header: t('colDue'),
                    accessorFn: (row) => row.dueAt,
                    cell: ({ row }) =>
                        row.original.dueAt ? (
                            <span className="text-xs text-content-muted">
                                {formatDate(row.original.dueAt)}
                            </span>
                        ) : (
                            <span className="text-content-subtle">—</span>
                        ),
                    // Mobile card key/value row — when the field work is due.
                    meta: { disableTruncate: true, mobileCard: { slot: 'meta', label: t('colDue') } },
                },
                {
                    accessorKey: 'status',
                    header: t('colStatus'),
                    cell: ({ row }) => (
                        <StatusBadge variant={STATUS_BADGE[row.original.status] ?? 'neutral'} size="sm">
                            {statusLabel(row.original.status)}
                        </StatusBadge>
                    ),
                    // Mobile card status pill (top-right).
                    meta: { mobileCard: { slot: 'status' } },
                },
                {
                    id: 'assignee',
                    header: t('colAssignee'),
                    accessorFn: (row) => row.assignee?.name ?? row.assignee?.email ?? '—',
                    cell: ({ getValue }) => (
                        <span className="text-xs text-content-muted">{getValue() as string}</span>
                    ),
                },
            ]),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [t, te],
    );

    const rows = tasks ?? [];

    return (
        <EntityListPage<FarmTaskRow>
            className="animate-fadeIn gap-section"
            header={{
                breadcrumbs: [
                    { label: t('dashboard'), href: tenantHref('/dashboard') },
                    { label: t('breadcrumb') },
                ],
                title: t('title'),
                description: t('description'),
                actions: (
                    <Button
                        variant="primary"
                        icon={<Plus className="-ml-0.5 -mr-2.5" />}
                        onClick={openCreate}
                        id="new-farm-task-btn"
                    >
                        {t('addTask')}
                    </Button>
                ),
            }}
            table={{
                data: rows,
                columns,
                loading: isLoading && !tasks,
                getRowId: (t) => t.id,
                // <sm: render each row as a tappable card. Farm tasks have
                // no per-row detail route, so the card is non-clickable
                // (no onRowClick) — it surfaces title / type / due / status
                // at a glance for the operator's field queue.
                mobileFallback: 'card',
                emptyState: (
                    <EmptyState
                        size="sm"
                        variant="no-records"
                        title={t('emptyTitle')}
                        description={t('emptyDescription')}
                        primaryAction={{ label: t('emptyAction'), onClick: openCreate }}
                    />
                ),
                resourceName: (p) => (p ? 'tasks' : 'task'),
                'data-testid': 'farm-tasks-table',
                className: 'hover:bg-bg-muted',
            }}
        >
            <Fab
                onClick={goToFieldMap}
                label={t('startFieldOperation')}
                icon={<Plus aria-hidden className="h-6 w-6" />}
            />
            <Modal
                showModal={isCreateOpen}
                setShowModal={setIsCreateOpen}
                size="lg"
                title={t('modalTitle')}
                description={t('modalDescription')}
                preventDefaultClose={submitting}
                isDirty={
                    title.trim().length > 0 ||
                    farmTaskType.length > 0 ||
                    dueAt !== null ||
                    assigneeUserId !== null ||
                    locationIds.length > 0 ||
                    equipmentIds.length > 0
                }
            >
                <Modal.Header
                    title={t('modalTitle')}
                    description={t('modalDescription')}
                />
                <Modal.Form
                    id="farm-task-form"
                    onSubmit={(e) => {
                        e.preventDefault();
                        void submit();
                    }}
                >
                    <Modal.Body>
                        {error && (
                            <div
                                role="alert"
                                id="farm-task-error"
                                className="mb-4 rounded-lg border border-border-error bg-bg-error px-3 py-2 text-sm text-content-error"
                            >
                                {error}
                            </div>
                        )}
                        <fieldset disabled={submitting} className="m-0 p-0 border-0 space-y-default">
                            <FormField label={t('fieldTitle')} required>
                                <Input
                                    id="farm-task-title"
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    placeholder={t('titlePlaceholder')}
                                />
                            </FormField>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-default">
                                <FormField label={t('fieldTaskType')} required>
                                    <Combobox
                                        id="farm-task-type"
                                        options={TYPE_OPTIONS}
                                        selected={TYPE_OPTIONS.find((o) => o.value === farmTaskType) ?? null}
                                        setSelected={(o) => setFarmTaskType(o?.value ?? '')}
                                        optionDescription={(o) => {
                                            const def = TYPE_BY_VALUE.get(o.value);
                                            return def ? categoryLabel(def.category) : null;
                                        }}
                                        placeholder={t('taskTypePlaceholder')}
                                        searchPlaceholder={t('taskTypeSearch')}
                                        aria-label={t('taskTypeAria')}
                                        matchTriggerWidth
                                    />
                                </FormField>
                                <FormField label={t('fieldPriority')}>
                                    <Combobox
                                        id="farm-task-priority"
                                        options={PRIORITY_OPTIONS}
                                        selected={PRIORITY_OPTIONS.find((o) => o.value === priority) ?? null}
                                        setSelected={(o) => setPriority((o?.value as Priority) ?? 'P2')}
                                        placeholder={t('priorityPlaceholder')}
                                        hideSearch
                                        aria-label={t('priorityAria')}
                                        matchTriggerWidth
                                    />
                                </FormField>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-default">
                                <FormField label={t('fieldDueDate')}>
                                    <DatePicker
                                        id="farm-task-due"
                                        className="w-full"
                                        value={dueAt}
                                        onChange={setDueAt}
                                        clearable
                                        placeholder={t('datePlaceholder')}
                                        aria-label={t('dueDateAria')}
                                    />
                                </FormField>
                                <FormField label={t('fieldAssignee')}>
                                    <UserCombobox
                                        id="farm-task-assignee"
                                        tenantSlug={tenantSlug}
                                        selectedId={assigneeUserId}
                                        onChange={(userId) => setAssigneeUserId(userId)}
                                        placeholder={t('unassigned')}
                                        forceDropdown={false}
                                    />
                                </FormField>
                            </div>

                            <FormField label={t('fieldLocations')}>
                                <Combobox
                                    id="farm-task-locations"
                                    multiple
                                    options={locationOptions}
                                    selected={locationOptions.filter((o) => locationIds.includes(o.value))}
                                    setSelected={(opts) => setLocationIds(opts.map((o) => o.value))}
                                    placeholder={locationOptions.length ? t('locationsPlaceholder') : t('locationsEmpty')}
                                    aria-label={t('locationsAria')}
                                    matchTriggerWidth
                                />
                            </FormField>

                            <FormField label={t('fieldEquipment')}>
                                <Combobox
                                    id="farm-task-equipment"
                                    multiple
                                    options={equipmentOptions}
                                    selected={equipmentOptions.filter((o) => equipmentIds.includes(o.value))}
                                    setSelected={(opts) => setEquipmentIds(opts.map((o) => o.value))}
                                    placeholder={equipmentOptions.length ? t('equipmentPlaceholder') : t('equipmentEmpty')}
                                    aria-label={t('equipmentAria')}
                                    matchTriggerWidth
                                />
                            </FormField>
                        </fieldset>
                    </Modal.Body>
                    <Modal.Actions>
                        <Button
                            variant="secondary"
                            size="sm"
                            type="button"
                            onClick={() => setIsCreateOpen(false)}
                            disabled={submitting}
                            id="farm-task-cancel"
                        >
                            {t('cancel')}
                        </Button>
                        <Button
                            variant="primary"
                            size="sm"
                            type="submit"
                            loading={submitting}
                            disabled={!canSubmit}
                            id="farm-task-submit"
                        >
                            {t('create')}
                        </Button>
                    </Modal.Actions>
                </Modal.Form>
            </Modal>
        </EntityListPage>
    );
}
