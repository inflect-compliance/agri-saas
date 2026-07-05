'use client';
/* TODO(swr-migration): this file has fetch-on-mount + setState
 * patterns flagged by react-hooks/set-state-in-effect. Each call site
 * carries an inline disable directive; collectively they should
 * migrate to useTenantSWR (Epic 69 shape) so the rule can lift. */

import { formatDate } from '@/lib/format-date';
import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { useParams } from 'next/navigation';
import { useTenantApiUrl, useTenantHref, useTenantContext } from '@/lib/tenant-context-provider';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { EntityDetailLayout } from '@/components/layout/EntityDetailLayout';
import type { PolicyDetailDTO, PolicyVersionDTO, AuditLogEntry } from '@/lib/dto';
import { DatePicker } from '@/components/ui/date-picker/date-picker';
import {
    parseYMD,
    startOfUtcDay,
    toYMD,
} from '@/components/ui/date-picker/date-utils';
import { NumberStepper } from '@/components/ui/number-stepper';
import { sanitizeRichTextHtml } from '@/lib/security/sanitize';
import type { RichTextContentType } from '@/components/ui/RichTextEditor';
import { ApprovalBanner } from '@/components/ui/ApprovalBanner';
import { VersionDiff } from '@/components/ui/VersionDiff';
import { StatusBadge, type StatusBadgeVariant } from '@/components/ui/status-badge';
import { Heading } from '@/components/ui/typography';
import { MetaStrip } from '@/components/ui/meta-strip';
import { POLICY_STATUS_VARIANT } from '@/app-layer/domain/entity-status-mapping';
import { Card, cardVariants } from '@/components/ui/card';
import { InlineNotice } from '@/components/ui/inline-notice';
import { cn } from '@/lib/cn';
import { PolicySharePointSection } from './PolicySharePointSection';

// Lazy-load Tiptap. The editor + ProseMirror chunks land at
// ~200KB gzipped; deferring the import means the static parts of
// the policy detail page (current view, versions, activity) stay
// light unless the operator opens the Editor tab.
const RichTextEditor = dynamic(
    () => import('@/components/ui/RichTextEditor').then((m) => m.RichTextEditor),
    {
        ssr: false,
        loading: () => (
            <Card elevation="inset" density="compact" className="text-center text-sm text-content-muted">
                Loading editor…
            </Card>
        ),
    },
);

// Polish PR-1 — STATUS_BADGE moved to shared domain mapping as
// POLICY_STATUS_VARIANT in @/app-layer/domain/entity-status-mapping.
const APPROVAL_BADGE: Record<string, StatusBadgeVariant> = {
    PENDING: 'info', APPROVED: 'success', REJECTED: 'error',
};
const EVENT_ICONS: Record<string, string> = {
    POLICY_CREATED: 'create', POLICY_VERSION_CREATED: 'version', POLICY_UPDATED: 'edit',
    POLICY_APPROVAL_REQUESTED: 'request', POLICY_APPROVED: 'approve', POLICY_REJECTED: 'reject',
    POLICY_PUBLISHED: 'publish', POLICY_ARCHIVED: 'archive', POLICY_REVIEW_OVERDUE: 'overdue',
};

type ContentMode = 'MARKDOWN' | 'EXTERNAL_LINK' | 'FILE';

