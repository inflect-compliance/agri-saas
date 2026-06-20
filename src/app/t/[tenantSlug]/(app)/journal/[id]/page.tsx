'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useTenantApiUrl, useTenantHref, useTenantContext } from '@/lib/tenant-context-provider';
import { useTenantSWR } from '@/lib/hooks/use-tenant-swr';
import { CACHE_KEYS } from '@/lib/swr-keys';
import { EntityDetailLayout } from '@/components/layout/EntityDetailLayout';
import { MetaStrip } from '@/components/ui/meta-strip';
import { Button } from '@/components/ui/button';
import { Pen2 } from '@/components/ui/icons/nucleo';
import { Tooltip } from '@/components/ui/tooltip';
import { Eyebrow, Heading } from '@/components/ui/typography';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge, type StatusBadgeVariant } from '@/components/ui/status-badge';
import { sanitizeRichTextHtml } from '@/lib/security/sanitize';
import { formatDateTime } from '@/lib/format-date';
import { JournalEntryModal } from '../JournalEntryModal';
import { JournalPhotosTab } from './JournalPhotosTab';
import { PestSuggestionCard, type PestSuggestionData } from '@/components/ag/pest-suggestion-card';
import { LOG_ENTRY_TYPE_LABELS } from '../filter-defs';

const STATUS_BADGE: Record<string, StatusBadgeVariant> = {
    PLANNED: 'info',
    DONE: 'success',
};

type Tab = 'details' | 'quantities' | 'photos';

interface QuantityRow {
    id: string;
    measure: string;
    value: string | number;
    unitId: string;
    label?: string | null;
    unit?: { id: string; symbol: string; name: string } | null;
}
interface LocationLink {
    locationId?: string;
    location?: { id: string; name: string } | null;
}
interface EquipmentLink {
    equipmentId?: string;
    equipment?: { id: string; name: string; category?: string | null } | null;
}
interface PhotoLink {
    id: string;
    caption?: string | null;
    createdAt: string;
    fileRecord?: { id: string; originalName?: string } | null;
}
interface LogEntryDetail {
    id: string;
    type: string;
    status: string;
    title: string;
    notes?: string | null;
    occurredAt: string;
    createdAt: string;
    updatedAt: string;
    quantities?: QuantityRow[];
    files?: PhotoLink[];
    locations?: LocationLink[];
    equipment?: EquipmentLink[];
    attributesJson?: { pestId?: PestSuggestionData } | null;
}

