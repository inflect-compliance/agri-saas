'use client';
/* eslint-disable @typescript-eslint/no-explicit-any -- Client component receiving server-rendered domain data; tanstack column callbacks; or library-boundary callbacks. Per-site narrowing requires generated DTOs / per-cell CellContext imports — out of scope for the lint cleanup PR. */
import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { Button } from '@/components/ui/button';
import { DataTable, createColumns } from '@/components/ui/table';
import { ListPageShell } from '@/components/layout/ListPageShell';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { DatePicker } from '@/components/ui/date-picker/date-picker';
import type { CappedList } from '@/lib/list-backfill-cap';
import { TruncationBanner } from '@/components/ui/TruncationBanner';
import {
    parseYMD,
    startOfUtcDay,
    toYMD,
} from '@/components/ui/date-picker/date-utils';
import { StatusBadge, type StatusBadgeVariant } from '@/components/ui/status-badge';
import { Heading } from '@/components/ui/typography';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';

const SEV_BADGE: Record<string, StatusBadgeVariant> = { LOW: 'info', MEDIUM: 'warning', HIGH: 'error', CRITICAL: 'error' };
const STATUS_BADGE: Record<string, StatusBadgeVariant> = { OPEN: 'error', IN_PROGRESS: 'info', READY_FOR_VERIFICATION: 'warning', CLOSED: 'success' };

interface FindingsClientProps {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    initialFindings: any[];
    tenantSlug: string;
    translations: {
        title: string;
        listDescription: string;
        open: string;
        newFinding: string;
        findingTitle: string;
        severity: string;
        type: string;
        owner: string;
        status: string;
        description: string;
        dueDate: string;
        createFinding: string;
        noFindings: string;
        low: string;
        medium: string;
        high: string;
        critical: string;
        nonconformity: string;
        observation: string;
        opportunity: string;
        inProgress: string;
        readyForVerification: string;
        closed: string;
        cancel: string;
        actions: string;
    };
}

/**
 * Client island for findings — handles create form and status updates.
 * Data is pre-fetched server-side and passed via props.
 */
