'use client';
import { formatDate } from '@/lib/format-date';
import { SkeletonCard } from '@/components/ui/skeleton';
import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { AppIcon, type AppIconName } from '@/components/icons/AppIcon';
import { ClipboardCheck } from 'lucide-react';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { FieldGroup } from '@/components/ui/field-group';
import { DateRangePicker } from '@/components/ui/date-picker/date-range-picker';
import { selectDateRangePresets } from '@/components/ui/date-picker/presets-catalogue';
import type { DateRangeValue } from '@/components/ui/date-picker/types';
import { StatusBadge, type StatusBadgeVariant } from '@/components/ui/status-badge';
import { Heading } from '@/components/ui/typography';
import { PageBreadcrumbs } from '@/components/layout/PageBreadcrumbs';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';

// Epic 58 — audit periods are reporting windows. The curated preset
// subset favours periods auditors actually request ("the most recent
// completed quarter", "this fiscal year so far") over day-level
// presets like "Today" that don't map to an audit scope.
const AUDIT_PERIOD_PRESETS = selectDateRangePresets([
    'quarter-to-date',
    'year-to-date',
    'last-quarter',
    'last-year',
    'last-90-days',
    'last-30-days',
]);

const FW_META: Record<string, { icon: AppIconName; label: string; color: string }> = {
    ISO27001: { icon: 'shield', label: 'ISO/IEC 27001:2022', color: 'from-indigo-500 to-purple-600' },
    NIS2: { icon: 'globe', label: 'NIS2 Directive', color: 'from-blue-500 to-cyan-600' },
};

// Epic 55 — framework picker options. Labels are intentionally verbose
// (include the version / full regulation name) because the Combobox
// search index benefits from the extra tokens ("ISO", "27001", "NIS2",
// "EU 2022/2555" all become fuzzy-matchable).
const FW_OPTIONS: ComboboxOption<{ version: string }>[] = [
    {
        value: 'ISO27001',
        label: 'ISO/IEC 27001:2022',
        meta: { version: '2022' },
    },
    {
        value: 'NIS2',
        label: 'NIS2 Directive (EU 2022/2555)',
        meta: { version: 'EU_2022_2555' },
    },
];

const STATUS_BADGE: Record<string, StatusBadgeVariant> = {
    PLANNING: 'neutral', IN_PROGRESS: 'info', READY: 'success', COMPLETE: 'warning',
};