export default function JournalDetailPage() {
    const params = useParams();
    const apiUrl = useTenantApiUrl();
    const tenantHref = useTenantHref();
    const { permissions, tenantSlug } = useTenantContext();
    const entryId = params.id as string;

    const detailKey = CACHE_KEYS.journal.detail(entryId);
    const { data: entry, error, isLoading, mutate } = useTenantSWR<LogEntryDetail>(detailKey);

    const [activeTab, setActiveTab] = useState<Tab>('details');
    const [editing, setEditing] = useState(false);

    const breadcrumbs = [
        { label: 'Dashboard', href: tenantHref('/dashboard') },
        { label: 'Journal', href: tenantHref('/journal') },
        { label: entry?.title ?? 'Entry' },
    ];

    if (isLoading && !entry) {
        return (
            <EntityDetailLayout loading title="" breadcrumbs={breadcrumbs}>
                <></>
            </EntityDetailLayout>
        );
    }
    if (error && !entry) {
        return (
            <EntityDetailLayout error={(error as Error).message} title="" breadcrumbs={breadcrumbs}>
                <></>
            </EntityDetailLayout>
        );
    }
    if (!entry) {
        return (
            <EntityDetailLayout empty={{ message: 'Journal entry not found.' }} title="" breadcrumbs={breadcrumbs}>
                <></>
            </EntityDetailLayout>
        );
    }

    const quantities = entry.quantities ?? [];
    const photos = entry.files ?? [];
    const locations = entry.locations ?? [];
    const equipment = entry.equipment ?? [];

    const tabs: ReadonlyArray<{ key: Tab; label: string; count?: number }> = [
        { key: 'details', label: 'Details' },
        { key: 'quantities', label: 'Quantities', count: quantities.length },
        { key: 'photos', label: 'Photos', count: photos.length },
    ];

    return (
        <EntityDetailLayout
            id="journal-detail-page"
            breadcrumbs={breadcrumbs}
            title={<span id="journal-title-heading">{entry.title}</span>}
            meta={
                <MetaStrip
                    items={[
                        {
                            label: 'Type',
                            value:
                                (LOG_ENTRY_TYPE_LABELS as Record<string, string>)[entry.type] ??
                                String(entry.type).replace(/_/g, ' '),
                        },
                        {
                            kind: 'status' as const,
                            label: 'Status',
                            value: entry.status,
                            variant: STATUS_BADGE[entry.status] ?? 'neutral',
                        },
                    ]}
                />
            }
            actions={
                permissions.canWrite ? (
                    <Tooltip content="Edit entry">
                        <Button
                            variant="secondary"
                            size="icon"
                            onClick={() => setEditing(true)}
                            id="edit-journal-btn"
                            aria-label="Edit entry"
                        >
                            <Pen2 className="size-4" />
                        </Button>
                    </Tooltip>
                ) : null
            }
            tabs={tabs}
            activeTab={activeTab}
            onTabChange={(k) => setActiveTab(k)}
        >
            {permissions.canWrite && (
                <JournalEntryModal
                    open={editing}
                    setOpen={setEditing}
                    tenantSlug={tenantSlug}
                    initial={{
                        id: entry.id,
                        type: entry.type,
                        status: entry.status,
                        occurredAt: entry.occurredAt,
                        title: entry.title,
                        notes: entry.notes,
                        quantities: quantities.map((q) => ({
                            measure: q.measure,
                            value: q.value,
                            unitId: q.unitId,
                            label: q.label,
                        })),
                        locationIds: locations
                            .map((l) => l.locationId ?? l.location?.id)
                            .filter((id): id is string => Boolean(id)),
                    }}
                    onSaved={() => void mutate()}
                />
            )}

            {activeTab === 'details' && (
                <div className={cn(cardVariants(), 'space-y-default')} id="journal-detail">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-default">
                        <div>
                            <Eyebrow>Occurred</Eyebrow>
                            <p className="text-sm">{formatDateTime(entry.occurredAt)}</p>
                        </div>
                        <div>
                            <Eyebrow>Locations</Eyebrow>
                            <p className="text-sm">
                                {locations.length
                                    ? locations.map((l) => l.location?.name).filter(Boolean).join(', ')
                                    : '—'}
                            </p>
                        </div>
                        <div>
                            <Eyebrow>Equipment</Eyebrow>
                            <p className="text-sm">
                                {equipment.length
                                    ? equipment.map((e) => e.equipment?.name).filter(Boolean).join(', ')
                                    : '—'}
                            </p>
                        </div>
                    </div>

                    <div>
                        <Eyebrow>Notes</Eyebrow>
                        {entry.notes ? (
                            <div
                                className="prose prose-sm prose-invert max-w-none text-sm"
                                // Notes are sanitized server-side on write
                                // (sanitizeRichTextHtml at the usecase boundary);
                                // re-sanitized here client-side as defence-in-depth,
                                // mirroring the policy-detail HTML render.
                                dangerouslySetInnerHTML={{ __html: sanitizeRichTextHtml(entry.notes) }}
                            />
                        ) : (
                            <p className="text-sm text-content-muted">—</p>
                        )}
                    </div>

                    <div className="grid grid-cols-2 gap-default border-t border-border-default/50 pt-4">
                        <div>
                            <Eyebrow>Created</Eyebrow>
                            <p className="text-sm text-content-muted">{formatDateTime(entry.createdAt)}</p>
                        </div>
                        <div>
                            <Eyebrow>Updated</Eyebrow>
                            <p className="text-sm text-content-muted">{formatDateTime(entry.updatedAt)}</p>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'quantities' && (
                <div className={cn(cardVariants(), 'space-y-default')} id="journal-quantities">
                    <Heading level={3}>Quantities</Heading>
                    {quantities.length === 0 ? (
                        <EmptyState
                            size="sm"
                            variant="no-records"
                            title="No quantities"
                            description="This entry records no measured amount (an input application or harvest would carry one)."
                        />
                    ) : (
                        <ul className="divide-y divide-border-subtle">
                            {quantities.map((q) => (
                                <li key={q.id} className="flex items-center justify-between py-2">
                                    <span className="text-sm">
                                        <StatusBadge variant="neutral" size="sm">
                                            {q.measure}
                                        </StatusBadge>{' '}
                                        {q.label || '—'}
                                    </span>
                                    <span className="font-mono text-sm tabular-nums text-content-emphasis">
                                        {q.value} {q.unit?.symbol ?? ''}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            {activeTab === 'photos' && (
                <div className="space-y-default">
                    {entry.attributesJson?.pestId && (
                        <PestSuggestionCard data={entry.attributesJson.pestId} />
                    )}
                    <JournalPhotosTab
                        entryId={entryId}
                        photos={photos}
                        apiUrl={apiUrl}
                        canWrite={permissions.canWrite}
                        onChanged={() => void mutate()}
                    />
                </div>
            )}
        </EntityDetailLayout>
    );
}
