'use client';
import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { Button } from '@/components/ui/button';
import type { CappedList } from '@/lib/list-backfill-cap';
import { TruncationBanner } from '@/components/ui/TruncationBanner';
import { StatusBadge, type StatusBadgeVariant } from '@/components/ui/status-badge';
import { Heading } from '@/components/ui/typography';
import { PageBreadcrumbs } from '@/components/layout/PageBreadcrumbs';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@dub/utils';

/* eslint-disable @typescript-eslint/no-explicit-any */
const STATUS_BADGE: Record<string, StatusBadgeVariant> = {
    PLANNED: 'neutral', IN_PROGRESS: 'info', COMPLETED: 'success', CANCELLED: 'warning',
};
const RESULT_BADGE: Record<string, StatusBadgeVariant> = {
    NOT_TESTED: 'neutral', PASS: 'success', FAIL: 'error',
};

interface AuditsClientProps {
    initialAudits: any[];
    tenantSlug: string;
    translations: {
        title: string;
        listDescription: string;
        auditsCount: string;
        newAudit: string;
        auditTitle: string;
        auditors: string;
        scope: string;
        createAudit: string;
        cancel: string;
        planned: string;
        inProgress: string;
        completed: string;
        cancelled: string;
        notTested: string;
        pass: string;
        fail: string;
        checklist: string;
        findingsTab: string;
        selectAudit: string;
    };
}

/**
 * Client island for audits — handles master/detail, create form, checklist interactions.
 * Data is pre-fetched server-side and passed via props.
 */
