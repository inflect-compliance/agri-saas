'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { formatDate } from '@/lib/format-date';
import { SkeletonCard } from '@/components/ui/skeleton';
import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { AppIcon, type AppIconName } from '@/components/icons/AppIcon';
import { StatusBadge } from '@/components/ui/status-badge';
import { Heading } from '@/components/ui/typography';
import { PageBreadcrumbs } from '@/components/layout/PageBreadcrumbs';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';

const FW_META: Record<string, { icon: AppIconName; label: string }> = {
    ISO27001: { icon: 'shield', label: 'ISO/IEC 27001:2022' },
    NIS2: { icon: 'globe', label: 'NIS2 Directive' },
};

export default function AuditorPortalPage() {
    const t = useTranslations('audits');
    const params = useParams();
    const tenantSlug = params.tenantSlug as string;
    const apiUrl = useCallback((path: string) => `/api/t/${tenantSlug}${path}`, [tenantSlug]);

    const [packs, setPacks] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedPack, setSelectedPack] = useState<any>(null);

    useEffect(() => {
        fetch(apiUrl('/audits/auditor/packs'))
            .then(r => r.ok ? r.json() : [])
            .then(setPacks)
            .finally(() => setLoading(false));
    }, [apiUrl]);

    const loadPack = async (packId: string) => {
        const res = await fetch(apiUrl(`/audits/packs/${packId}`));
        if (res.ok) setSelectedPack(await res.json());
    };

    if (loading) return (
        <div className="p-8">
            <SkeletonCard lines={4} />
        </div>
    );

    return (
        <div className="space-y-section animate-fadeIn">
            <div>
                <PageBreadcrumbs
                    items={[
                        { label: t('crumbDashboard'), href: `/t/${tenantSlug}/dashboard` },
                        { label: t('crumbAudits'), href: `/t/${tenantSlug}/audits` },
                        { label: t('auditor.crumb') },
                    ]}
                    className="mb-1"
                />
                <Heading level={1} id="auditor-heading">{t('auditor.heading')}</Heading>
                <p className="text-content-muted text-sm">{t('auditor.subtitle')}</p>
            </div>

            {packs.length === 0 ? (
                <div className={cn(cardVariants({ density: 'spacious' }), 'text-center')}>
                    <div className="mb-4"><AppIcon name="lock" size={48} className="text-content-muted" /></div>
                    <Heading level={2} className="mb-2">{t('auditor.emptyTitle')}</Heading>
                    <p className="text-content-muted text-sm">{t('auditor.emptyDescription')}</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-default">
                    <div className="space-y-tight">
                        {packs.map(p => {
                            const meta = FW_META[p.cycle?.frameworkKey] || { icon: 'shield' as AppIconName, label: p.cycle?.frameworkKey || '' };
                            return (
                                <button key={p.id} onClick={() => loadPack(p.id)}
                                    className={cn(cardVariants({ density: 'compact' }), 'w-full text-left hover:bg-bg-muted/50 transition', selectedPack?.id === p.id && 'ring-2 ring-[var(--ring)]')}>
                                    <div className="flex items-center gap-compact">
                                        <AppIcon name={meta.icon} size={20} />
                                        <div className="min-w-0">
                                            <p className="font-medium text-sm truncate">{p.name}</p>
                                            <p className="text-xs text-content-subtle">{meta.label} · {p.status}</p>
                                        </div>
                                    </div>
                                    <p className="text-xs text-content-subtle mt-1">{t('auditor.itemsCount', { count: p.items?.length || 0 })}</p>
                                </button>
                            );
                        })}
                    </div>
                    <div className="lg:col-span-2">
                        {selectedPack ? (
                            <div className={cn(cardVariants(), 'space-y-default animate-fadeIn')}>
                                <div className="flex items-center justify-between">
                                    <div>
                                        <Heading level={2} id="auditor-pack-name">{selectedPack.name}</Heading>
                                        <p className="text-sm text-content-muted">
                                            {selectedPack.status} · {t('auditor.itemsCount', { count: selectedPack._count?.items || 0 })}
                                            {selectedPack.frozenAt && ` · ${t('auditor.frozen', { date: formatDate(selectedPack.frozenAt) })}`}
                                        </p>
                                    </div>
                                    <StatusBadge variant={selectedPack.status === 'FROZEN' ? 'info' : 'neutral'}>
                                        {selectedPack.status}
                                    </StatusBadge>
                                </div>

                                {/* Items grouped */}
                                {selectedPack.items?.length > 0 && (() => {
                                    const grouped: Record<string, any[]> = {};
                                    selectedPack.items.forEach((item: any) => {
                                        if (!grouped[item.entityType]) grouped[item.entityType] = [];
                                        grouped[item.entityType].push(item);
                                    });
                                    return Object.entries(grouped).map(([type, items]) => (
                                        <div key={type}>
                                            <Heading level={3} className="mb-1">{type} ({items.length})</Heading>
                                            <div className="border border-border-default/50 rounded-lg divide-y divide-border-default/50">
                                                {items.map((item: any) => {
                                                    let snap: any = {};
                                                    try { snap = JSON.parse(item.snapshotJson || '{}'); } catch { /* */ }
                                                    return (
                                                        <div key={item.id} className="p-2 text-sm">
                                                            <span className="font-medium">{snap.code || snap.title || snap.name || item.entityId}</span>
                                                            {snap.description && <span className="text-xs text-content-subtle ml-2">{snap.description}</span>}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ));
                                })()}
                            </div>
                        ) : (
                            <div className={cn(cardVariants({ density: 'spacious' }), 'text-center text-content-subtle')}>
                                {t('auditor.selectPack')}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
