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
import { useTenantSWR } from '@/lib/hooks/use-tenant-swr';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';
import { apiPost } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Plus } from '@/components/ui/icons/nucleo';
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
const STATUS_LABELS: Record<string, string> = {
    OPEN: 'Open',
    TRIAGED: 'Triaged',
    IN_PROGRESS: 'In Progress',
    BLOCKED: 'Blocked',
    RESOLVED: 'Resolved',
    CLOSED: 'Closed',
    CANCELED: 'Canceled',
};

/** Human label for a farm-task category enum value (TitleCase). */
const CATEGORY_LABELS: Record<string, string> = {
    LAND_PREP: 'Land prep',
    PLANTING: 'Planting',
    CROP_CARE: 'Crop care',
    PEST_DISEASE: 'Pest & disease',
    IRRIGATION: 'Irrigation',
    HARVEST: 'Harvest',
    POST_HARVEST: 'Post-harvest',
    LIVESTOCK: 'Livestock',
    MAINTENANCE: 'Maintenance',
    RECORDKEEPING: 'Recordkeeping',
    OTHER: 'Other',
};

const PRIORITY_OPTIONS: ComboboxOption[] = [
    { value: 'P0', label: 'P0 — Critical' },
    { value: 'P1', label: 'P1 — High' },
    { value: 'P2', label: 'P2 — Medium' },
    { value: 'P3', label: 'P3 — Low' },
];

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

/** Resolve a row's farm-task type to its catalog display name. */
function resolveTaskTypeName(row: FarmTaskRow): string {
    const key = row.metadataJson?.farmTaskType;
    if (key) {
        const def = getFarmTaskType(key);
        if (def) return def.name;
    }
    // Fall back to the raw work-item type (e.g. FIELD_OPERATION) prettified.
    return row.type.replace(/_/g, ' ');
}