export function AuditsClient({ initialAudits, tenantSlug, translations: t }: AuditsClientProps) {
    const [selected, setSelected] = useState<any>(null);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState({ title: '', scope: '', auditors: '', generateChecklist: true });

    const apiUrl = (path: string) => `/api/t/${tenantSlug}${path}`;
    const queryClient = useQueryClient();

    // PR-5 — API returns `{ rows, truncated }`; SSR initial wraps
    // with `truncated: false` (SSR cap < backfill cap).
    const auditsQuery = useQuery<CappedList<any>>({
        queryKey: queryKeys.audits.list(tenantSlug),
        queryFn: async () => {
            const res = await fetch(apiUrl('/audits'));
            if (!res.ok) throw new Error('Failed to fetch audits');
            return res.json();
        },
        initialData: { rows: initialAudits, truncated: false },
    });
    const audits = auditsQuery.data?.rows ?? [];
    const truncated = auditsQuery.data?.truncated ?? false;

    const loadAudit = async (id: string) => {
        const res = await fetch(apiUrl(`/audits/${id}`));
        setSelected(await res.json());
    };

    const createMutation = useMutation({
        mutationFn: async (newAudit: any) => {
            const res = await fetch(apiUrl('/audits'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newAudit) });
            if (!res.ok) throw new Error('Failed to create audit');
            return res.json();
        },
        onSuccess: (a) => {
            queryClient.invalidateQueries({ queryKey: queryKeys.audits.all(tenantSlug) });
            setShowForm(false);
            setForm({ title: '', scope: '', auditors: '', generateChecklist: true });
            loadAudit(a.id);
        }
    });

    const createAudit = (e: React.FormEvent) => {
        e.preventDefault();
        createMutation.mutate(form);
    };

    const updateChecklist = async (itemId: string, result: string, notes: string = '') => {
        if (!selected) return;
        await fetch(apiUrl(`/audits/${selected.id}`), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ checklistUpdates: [{ id: itemId, result, notes }] }) });
        loadAudit(selected.id);
    };

    const updateAuditStatus = async (status: string) => {
        if (!selected) return;
        await fetch(apiUrl(`/audits/${selected.id}`), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
        setSelected((s: any) => ({ ...s, status }));
        queryClient.invalidateQueries({ queryKey: queryKeys.audits.list(tenantSlug) });
    };

    const statusLabel = (status: string) => {
        const map: Record<string, string> = { PLANNED: t.planned, IN_PROGRESS: t.inProgress, COMPLETED: t.completed, CANCELLED: t.cancelled };
        return map[status] || status;
    };

    const resultLabel = (result: string) => {
        const map: Record<string, string> = { NOT_TESTED: t.notTested, PASS: t.pass, FAIL: t.fail };
        return map[result] || result;
    };

    const resultOptions = useMemo<ComboboxOption[]>(
        () => [
            { value: 'NOT_TESTED', label: t.notTested },
            { value: 'PASS', label: t.pass },
            { value: 'FAIL', label: t.fail },
        ],
        [t.notTested, t.pass, t.fail],
    );

    return (
        <>
            <div className="flex flex-wrap items-center justify-between gap-compact">
                <div>
                    <PageBreadcrumbs
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
                <Button variant="primary" onClick={() => setShowForm(!showForm)} id="new-audit-btn">{t.newAudit}</Button>
            </div>

            <TruncationBanner truncated={truncated} />

            {showForm && (
                <form onSubmit={createAudit} className={cn(cardVariants(), 'space-y-default animate-fadeIn')} id="audit-form">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-default">
                        <div><label className="input-label">{t.auditTitle} *</label><input className="input" required value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} id="audit-title-input" /></div>
                        <div><label className="input-label">{t.auditors}</label><input className="input" value={form.auditors} onChange={e => setForm(f => ({ ...f, auditors: e.target.value }))} /></div>
                        <div className="sm:col-span-2"><label className="input-label">{t.scope}</label><textarea className="input" value={form.scope} onChange={e => setForm(f => ({ ...f, scope: e.target.value }))} id="audit-scope-input" /></div>
                    </div>
                    <div className="flex flex-wrap gap-tight"><Button type="submit" variant="primary" id="create-audit-btn">{t.createAudit}</Button><Button type="button" variant="secondary" onClick={() => setShowForm(false)}>{t.cancel}</Button></div>
                </form>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-default">
                <div className="space-y-tight">
                    {audits.map((a: any) => (
                        <button key={a.id} onClick={() => loadAudit(a.id)}
                            className={cn(cardVariants({ density: 'compact' }), 'w-full text-left hover:bg-bg-muted/50 transition', selected?.id === a.id && 'ring-2 ring-[var(--ring)]')}>
                            <div className="flex items-center justify-between">
                                <span className="font-medium text-sm">{a.title}</span>
                                <StatusBadge variant={STATUS_BADGE[a.status]}>{statusLabel(a.status)}</StatusBadge>
                            </div>
                            <p className="text-xs text-content-subtle mt-1">{a._count?.checklist || 0} items · {a._count?.findings || 0} {t.findingsTab.toLowerCase()}</p>
                        </button>
                    ))}
                </div>

                <div className="lg:col-span-2">
                    {selected ? (
                        <div className={cn(cardVariants(), 'animate-slideIn space-y-default')}>
                                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-compact">
                                <Heading level={2}>{selected.title}</Heading>
                                <div className="flex flex-wrap gap-tight">
                                    {selected.status === 'PLANNED' && <Button variant="primary" size="sm" onClick={() => updateAuditStatus('IN_PROGRESS')}>{t.inProgress}</Button>}
                                    {selected.status === 'IN_PROGRESS' && <Button variant="primary" size="sm" onClick={() => updateAuditStatus('COMPLETED')}>{t.completed}</Button>}
                                </div>
                            </div>
                            {selected.scope && <p className="text-sm text-content-muted">{selected.scope}</p>}

                            <div>
                                <Heading level={3} className="mb-3">{t.checklist} ({selected.checklist?.length || 0})</Heading>
                                <div className="space-y-tight">
                                    {selected.checklist?.map((item: any) => (
                                        <div key={item.id} className="flex flex-col sm:flex-row items-start gap-compact p-3 border border-border-default/50 rounded-lg">
                                            <Combobox
                                                hideSearch
                                                options={resultOptions}
                                                selected={resultOptions.find(o => o.value === item.result) ?? null}
                                                setSelected={(opt) => opt && updateChecklist(item.id, opt.value)}
                                                matchTriggerWidth
                                                buttonProps={{ className: 'w-full sm:w-32 text-xs' }}
                                                aria-label={`Result for ${item.prompt}`}
                                                caret
                                            />
                                            <div className="flex-1">
                                                <p className="text-sm text-content-default">{item.prompt}</p>
                                                {item.notes && <p className="text-xs text-content-subtle mt-1">{item.notes}</p>}
                                            </div>
                                            <StatusBadge variant={RESULT_BADGE[item.result]}>{resultLabel(item.result)}</StatusBadge>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {selected.findings?.length > 0 && (
                                <div>
                                    <Heading level={3} className="mb-2">{t.findingsTab} ({selected.findings.length})</Heading>
                                    {selected.findings.map((f: any) => (
                                        <div key={f.id} className="p-3 border border-border-default/50 rounded-lg mb-2">
                                            <div className="flex items-center justify-between">
                                                <span className="text-sm font-medium">{f.title}</span>
                                                <StatusBadge variant={f.severity === 'CRITICAL' ? 'error' : f.severity === 'HIGH' ? 'warning' : 'info'}>{f.severity}</StatusBadge>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className={cn(cardVariants({ density: 'spacious' }), 'text-center text-content-subtle')}>{t.selectAudit}</div>
                    )}
                </div>
            </div>
        </>
    );
}