export default function PolicyDetailPage() {
    const t = useTranslations('policies.detail');
    const tp = useTranslations('policies');
    const c = useTranslations('common');
    const params = useParams();
    const apiUrl = useTenantApiUrl();
    const tenantHref = useTenantHref();
    const tenant = useTenantContext();
    const policyId = params?.policyId as string;

    const [policy, setPolicy] = useState<PolicyDetailDTO | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [tab, setTab] = useState<'current' | 'versions' | 'editor' | 'activity'>('current');

    // Editor state
    const [contentMode, setContentMode] = useState<ContentMode>('MARKDOWN');
    const [editorContent, setEditorContent] = useState('');
    // Epic 45.2 — when the operator toggles the rich editor's
    // markdown ↔ WYSIWYG switch, the editor reports the new type.
    // We persist that as `contentType` on the version so rendering
    // can branch correctly between markdown-as-text and HTML.
    const [editorContentType, setEditorContentType] =
        useState<RichTextContentType>('MARKDOWN');
    const [externalUrl, setExternalUrl] = useState('');
    const [changeSummary, setChangeSummary] = useState('');
    const [saving, setSaving] = useState(false);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);

    // Review editing
    const [editingReview, setEditingReview] = useState(false);
    const [reviewDays, setReviewDays] = useState('');
    const [nextReview, setNextReview] = useState('');
    const [savingReview, setSavingReview] = useState(false);

    // Activity feed
    const [activities, setActivities] = useState<AuditLogEntry[]>([]);
    const [activitiesLoading, setActivitiesLoading] = useState(false);

    // Action state
    const [actionLoading, setActionLoading] = useState('');

    const fetchPolicy = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(apiUrl(`/policies/${policyId}`));
            if (!res.ok) throw new Error('Policy not found');
            const data = await res.json();
            setPolicy(data);
            setReviewDays(data.reviewFrequencyDays?.toString() || '');
            setNextReview(data.nextReviewAt ? data.nextReviewAt.substring(0, 10) : '');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [apiUrl, policyId]);

    const fetchActivity = useCallback(async () => {
        setActivitiesLoading(true);
        try {
            const res = await fetch(apiUrl(`/policies/${policyId}/activity`));
            if (res.ok) setActivities(await res.json());
        } finally {
            setActivitiesLoading(false);
        }
    }, [apiUrl, policyId]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { fetchPolicy(); }, [fetchPolicy]);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { if (tab === 'activity') fetchActivity(); }, [tab, fetchActivity]);

    // ── Actions ──

    const createVersion = async () => {
        if (contentMode === 'MARKDOWN' && !editorContent.trim()) return;
        if (contentMode === 'EXTERNAL_LINK' && !externalUrl.trim()) return;
        if (contentMode === 'FILE' && !selectedFile) return;
        setSaving(true);
        setError('');
        try {
            // Epic 45.2 — when the editor is in WYSIWYG mode the
            // payload is HTML, not markdown. The backend's
            // `sanitizePolicyContent` allowlists HTML on write, so
            // the wire format simply needs the right `contentType`.
            const wireContentType =
                contentMode === 'FILE'
                    ? 'MARKDOWN'
                    : contentMode === 'MARKDOWN'
                      ? editorContentType
                      : contentMode;
            const body: Record<string, unknown> = {
                contentType: wireContentType,
                changeSummary: changeSummary || null,
            };

            if (contentMode === 'MARKDOWN') {
                body.contentText = editorContent;
            } else if (contentMode === 'EXTERNAL_LINK') {
                body.contentType = 'EXTERNAL_LINK';
                body.externalUrl = externalUrl;
                body.contentText = `External document: ${externalUrl}`;
            } else if (contentMode === 'FILE' && selectedFile) {
                // Upload file first
                const formData = new FormData();
                formData.append('file', selectedFile);
                const uploadRes = await fetch(apiUrl('/evidence'), {
                    method: 'POST',
                    body: formData,
                });
                if (!uploadRes.ok) throw new Error('File upload failed');
                body.contentText = `File: ${selectedFile.name}`;
                body.changeSummary = changeSummary || `Uploaded file: ${selectedFile.name}`;
            }

            const res = await fetch(apiUrl(`/policies/${policyId}/versions`), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || 'Failed to create version');
            }
            setEditorContent(''); setExternalUrl(''); setChangeSummary(''); setEditorContentType('MARKDOWN');
            setSelectedFile(null); setTab('versions');
            await fetchPolicy();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setSaving(false);
        }
    };

    const saveReview = async () => {
        setSavingReview(true);
        try {
            const body: Record<string, unknown> = {};
            if (reviewDays) body.reviewFrequencyDays = parseInt(reviewDays);
            if (nextReview) body.nextReviewAt = nextReview;
            await fetch(apiUrl(`/policies/${policyId}`), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            setEditingReview(false);
            await fetchPolicy();
        } finally {
            setSavingReview(false);
        }
    };

    const requestApproval = async (versionId: string) => {
        setActionLoading('approve-' + versionId);
        try {
            const res = await fetch(apiUrl(`/policies/${policyId}/approval`), {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ versionId }),
            });
            if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Failed'); }
            await fetchPolicy();
        } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Unknown error'); } finally { setActionLoading(''); }
    };

    const decideApproval = async (approvalId: string, decision: 'APPROVED' | 'REJECTED') => {
        setActionLoading('decide-' + approvalId);
        try {
            const res = await fetch(apiUrl(`/policies/${policyId}/approval/${approvalId}/decide`), {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ decision }),
            });
            if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Failed'); }
            await fetchPolicy();
        } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Unknown error'); } finally { setActionLoading(''); }
    };

    const publishVersion = async (versionId: string) => {
        setActionLoading('publish-' + versionId);
        try {
            const res = await fetch(apiUrl(`/policies/${policyId}/publish`), {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ versionId }),
            });
            if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Failed'); }
            await fetchPolicy();
        } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Unknown error'); } finally { setActionLoading(''); }
    };

    const archivePolicy = async () => {
        setActionLoading('archive');
        try {
            const res = await fetch(apiUrl(`/policies/${policyId}/archive`), {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
            });
            if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Failed'); }
            await fetchPolicy();
        } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Unknown error'); } finally { setActionLoading(''); }
    };

    // ── Helpers ──

    const renderVersionContent = (v: PolicyVersionDTO) => {
        if (v.contentType === 'EXTERNAL_LINK' && v.externalUrl) {
            return (
                <a href={v.externalUrl} target="_blank" rel="noopener noreferrer"
                    className="text-[var(--brand-default)] hover:text-[var(--brand-muted)] underline flex items-center gap-1">
                    {v.externalUrl}
                </a>
            );
        }
        // Epic 45.2 — HTML versions render via dangerouslySetInnerHTML
        // with `sanitizeRichTextHtml` as defence-in-depth (the
        // backend already sanitises on write via
        // `sanitizePolicyContent('HTML', …)`). MARKDOWN versions
        // keep the legacy whitespace-pre rendering — the existing
        // policy content path stores markdown as literal text and
        // we deliberately don't add a markdown parser here.
        if (v.contentType === 'HTML') {
            const safe = sanitizeRichTextHtml(v.contentText ?? '');
            if (!safe.trim()) {
                return <span className="text-content-subtle italic">{t('noContent')}</span>;
            }
            return (
                <div
                    className="prose prose-sm prose-invert max-w-none text-content-default text-sm"
                    data-testid={`policy-version-html-${v.id}`}
                    dangerouslySetInnerHTML={{ __html: safe }}
                />
            );
        }
        return (
            <div className="prose prose-sm prose-invert max-w-none text-content-default whitespace-pre-wrap text-sm">
                {v.contentText || <span className="text-content-subtle italic">{t('noContent')}</span>}
            </div>
        );
    };

    const relativeTime = (date: string) => {
        const d = new Date(date);
        // `Date.now()` inside a callback that runs at render-string time
        // (`relativeTime(activity.createdAt)`). The label is allowed to be
        // mildly stale until the next re-render — used in an audit log,
        // not a high-precision context.
        // eslint-disable-next-line react-hooks/purity
        const diff = Date.now() - d.getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        const days = Math.floor(hrs / 24);
        return days === 1 ? 'yesterday' : `${days}d ago`;
    };

    const isOverdue = policy?.nextReviewAt && new Date(policy.nextReviewAt) < new Date() && policy.status !== 'ARCHIVED';

    // ── Render ──

    const breadcrumbs = [
        { label: tp('crumbDashboard'), href: tenantHref('/dashboard') },
        { label: t('crumbPolicies'), href: tenantHref('/policies') },
        { label: policy?.title ?? tp('policyFallback') },
    ];
    if (loading) {
        return (
            <EntityDetailLayout loading title="" breadcrumbs={breadcrumbs}>
                <></>
            </EntityDetailLayout>
        );
    }
    if (error && !policy) {
        return (
            <EntityDetailLayout error={error} title="" breadcrumbs={breadcrumbs}>
                <></>
            </EntityDetailLayout>
        );
    }
    if (!policy) {
        return (
            <EntityDetailLayout empty={{ message: t('notFound') }} title="" breadcrumbs={breadcrumbs}>
                <></>
            </EntityDetailLayout>
        );
    }

    const currentVersion = policy.currentVersion || policy.versions?.[0];
    const versions = policy.versions || [];
    const canWrite = tenant.permissions.canWrite;
    const canAdmin = tenant.permissions.canAdmin;

    type PolicyTab = 'current' | 'versions' | 'editor' | 'activity';
    const tabs: ReadonlyArray<{ key: PolicyTab; label: string }> = [
        { key: 'current', label: t('tabCurrent') },
        { key: 'versions', label: t('tabVersions') },
        ...(canWrite ? ([{ key: 'editor' as const, label: t('tabEditor') }]) : []),
        { key: 'activity', label: t('tabActivity') },
    ];

    // Epic 45.3 — surface the active pending approval (if any) above
    // the page chrome so reviewers see it on first paint. Approvals
    // come back nested per-version on `policy.approvals`; we pick the
    // most recent PENDING row + augment it with the version number
    // the banner displays.
    const pendingApproval = (() => {
        const all = policy.approvals ?? [];
        const pending = all.find((a) => a.status === 'PENDING');
        if (!pending) return null;
        const matchingVersion = (policy.versions ?? []).find(
            (v) => v.id === pending.policyVersionId,
        );
        return {
            id: pending.id,
            status: 'PENDING' as const,
            requestedBy: pending.requestedBy ?? null,
            approvedBy: pending.approvedBy ?? null,
            decidedAt: pending.decidedAt ?? null,
            comment: (pending as { comment?: string | null }).comment ?? null,
            versionNumber: matchingVersion?.versionNumber ?? null,
        };
    })();

    return (
        <EntityDetailLayout
            id="policy-detail-page"
            breadcrumbs={breadcrumbs}
            tabs={tabs}
            activeTab={tab}
            onTabChange={setTab}
            title={<span className="truncate" id="policy-title">{policy.title}</span>}
            meta={
                <MetaStrip
                    items={[
                        {
                            kind: 'status',
                            id: 'policy-status',
                            label: 'Status',
                            value: policy.status,
                            variant:
                                POLICY_STATUS_VARIANT[policy.status] ??
                                'neutral',
                        },
                        ...(policy.owner
                            ? [
                                  {
                                      label: 'Owner',
                                      value: policy.owner.name,
                                  } as const,
                              ]
                            : []),
                        ...(policy.nextReviewAt
                            ? [
                                  {
                                      label: 'Next Review',
                                      value: formatDate(
                                          policy.nextReviewAt,
                                      ),
                                      tone: isOverdue
                                          ? ('critical' as const)
                                          : undefined,
                                  } as const,
                              ]
                            : []),
                    ]}
                />
            }
            actions={
                <>
                    {/* B9 — Export PDF. Uses a plain anchor so the
                        browser handles the download natively; the
                        route streams a `Content-Disposition:
                        attachment` PDF carrying cover + TOC + body
                        + classification chrome. */}
                    <a
                        href={apiUrl(`/policies/${policyId}/export`)}
                        id="export-policy-pdf-btn"
                        data-testid="export-policy-pdf-btn"
                        className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                    >
                        {t('exportPdf')}
                    </a>
                    {canWrite && policy.status !== 'ARCHIVED' && (
                        <button onClick={() => {
                            setTab('editor');
                            setEditorContent(currentVersion?.contentText || '');
                            setEditorContentType(
                                currentVersion?.contentType === 'HTML'
                                    ? 'HTML'
                                    : 'MARKDOWN',
                            );
                        }} className={buttonVariants({ variant: 'primary' })} id="new-version-btn">+ Version</button>
                    )}
                    {canAdmin && policy.status !== 'ARCHIVED' && (
                        <Button variant="ghost" size="sm" className="text-content-muted hover:text-content-error" onClick={archivePolicy} disabled={actionLoading === 'archive'} id="archive-btn">
                            {actionLoading === 'archive' ? '...' : t('archive')}
                        </Button>
                    )}
                </>
            }
        >
            {/* Approval banner (Epic 45.3) — only mounts when an
                approval row is PENDING. Reviewer-only actions are
                gated by `canAdmin`; non-reviewers still see status
                + requester so the page is informative. */}
            {policy.status === 'IN_REVIEW' && pendingApproval && (
                <ApprovalBanner
                    approval={pendingApproval}
                    canDecide={canAdmin}
                    busy={!!actionLoading && actionLoading.startsWith('decide-')}
                    onDecide={(approvalId, decision) =>
                        decideApproval(approvalId, decision)
                    }
                />
            )}

            {error && (
                <InlineNotice variant="error" icon={null} onDismiss={() => setError('')}>
                    {error}
                </InlineNotice>
            )}

            {/* Description + meta + review-schedule */}
            <div className={cardVariants()}>
                <div className="flex items-start justify-between gap-default">
                    <div className="flex-1 min-w-0">
                        {policy.description && <p className="text-sm text-content-muted mb-3">{policy.description}</p>}
                        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-content-subtle">
                            {policy.category && <span>{policy.category}</span>}
                            {policy.owner && <span>{policy.owner.name}</span>}
                            {policy.nextReviewAt && (
                                <span className={isOverdue ? 'text-content-error' : ''}>
                                    {t('reviewPrefix', { date: formatDate(policy.nextReviewAt) })}
                                </span>
                            )}
                            {policy.reviewFrequencyDays && <span>{t('everyDays', { days: policy.reviewFrequencyDays })}</span>}
                            <span>{t('versionCount', { count: versions.length })}</span>
                        </div>
                        {/* Review edit toggle */}
                        {canWrite && !editingReview && (
                            <button onClick={() => setEditingReview(true)} className="text-xs text-[var(--brand-default)] hover:text-[var(--brand-muted)] mt-2">
                                {t('editReviewSchedule')}
                            </button>
                        )}
                        {editingReview && (
                            <div className="flex gap-tight items-end mt-2">
                                <div>
                                    <label
                                        className="text-xs text-content-subtle"
                                        htmlFor="policy-review-frequency-input"
                                    >
                                        {t('frequencyDays')}
                                    </label>
                                    {/* Epic 60 — NumberStepper gives us +/- buttons,
                                        ArrowUp/Down keyboard, bounded clamping, and
                                        a single accessible spinbutton. `reviewDays`
                                        stays a string in state so saveReview()'s
                                        parseInt() path is unchanged. */}
                                    <NumberStepper
                                        id="policy-review-frequency-input"
                                        className="w-36"
                                        size="sm"
                                        ariaLabel={t('frequencyAria')}
                                        value={
                                            reviewDays === ""
                                                ? 30
                                                : Number(reviewDays) || 30
                                        }
                                        onChange={(v) => setReviewDays(String(v))}
                                        min={1}
                                        max={3650}
                                        formatValue={(v) => t('daysUnit', { value: v })}
                                    />
                                </div>
                                <div>
                                    <label
                                        className="text-xs text-content-subtle"
                                        htmlFor="policy-next-review-input"
                                    >
                                        {t('nextReview')}
                                    </label>
                                    {/*
                                      Epic 58 — replaces the previous
                                      native date input with the shared
                                      DatePicker. `nextReview` keeps its
                                      YMD-string shape so `saveReview()`
                                      posts the same payload as before.
                                    */}
                                    <DatePicker
                                        id="policy-next-review-input"
                                        className="w-44 text-sm"
                                        placeholder={t('pickDate')}
                                        clearable
                                        align="start"
                                        value={parseYMD(nextReview)}
                                        onChange={(next) => {
                                            setNextReview(toYMD(next) ?? '');
                                        }}
                                        disabledDays={{
                                            before: startOfUtcDay(new Date()),
                                        }}
                                        aria-label={t('nextReviewAria')}
                                    />
                                </div>
                                <Button variant="secondary" size="xs" onClick={() => setEditingReview(false)}>{c('cancel')}</Button>
                                <Button variant="primary" size="xs" onClick={saveReview} disabled={savingReview}>
                                    {savingReview ? '…' : t('save')}
                                </Button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Polish PR-5 — tab strip is now owned by EntityDetailLayout
                via the `tabs` slot. The shell paints a tablist with the
                same #tab-current / #tab-versions / #tab-editor /
                #tab-activity DOM ids E2E selectors rely on. */}

            {/* ── Current Version ── */}
            {tab === 'current' && (
                <div className={cn(cardVariants(), 'space-y-default')}>
                    {currentVersion ? (
                        <>
                            <div className="flex items-center justify-between mb-4">
                                <div className="text-sm text-content-muted">
                                    {t('versionLabel')} {currentVersion.versionNumber} · {currentVersion.createdBy?.name} · {formatDate(currentVersion.createdAt)}
                                    {currentVersion.contentType === 'EXTERNAL_LINK' && <StatusBadge variant="info" className="ml-2">{t('external')}</StatusBadge>}
                                </div>
                            </div>
                            {renderVersionContent(currentVersion)}
                        </>
                    ) : (
                        <div className="text-center text-content-subtle py-8">
                            <p>{t('noVersionPublished')}</p>
                            {canWrite && <p className="text-sm mt-1">{t('createInEditor')}</p>}
                        </div>
                    )}
                </div>
            )}

            {/* SP-4 — SharePoint link (renders nothing if SharePoint isn't set up) */}
            {tab === 'current' && <PolicySharePointSection policyId={policyId} />}

            {/* ── Version History ── */}
            {tab === 'versions' && (
                <div className="space-y-compact" id="version-history">
                    {/* Version diff (Epic 45.3) — defaults to
                        previous-vs-current so a reviewer's first
                        impression is always meaningful. The picker
                        in the diff card lets them pick any pair. */}
                    {versions.length >= 2 && (
                        <VersionDiff
                            versions={versions.map((v) => ({
                                id: v.id,
                                versionNumber: v.versionNumber,
                                contentType: v.contentType,
                                text: v.contentText ?? '',
                            }))}
                        />
                    )}
                    {versions.length === 0 ? (
                        <Card className="text-center text-content-subtle">{t('noVersions')}</Card>
                    ) : versions.map((v: PolicyVersionDTO) => {
                        const vApprovals = (v.approvals || []).filter((a) => a.status === 'PENDING' || a.status === 'APPROVED' || a.status === 'REJECTED');
                        const hasPending = vApprovals.some((a) => a.status === 'PENDING');
                        const hasApproved = vApprovals.some((a) => a.status === 'APPROVED');
                        const isCurrentPublished = policy.currentVersionId === v.id;

                        return (
                            <div key={v.id} className={cn(cardVariants({ density: 'compact' }), 'space-y-compact')}>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-compact">
                                        <span className="text-sm font-semibold text-[var(--brand-default)]">v{v.versionNumber}</span>
                                        {isCurrentPublished && <StatusBadge variant="success">{t('published')}</StatusBadge>}
                                        {v.contentType === 'EXTERNAL_LINK' && <StatusBadge variant="info">{t('externalLink')}</StatusBadge>}
                                        <span className="text-xs text-content-subtle">
                                            {v.createdBy?.name} · {formatDate(v.createdAt)}
                                        </span>
                                    </div>
                                    <div className="flex gap-tight">
                                        {canWrite && !hasPending && !isCurrentPublished && (
                                            <Button variant="secondary" size="sm" onClick={() => requestApproval(v.id)} disabled={!!actionLoading} id={`request-approval-${v.versionNumber}`}>
                                                {actionLoading === 'approve-' + v.id ? '...' : t('requestApproval')}
                                            </Button>
                                        )}
                                        {canAdmin && hasApproved && !isCurrentPublished && (
                                            <Button variant="primary" size="sm" onClick={() => publishVersion(v.id)} disabled={!!actionLoading} id={`publish-version-${v.versionNumber}`}>
                                                {actionLoading === 'publish-' + v.id ? '...' : t('publish')}
                                            </Button>
                                        )}
                                    </div>
                                </div>
                                {v.changeSummary && <p className="text-sm text-content-muted italic">{v.changeSummary}</p>}
                                <details className="group">
                                    <summary className="text-xs text-[var(--brand-default)] cursor-pointer hover:text-[var(--brand-muted)]">{t('showContent')}</summary>
                                    <div className="mt-2 border-t border-border-default pt-2">{renderVersionContent(v)}</div>
                                </details>
                                {vApprovals.length > 0 && (
                                    <div className="border-t border-border-default/50 pt-2 space-y-1">
                                        <p className="text-xs font-semibold text-content-subtle">{t('approvalsHeading')}</p>
                                        {vApprovals.map((a) => (
                                            <div key={a.id} className="flex items-center justify-between text-xs">
                                                <div className="flex items-center gap-tight">
                                                    <StatusBadge variant={APPROVAL_BADGE[a.status]}>{a.status}</StatusBadge>
                                                    <span className="text-content-muted">
                                                        {t('by', { name: a.requestedBy?.name || t('unknown') })}
                                                        {a.decidedAt && ` · ${formatDate(a.decidedAt)}`}
                                                    </span>
                                                </div>
                                                {canAdmin && a.status === 'PENDING' && (
                                                    <div className="flex gap-1">
                                                        <Button variant="primary" size="xs" onClick={() => decideApproval(a.id, 'APPROVED')} disabled={!!actionLoading} id={`approve-${a.id}`}>
                                                            {actionLoading === 'decide-' + a.id ? '...' : t('approve')}
                                                        </Button>
                                                        <Button variant="destructive" size="xs" onClick={() => decideApproval(a.id, 'REJECTED')} disabled={!!actionLoading}>{t('reject')}</Button>
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* ── Editor ── */}
            {tab === 'editor' && canWrite && (
                <div className={cn(cardVariants(), 'space-y-default')}>
                    <div className="flex items-center justify-between">
                        <Heading level={3}>{t('createNewVersion')}</Heading>
                    </div>

                    {/* Content type selector */}
                    <div className="flex gap-tight">
                        {([
                            { key: 'MARKDOWN' as const, label: t('markdown'), icon: '' },
                            { key: 'EXTERNAL_LINK' as const, label: t('externalLinkOpt'), icon: '' },
                            { key: 'FILE' as const, label: t('fileUpload'), icon: '' },
                        ]).map(opt => (
                            <button key={opt.key} onClick={() => setContentMode(opt.key)}
                                className={`px-3 py-1.5 text-xs rounded-lg border transition ${contentMode === opt.key
                                        ? 'border-[var(--brand-default)] bg-[var(--brand-subtle)] text-[var(--brand-default)]'
                                        : 'border-border-default text-content-muted hover:text-content-emphasis'
                                    }`} id={`mode-${opt.key.toLowerCase()}`}>{opt.label}</button>
                        ))}
                    </div>

                    {/* Markdown / WYSIWYG editor (Epic 45.2) */}
                    {contentMode === 'MARKDOWN' && (
                        <RichTextEditor
                            id="version-editor"
                            value={editorContent}
                            contentType={editorContentType}
                            placeholder={t('editorPlaceholder')}
                            onChange={(value, contentType) => {
                                setEditorContent(value);
                                setEditorContentType(contentType);
                            }}
                        />
                    )}

                    {/* External link input */}
                    {contentMode === 'EXTERNAL_LINK' && (
                        <div>
                            <label className="input-label">{t('externalDocUrl')}</label>
                            <input type="url" className="input w-full" value={externalUrl}
                                onChange={e => setExternalUrl(e.target.value)}
                                placeholder="https://docs.google.com/..." id="external-url-input" />
                            <p className="text-xs text-content-subtle mt-1">{t('externalHint')}</p>
                        </div>
                    )}

                    {/* File upload */}
                    {contentMode === 'FILE' && (
                        <div>
                            <label className="input-label">{t('uploadFile')}</label>
                            <input type="file" className="input w-full" id="file-upload-input"
                                onChange={e => setSelectedFile(e.target.files?.[0] || null)}
                                accept=".pdf,.doc,.docx,.txt,.md" />
                            {selectedFile && (
                                <p className="text-xs text-[var(--brand-default)] mt-1">{selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)</p>
                            )}
                        </div>
                    )}

                    <div>
                        <label className="input-label">{t('changeSummary')}</label>
                        <input className="input w-full" value={changeSummary} onChange={e => setChangeSummary(e.target.value)}
                            placeholder={t('changeSummaryPlaceholder')} id="change-summary-input" />
                    </div>

                    <Button variant="primary" onClick={createVersion} disabled={saving} id="save-version-btn">
                        {saving ? t('saving') : '+ Version'}
                    </Button>
                </div>
            )}

            {/* ── Activity Feed ── */}
            {tab === 'activity' && (
                <div className={cardVariants()} id="activity-feed">
                    <Heading level={3} className="mb-4">{t('activityTimeline')}</Heading>
                    {activitiesLoading ? (
                        <div className="text-center text-content-subtle animate-pulse py-8">{t('loadingActivity')}</div>
                    ) : activities.length === 0 ? (
                        <div className="text-center text-content-subtle py-8">{t('noActivity')}</div>
                    ) : (
                        <div className="space-y-compact">
                            {activities.map((evt: AuditLogEntry) => (
                                <div key={evt.id} className="flex items-start gap-compact text-sm">
                                    <span className="text-base mt-0.5">{EVENT_ICONS[evt.action] || 'event'}</span>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-tight">
                                            <span className="font-medium text-content-emphasis text-xs">
                                                {evt.action.replace('POLICY_', '').replace(/_/g, ' ')}
                                            </span>
                                            <span className="text-xs text-content-subtle">{relativeTime(evt.createdAt)}</span>
                                        </div>
                                        <p className="text-xs text-content-muted mt-0.5 truncate">
                                            {evt.user?.name || t('system')}{evt.details ? ` — ${evt.details.split('\n')[0]}` : ''}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </EntityDetailLayout>
    );
}