export default function AuditCyclesPage() {
    const t = useTranslations('audits');
    const params = useParams();
    const router = useRouter();
    const tenantSlug = params.tenantSlug as string;
    const apiUrl = useCallback((path: string) => `/api/t/${tenantSlug}${path}`, [tenantSlug]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [cycles, setCycles] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState({ frameworkKey: 'ISO27001', frameworkVersion: '2022', name: '' });
    // Epic 58 — the period is stored as a nullable DateRangeValue so
    // half-open ranges ("from X, open-ended") are representable. The
    // backend accepts both `periodStartAt` / `periodEndAt` as
    // optional, so we submit whichever side the user has set.
    const [period, setPeriod] = useState<DateRangeValue>({ from: null, to: null });

    useEffect(() => {
        fetch(apiUrl('/audits/cycles'))
            .then(r => r.ok ? r.json() : [])
            .then(setCycles)
            .finally(() => setLoading(false));
    }, [apiUrl]);

    const create = async (e: React.FormEvent) => {
        e.preventDefault();
        const version = form.frameworkKey === 'NIS2' ? 'EU_2022_2555' : '2022';
        const body: Record<string, unknown> = {
            ...form,
            frameworkVersion: version,
        };
        // Submit the audit period only when the user picked one.
        // Either side may be open-ended; the backend already accepts
        // both fields as optional and validates them as strings.
        if (period.from) body.periodStartAt = period.from.toISOString();
        if (period.to) body.periodEndAt = period.to.toISOString();
        const res = await fetch(apiUrl('/audits/cycles'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (res.ok) {
            const cycle = await res.json();
            router.push(`/t/${tenantSlug}/audits/cycles/${cycle.id}`);
        }
    };

    if (loading) return (
        <div className="p-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-section">
                {[1, 2, 3].map(i => <SkeletonCard key={i} lines={3} />)}
            </div>
        </div>
    );

    return (
        <div className="space-y-section animate-fadeIn">
            <div className="flex items-center justify-between">
                <div>
                    <PageBreadcrumbs
                        items={[
                            { label: t('crumbDashboard'), href: `/t/${tenantSlug}/dashboard` },
                            { label: t('crumbAudits'), href: `/t/${tenantSlug}/audits` },
                            { label: t('crumbCycles') },
                        ]}
                        className="mb-1"
                    />
                    <Heading level={1}>{t('cyclesList.heading')}</Heading>
                    <p className="text-content-muted text-sm">{t('cyclesList.cycleCount', { count: cycles.length })}</p>
                </div>
                <Button variant="primary" onClick={() => setShowForm(!showForm)} id="create-cycle-btn">
                    {showForm ? t('cyclesList.cancel') : '+ Cycle'}
                </Button>
            </div>

            {showForm && (
                <form onSubmit={create} className={cn(cardVariants(), 'animate-fadeIn')} id="cycle-form">
                    <FieldGroup columns={2} gap="md">
                        <FormField
                            label={t('cyclesList.framework')}
                            required
                            hint={t('cyclesList.frameworkHint')}
                        >
                            <Combobox<false, { version: string }>
                                id="fw-select"
                                name="frameworkKey"
                                options={FW_OPTIONS}
                                selected={
                                    FW_OPTIONS.find(
                                        (o) => o.value === form.frameworkKey,
                                    ) ?? null
                                }
                                setSelected={(option) => {
                                    if (!option) return;
                                    setForm((f) => ({
                                        ...f,
                                        frameworkKey: option.value,
                                    }));
                                }}
                                placeholder={t('cyclesList.frameworkPlaceholder')}
                                searchPlaceholder={t('cyclesList.frameworkSearchPlaceholder')}
                                matchTriggerWidth
                                buttonProps={{ className: 'w-full' }}
                                caret
                            />
                        </FormField>
                        <FormField label={t('cyclesList.cycleName')} required>
                            <Input
                                id="cycle-name-input"
                                required
                                value={form.name}
                                onChange={(e) =>
                                    setForm((f) => ({ ...f, name: e.target.value }))
                                }
                                placeholder={t('cyclesList.cycleNamePlaceholder')}
                            />
                        </FormField>
                    </FieldGroup>
                    {/*
                      Epic 58 — Audit period. Optional. The shared
                      DateRangePicker handles presets (Quarter to date,
                      Last year, …) + custom ranges in one surface, so
                      auditors don't need two date inputs or a spreadsheet
                      to figure out what "Q2 2026" maps to.
                    */}
                    <div className="mt-4">
                        <FormField
                            label={t('cyclesList.auditPeriod')}
                            hint={t('cyclesList.auditPeriodHint')}
                        >
                            <DateRangePicker
                                id="cycle-period-range"
                                className="w-full"
                                align="start"
                                placeholder={t('cyclesList.auditPeriodPlaceholder')}
                                value={period}
                                onChange={setPeriod}
                                presets={AUDIT_PERIOD_PRESETS}
                                showYearNavigation
                            />
                        </FormField>
                    </div>
                    <div className="mt-4 flex gap-tight">
                        <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>{t('cyclesList.cancel')}</Button>
                        <Button type="submit" variant="primary" id="submit-cycle-btn">+ Cycle</Button>
                    </div>
                </form>
            )}

            {cycles.length === 0 && !showForm ? (
                <div className={cardVariants({ density: 'none' })}>
                    <EmptyState
                        icon={ClipboardCheck}
                        title={t('cyclesList.emptyTitle')}
                        description={t('cyclesList.emptyDescription')}
                        primaryAction={{
                            label: '+ Audit Cycle',
                            onClick: () => setShowForm(true),
                        }}
                    />
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-default">
                    {cycles.map(c => {
                        const meta = FW_META[c.frameworkKey] || { icon: 'shield' as AppIconName, label: c.frameworkKey, color: 'from-gray-500 to-gray-600' };
                        return (
                            <Link key={c.id} href={`/t/${tenantSlug}/audits/cycles/${c.id}`} id={`cycle-link-${c.id}`}
                                className={cn(cardVariants(), 'hover:bg-bg-muted/50 transition group')}>
                                <div className="flex items-start justify-between mb-3">
                                    <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${meta.color} flex items-center justify-center text-lg`}>
                                        <AppIcon name={meta.icon} size={20} />
                                    </div>
                                    <StatusBadge variant={STATUS_BADGE[c.status] || 'neutral'}>{c.status}</StatusBadge>
                                </div>
                                <Heading level={3} className="group-hover:text-content-emphasis transition">{c.name}</Heading>
                                <p className="text-xs text-content-muted mt-1">{meta.label} · v{c.frameworkVersion}</p>
                                <div className="flex items-center gap-tight mt-3 text-xs text-content-subtle">
                                    <span>{t('cyclesList.packCount', { count: c.packs?.length || 0 })}</span>
                                    <span>·</span>
                                    <span>{formatDate(c.createdAt)}</span>
                                </div>
                            </Link>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