export function FindingsClient({ initialFindings, tenantSlug, translations: t }: FindingsClientProps) {
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState({ title: '', description: '', severity: 'MEDIUM', type: 'OBSERVATION', owner: '', dueDate: '' });

    const apiUrl = (path: string) => `/api/t/${tenantSlug}${path}`;
    const queryClient = useQueryClient();

    // PR-5 — API returns `{ rows, truncated }`; SSR initial wraps
    // with `truncated: false` (SSR cap < backfill cap).
    const findingsQuery = useQuery<CappedList<any>>({
        queryKey: queryKeys.findings.list(tenantSlug),
        queryFn: async () => {
            const res = await fetch(apiUrl('/findings'));
            if (!res.ok) throw new Error('Failed to fetch findings');
            return res.json();
        },
        initialData: { rows: initialFindings, truncated: false },
    });
    const findings = findingsQuery.data?.rows ?? [];
    const truncated = findingsQuery.data?.truncated ?? false;

    const createMutation = useMutation({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mutationFn: async (newFinding: any) => {
            const res = await fetch(apiUrl('/findings'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newFinding) });
            if (!res.ok) throw new Error('Failed to create finding');
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.findings.all(tenantSlug) });
            setShowForm(false);
            setForm({ title: '', description: '', severity: 'MEDIUM', type: 'OBSERVATION', owner: '', dueDate: '' });
        }
    });

    const createFinding = (e: React.FormEvent) => {
        e.preventDefault();
        createMutation.mutate(form);
    };

    const statusMutation = useMutation({
        mutationFn: async ({ id, status }: { id: string, status: string }) => {
            const res = await fetch(apiUrl(`/findings/${id}`), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
            if (!res.ok) throw new Error('Failed to update status');
            return res.json();
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onMutate: async ({ id, status }: { id: string; status: string }) => {
            await queryClient.cancelQueries({ queryKey: queryKeys.findings.list(tenantSlug) });
            // PR-5 — cache value is now `CappedList<any>` not the bare array.
            const prev = queryClient.getQueryData<CappedList<any>>(queryKeys.findings.list(tenantSlug));
            if (prev) {
                queryClient.setQueryData<CappedList<any>>(
                    queryKeys.findings.list(tenantSlug),
                    {
                        ...prev,
                        rows: prev.rows.map((f: any) => (f.id === id ? { ...f, status } : f)),
                    },
                );
            }
            return { prev };
        },
        onError: (_err, _variables, context) => {
            if (context?.prev) {
                queryClient.setQueryData(queryKeys.findings.list(tenantSlug), context.prev);
            }
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.findings.list(tenantSlug) });
        }
    });

    const updateStatus = (id: string, status: string) => {
        statusMutation.mutate({ id, status });
    };

    const sevLabel = (sev: string) => {
        const map: Record<string, string> = { LOW: t.low, MEDIUM: t.medium, HIGH: t.high, CRITICAL: t.critical };
        return map[sev] || sev;
    };

    const typeLabel = (type: string) => {
        const map: Record<string, string> = { NONCONFORMITY: t.nonconformity, OBSERVATION: t.observation, OPPORTUNITY: t.opportunity };
        return map[type] || type;
    };

    const statusLabel = (status: string) => {
        const map: Record<string, string> = { OPEN: t.open, IN_PROGRESS: t.inProgress, READY_FOR_VERIFICATION: t.readyForVerification, CLOSED: t.closed };
        return map[status] || status;
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const findingColumns = useMemo(() => createColumns<any>([
        {
            accessorKey: 'title',
            header: t.findingTitle,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            cell: ({ getValue }: any) => <span className="font-medium text-content-emphasis text-sm">{getValue()}</span>,
        },
        {
            accessorKey: 'severity',
            header: t.severity,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            cell: ({ row }: any) => <StatusBadge variant={SEV_BADGE[row.original.severity]}>{sevLabel(row.original.severity)}</StatusBadge>,
        },
        {
            accessorKey: 'type',
            header: t.type,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            cell: ({ row }: any) => <span className="text-xs">{typeLabel(row.original.type)}</span>,
        },
        {
            id: 'owner',
            header: t.owner,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            accessorFn: (f: any) => f.owner || '—',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            cell: ({ getValue }: any) => <span className="text-xs">{getValue()}</span>,
        },
        {
            accessorKey: 'status',
            header: t.status,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            cell: ({ row }: any) => <StatusBadge variant={STATUS_BADGE[row.original.status]}>{statusLabel(row.original.status)}</StatusBadge>,
        },
        {
            id: 'actions',
            header: t.actions,
            enableHiding: false,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            cell: ({ row }: any) => {
                const f = row.original;
                return (
                    <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                        {f.status === 'OPEN' && <Button variant="secondary" size="sm" onClick={() => updateStatus(f.id, 'IN_PROGRESS')}>{t.inProgress}</Button>}
                        {f.status === 'IN_PROGRESS' && <Button variant="secondary" size="sm" onClick={() => updateStatus(f.id, 'READY_FOR_VERIFICATION')}>{t.readyForVerification}</Button>}
                        {f.status === 'READY_FOR_VERIFICATION' && <Button variant="primary" size="sm" onClick={() => updateStatus(f.id, 'CLOSED')}>{t.closed}</Button>}
                    </div>
                );
            },
        },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    ]), [t]);

    return (
        <ListPageShell className="gap-section">
            <ListPageShell.Header>
                <div className="flex items-center justify-between">
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    <div>
                        <Breadcrumbs
                            items={[
                                { label: 'Dashboard', href: `/t/${tenantSlug}/dashboard` },
                                { label: t.title },
                            ]}
                            className="mb-1"
                        />
                        <Heading level={1}>{t.title}</Heading>
                        {t.listDescription && (
                            <p className="text-sm text-content-muted mt-1">{t.listDescription}</p>
                        )}
                    </div>
                    <Button variant="primary" onClick={() => setShowForm(!showForm)}>{t.newFinding}</Button>
                </div>
            </ListPageShell.Header>

            {showForm && (
                <form onSubmit={createFinding} className="glass-card p-6 space-y-default animate-fadeIn">
                    <div className="grid grid-cols-2 gap-default">
                        <div><label className="input-label">{t.findingTitle} *</label><input className="input" required value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} /></div>
                        <div>
                            <label className="input-label">{t.severity}</label>
                            {(() => {
                                const options: ComboboxOption[] = [
                                    { value: 'LOW', label: t.low },
                                    { value: 'MEDIUM', label: t.medium },
                                    { value: 'HIGH', label: t.high },
                                    { value: 'CRITICAL', label: t.critical },
                                ];
                                return (
                                    <Combobox
                                        id="finding-severity-select"
                                        name="severity"
                                        options={options}
                                        selected={options.find(o => o.value === form.severity) ?? null}
                                        setSelected={(o) => setForm(f => ({ ...f, severity: o?.value ?? 'MEDIUM' }))}
                                        placeholder={t.severity}
                                        hideSearch
                                        matchTriggerWidth
                                        buttonProps={{ className: 'w-full' }}
                                        caret
                                    />
                                );
                            })()}
                        </div>
                        <div>
                            <label className="input-label">{t.type}</label>
                            {(() => {
                                const options: ComboboxOption[] = [
                                    { value: 'NONCONFORMITY', label: t.nonconformity },
                                    { value: 'OBSERVATION', label: t.observation },
                                    { value: 'OPPORTUNITY', label: t.opportunity },
                                ];
                                return (
                                    <Combobox
                                        id="finding-type-select"
                                        name="type"
                                        options={options}
                                        selected={options.find(o => o.value === form.type) ?? null}
                                        setSelected={(o) => setForm(f => ({ ...f, type: o?.value ?? 'OBSERVATION' }))}
                                        placeholder={t.type}
                                        hideSearch
                                        matchTriggerWidth
                                        buttonProps={{ className: 'w-full' }}
                                        caret
                                    />
                                );
                            })()}
                        </div>
                        <div><label className="input-label">{t.owner}</label><input className="input" value={form.owner} onChange={e => setForm(f => ({ ...f, owner: e.target.value }))} /></div>
                        <div className="col-span-2"><label className="input-label">{t.description} *</label><textarea className="input" required value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
                        {/* Epic 58 — shared DatePicker. YMD string
                            state preserved for the create payload. */}
                        <div>
                            <label className="input-label" htmlFor="finding-due-date">
                                {t.dueDate}
                            </label>
                            <DatePicker
                                id="finding-due-date"
                                className="w-full"
                                placeholder="Select date"
                                clearable
                                align="start"
                                value={parseYMD(form.dueDate)}
                                onChange={(next) =>
                                    setForm((f) => ({
                                        ...f,
                                        dueDate: toYMD(next) ?? '',
                                    }))
                                }
                                disabledDays={{
                                    before: startOfUtcDay(new Date()),
                                }}
                                aria-label={t.dueDate}
                            />
                        </div>
                    </div>
                    <div className="flex gap-tight"><Button type="submit" variant="primary">{t.createFinding}</Button><Button variant="secondary" onClick={() => setShowForm(false)}>{t.cancel}</Button></div>
                </form>
            )}

            <ListPageShell.Body>
                <TruncationBanner truncated={truncated} />
                <DataTable
                    fillBody
                    data={findings}
                    columns={findingColumns}
                    getRowId={(f: any) => f.id}
                    emptyState={t.noFindings}
                    resourceName={(p) => p ? 'findings' : 'finding'}
                    data-testid="findings-table"
                />
            </ListPageShell.Body>
        </ListPageShell>
    );
}