export function FarmTasksClient({ tenantSlug }: { tenantSlug: string }) {
    const buildUrl = useTenantApiUrl();
    const tenantHref = (path: string) => `/t/${tenantSlug}${path}`;

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

    // Picker catalogs — fetched only while the modal is open.
    const { data: locations } = useTenantSWR<LocationRow[]>(isCreateOpen ? '/locations' : null);
    const { data: equipment } = useTenantSWR<EquipmentRow[]>(isCreateOpen ? '/equipment' : null);

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
                    header: 'Title',
                    cell: ({ row }) => (
                        <span className="font-medium text-content-emphasis">{row.original.title}</span>
                    ),
                },
                {
                    id: 'taskType',
                    header: 'Task type',
                    accessorFn: (t) => resolveTaskTypeName(t),
                    cell: ({ getValue }) => (
                        <span className="text-content-secondary">{getValue() as string}</span>
                    ),
                },
                {
                    id: 'dueAt',
                    header: 'Due',
                    accessorFn: (t) => t.dueAt,
                    cell: ({ row }) =>
                        row.original.dueAt ? (
                            <span className="text-xs text-content-muted">
                                {formatDate(row.original.dueAt)}
                            </span>
                        ) : (
                            <span className="text-content-subtle">—</span>
                        ),
                    meta: { disableTruncate: true },
                },
                {
                    accessorKey: 'status',
                    header: 'Status',
                    cell: ({ row }) => (
                        <StatusBadge variant={STATUS_BADGE[row.original.status] ?? 'neutral'} size="sm">
                            {STATUS_LABELS[row.original.status] ?? row.original.status}
                        </StatusBadge>
                    ),
                },
                {
                    id: 'assignee',
                    header: 'Assignee',
                    accessorFn: (t) => t.assignee?.name ?? t.assignee?.email ?? '—',
                    cell: ({ getValue }) => (
                        <span className="text-xs text-content-muted">{getValue() as string}</span>
                    ),
                },
            ]),
        [],
    );

    const rows = tasks ?? [];

    return (
        <EntityListPage<FarmTaskRow>
            className="animate-fadeIn gap-section"
            header={{
                breadcrumbs: [
                    { label: 'Dashboard', href: tenantHref('/dashboard') },
                    { label: 'Farm Tasks' },
                ],
                title: 'Farm Tasks',
                description: 'Your field-work queue — assigned farm tasks and operations, soonest-due first.',
                actions: (
                    <Button
                        variant="primary"
                        icon={<Plus className="-ml-0.5 -mr-2.5" />}
                        onClick={openCreate}
                        id="new-farm-task-btn"
                    >
                        Task
                    </Button>
                ),
            }}
            table={{
                data: rows,
                columns,
                loading: isLoading && !tasks,
                getRowId: (t) => t.id,
                emptyState: (
                    <EmptyState
                        size="sm"
                        variant="no-records"
                        title="No farm tasks assigned"
                        description="Create a farm task to plan field work — tillage, planting, scouting, irrigation, harvest — and assign it to an operator. Tasks assigned to you appear here, soonest-due first."
                        primaryAction={{ label: 'Add task', onClick: openCreate }}
                    />
                ),
                resourceName: (p) => (p ? 'tasks' : 'task'),
                'data-testid': 'farm-tasks-table',
                className: 'hover:bg-bg-muted',
            }}
        >
            <Modal
                showModal={isCreateOpen}
                setShowModal={setIsCreateOpen}
                size="lg"
                title="New farm task"
                description="Plan field work and assign it to an operator."
                preventDefaultClose={submitting}
            >
                <Modal.Header
                    title="New farm task"
                    description="Plan field work and assign it to an operator."
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
                            <FormField label="Title" required>
                                <Input
                                    id="farm-task-title"
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    placeholder="e.g. Scout the north block for aphids"
                                />
                            </FormField>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-default">
                                <FormField label="Task type" required>
                                    <Combobox
                                        id="farm-task-type"
                                        options={TYPE_OPTIONS}
                                        selected={TYPE_OPTIONS.find((o) => o.value === farmTaskType) ?? null}
                                        setSelected={(o) => setFarmTaskType(o?.value ?? '')}
                                        optionDescription={(o) => {
                                            const def = TYPE_BY_VALUE.get(o.value);
                                            return def ? CATEGORY_LABELS[def.category] ?? def.category : null;
                                        }}
                                        placeholder="Select task type"
                                        searchPlaceholder="Search task types…"
                                        aria-label="Task type"
                                        matchTriggerWidth
                                    />
                                </FormField>
                                <FormField label="Priority">
                                    <Combobox
                                        id="farm-task-priority"
                                        options={PRIORITY_OPTIONS}
                                        selected={PRIORITY_OPTIONS.find((o) => o.value === priority) ?? null}
                                        setSelected={(o) => setPriority((o?.value as Priority) ?? 'P2')}
                                        placeholder="Select priority"
                                        hideSearch
                                        aria-label="Priority"
                                        matchTriggerWidth
                                    />
                                </FormField>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-default">
                                <FormField label="Due date">
                                    <DatePicker
                                        id="farm-task-due"
                                        className="w-full"
                                        value={dueAt}
                                        onChange={setDueAt}
                                        clearable
                                        placeholder="Select date"
                                        aria-label="Due date"
                                    />
                                </FormField>
                                <FormField label="Assignee">
                                    <UserCombobox
                                        id="farm-task-assignee"
                                        tenantSlug={tenantSlug}
                                        selectedId={assigneeUserId}
                                        onChange={(userId) => setAssigneeUserId(userId)}
                                        placeholder="Unassigned"
                                        forceDropdown={false}
                                    />
                                </FormField>
                            </div>

                            <FormField label="Locations">
                                <Combobox
                                    id="farm-task-locations"
                                    multiple
                                    options={locationOptions}
                                    selected={locationOptions.filter((o) => locationIds.includes(o.value))}
                                    setSelected={(opts) => setLocationIds(opts.map((o) => o.value))}
                                    placeholder={locationOptions.length ? 'Link field blocks' : 'No locations yet'}
                                    aria-label="Linked locations"
                                    matchTriggerWidth
                                />
                            </FormField>

                            <FormField label="Equipment">
                                <Combobox
                                    id="farm-task-equipment"
                                    multiple
                                    options={equipmentOptions}
                                    selected={equipmentOptions.filter((o) => equipmentIds.includes(o.value))}
                                    setSelected={(opts) => setEquipmentIds(opts.map((o) => o.value))}
                                    placeholder={equipmentOptions.length ? 'Link equipment' : 'No equipment yet'}
                                    aria-label="Linked equipment"
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
                            Cancel
                        </Button>
                        <Button
                            variant="primary"
                            size="sm"
                            type="submit"
                            loading={submitting}
                            disabled={!canSubmit}
                            id="farm-task-submit"
                        >
                            Create task
                        </Button>
                    </Modal.Actions>
                </Modal.Form>
            </Modal>
        </EntityListPage>
    );
}
