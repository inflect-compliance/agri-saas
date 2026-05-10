'use client';
/* TODO(swr-migration): this file has fetch-on-mount + setState
 * patterns flagged by react-hooks/set-state-in-effect. Each call site
 * carries an inline disable directive; collectively they should
 * migrate to useTenantSWR (Epic 69 shape) so the rule can lift. */

import { formatDate, formatDateTime } from '@/lib/format-date';
import { SkeletonCard } from '@/components/ui/skeleton';
import { InlineEmptyState } from '@/components/ui/inline-empty-state';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useSWRConfig } from 'swr';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { StatusBadge, type StatusBadgeVariant } from '@/components/ui/status-badge';
import { Heading, textLinkVariants } from '@/components/ui/typography';
import { EditControlModal } from './_modals/EditControlModal';
import { MetaStrip } from '@/components/ui/meta-strip';
import { CONTROL_STATUS_VARIANT } from '@/app-layer/domain/entity-status-mapping';
// Inline pencil icon to avoid lucide-react barrel import issue with Next.js 14
const PencilIcon = ({ size = 14 }: { size?: number }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
);
import { useTenantApiUrl, useTenantHref, useTenantContext } from '@/lib/tenant-context-provider';
import { Button } from '@/components/ui/button';
import { useTenantSWR } from '@/lib/hooks/use-tenant-swr';
import { useTenantMutation } from '@/lib/hooks/use-tenant-mutation';
import { CACHE_KEYS } from '@/lib/swr-keys';
import { extractMutationError } from '@/lib/mutations';
import { useToastWithUndo } from '@/components/ui/hooks';
import { Modal } from '@/components/ui/modal';
import { Combobox, ComboboxOption } from '@/components/ui/combobox';
import { Tooltip } from '@/components/ui/tooltip';
import { CopyText } from '@/components/ui/copy-text';
import { ProgressBar } from '@/components/ui/progress-bar';
import { DatePicker } from '@/components/ui/date-picker/date-picker';
import {
    parseYMD,
    startOfUtcDay,
    toYMD,
} from '@/components/ui/date-picker/date-utils';
import dynamic from 'next/dynamic';
import { EntityDetailLayout } from '@/components/layout/EntityDetailLayout';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@dub/utils';

const TraceabilityPanel = dynamic(() => import('@/components/TraceabilityPanel'), {
    loading: () => <SkeletonCard lines={3} />,
    ssr: false,
});
// Epic G-5 — exceptions panel + header badge. The badge alone is
// loaded eagerly via a tiny named import so the control header can
// surface "Exception: APPROVED" without waiting for the modal
// machinery in the panel chunk.
const ControlExceptionsPanel = dynamic(
    () => import('@/components/ControlExceptionsPanel').then((m) => m.ControlExceptionsPanel),
    {
        loading: () => <SkeletonCard lines={3} />,
        ssr: false,
    },
);
const ControlExceptionHeaderBadge = dynamic(
    () => import('@/components/ControlExceptionsPanel').then((m) => m.ControlExceptionHeaderBadge),
    { ssr: false },
);
const TestPlansPanel = dynamic(() => import('@/components/TestPlansPanel'), {
    loading: () => <SkeletonCard lines={3} />,
    ssr: false,
});
const LinkedTasksPanel = dynamic(() => import('@/components/LinkedTasksPanel'), {
    loading: () => <SkeletonCard lines={3} />,
    ssr: false,
});
import type {
    ControlDetailDTO, ControlTaskDTO, EvidenceLinkDTO,
    FrameworkMappingDTO, ContributorDTO, AuditLogEntry,
} from '@/lib/dto';
import type { FrameworkDTO, RequirementDTO } from '@/lib/dto';

// Polish PR-1 — STATUS_BADGE moved to shared domain mapping as
// CONTROL_STATUS_VARIANT in @/app-layer/domain/entity-status-mapping.
// Labels stay local because they're presentation copy.
const STATUS_LABELS: Record<string, string> = {
    NOT_STARTED: 'Not Started', IN_PROGRESS: 'In Progress', IMPLEMENTED: 'Implemented',
    NEEDS_REVIEW: 'Needs Review',
};
const TASK_STATUS_BADGE: Record<string, StatusBadgeVariant> = {
    OPEN: 'neutral', IN_PROGRESS: 'info', DONE: 'success', BLOCKED: 'error',
};
const FREQ_LABELS: Record<string, string> = {
    AD_HOC: 'Ad Hoc', DAILY: 'Daily', WEEKLY: 'Weekly',
    MONTHLY: 'Monthly', QUARTERLY: 'Quarterly', ANNUALLY: 'Annually',
};
const FREQ_OPTIONS = ['', 'AD_HOC', 'DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUALLY'];
const FREQ_CB_OPTIONS: ComboboxOption[] = FREQ_OPTIONS.filter(Boolean).map(f => ({ value: f, label: FREQ_LABELS[f] || f }));
const CATEGORY_OPTIONS = ['', 'ORGANIZATIONAL', 'PEOPLE', 'PHYSICAL', 'TECHNOLOGICAL'];
const CATEGORY_LABELS: Record<string, string> = {
    ORGANIZATIONAL: 'Organizational', PEOPLE: 'People', PHYSICAL: 'Physical', TECHNOLOGICAL: 'Technological',
};
const CATEGORY_CB_OPTIONS: ComboboxOption[] = CATEGORY_OPTIONS.filter(Boolean).map(c => ({ value: c, label: CATEGORY_LABELS[c] || c }));
const STATUS_CB_OPTIONS: ComboboxOption[] = Object.entries(STATUS_LABELS).map(([val, lbl]) => ({ value: val, label: lbl }));
const EVIDENCE_SOURCE_OPTIONS: ComboboxOption[] = [
    { value: 'MANUAL', label: 'Manual' },
    { value: 'INTEGRATION', label: 'Integration' },
];

type Tab = 'overview' | 'tasks' | 'evidence' | 'mappings' | 'traceability' | 'activity' | 'tests';

const EVENT_LABELS: Record<string, string> = {
    CONTROL_CREATED: 'Created', CONTROL_UPDATED: 'Updated', CONTROL_STATUS_CHANGED: 'Status Changed',
    CONTROL_APPLICABILITY_CHANGED: 'Applicability Changed', CONTROL_OWNER_CHANGED: 'Owner Changed',
    CONTROL_CONTRIBUTOR_ADDED: 'Contributor Added', CONTROL_CONTRIBUTOR_REMOVED: 'Contributor Removed',
    CONTROL_TASK_CREATED: 'Task Created', CONTROL_TASK_COMPLETED: 'Task Completed',
    CONTROL_TASK_UPDATED: 'Task Updated', CONTROL_EVIDENCE_LINKED: 'Evidence Linked',
    CONTROL_EVIDENCE_UNLINKED: 'Evidence Unlinked', CONTROL_TEST_COMPLETED: 'Test Completed',
    CONTROL_INSTALLED_FROM_TEMPLATE: 'Installed from Template',
};

export default function ControlDetailPage() {
    const params = useParams();
    const apiUrl = useTenantApiUrl();
    const tenantHref = useTenantHref();
    const { permissions, tenantSlug } = useTenantContext();
    const controlId = params?.controlId as string;
    const { mutate: swrMutate } = useSWRConfig();
    const triggerUndoToast = useToastWithUndo();

    // ─── Page data — Epic 69 SWR-first read ──────────────────────────
    //
    // Hits `/controls/:id/page-data` which collapses the prior
    // serial waterfall (GET /controls/:id THEN GET /controls/:id/sync)
    // into one round-trip. The sync sub-payload is `null` for
    // controls without an `automationKey` or when the mapping lookup
    // fails — the page renders the conflict badge unconditionally
    // against it.
    //
    // Epic 69 migration: this read used to flow through TanStack
    // React Query (`useQuery` + `queryKeys.controls.detail`). It's
    // now a `useTenantSWR` against `CACHE_KEYS.controls.pageData(id)`
    // so the status mutation below can apply optimistic updates that
    // the rest of the UI sees immediately. Other pages on this
    // codebase still use React Query — that migration is incremental.
    interface ControlPageDataDTO {
        control: ControlDetailDTO;
        syncStatus: {
            syncStatus: string | null;
            lastSyncedAt: string | null;
            errorMessage: string | null;
            provider: string | null;
        } | null;
    }
    const pageDataKey = controlId
        ? CACHE_KEYS.controls.pageData(controlId)
        : null;
    const pageDataQuery = useTenantSWR<ControlPageDataDTO>(pageDataKey);
    const control = pageDataQuery.data?.control ?? null;
    const loading = pageDataQuery.isLoading;
    const error =
        pageDataQuery.error
            ? pageDataQuery.error.message || 'Control not found'
            : '';
    // Stable revalidation handle that mirrors the prior `refetch()`
    // contract — `mutate(undefined)` re-runs the fetcher for this
    // hook's key. Wrapped in `useCallback` so the call sites that
    // pass it down to event handlers don't re-bind on every render.
    const refetch = useCallback(
        () => pageDataQuery.mutate(),
        [pageDataQuery],
    );
    const initialSyncStatus = pageDataQuery.data?.syncStatus ?? null;
    const [tab, setTab] = useState<Tab>('overview');

    // Status change
    const [changingStatus, setChangingStatus] = useState(false);

    // Applicability
    const [showApplicability, setShowApplicability] = useState(false);
    const [appChoice, setAppChoice] = useState('APPLICABLE');
    const [appJustification, setAppJustification] = useState('');
    const [savingApp, setSavingApp] = useState(false);

    // Task creation
    const [showTaskForm, setShowTaskForm] = useState(false);
    const [taskTitle, setTaskTitle] = useState('');
    const [taskDesc, setTaskDesc] = useState('');
    const [taskDue, setTaskDue] = useState('');
    const [savingTask, setSavingTask] = useState(false);

    // Evidence linking
    const [showEvidenceForm, setShowEvidenceForm] = useState(false);
    const [evidenceUrl, setEvidenceUrl] = useState('');
    const [evidenceNote, setEvidenceNote] = useState('');
    const [savingEvidence, setSavingEvidence] = useState(false);

    // File upload for this control
    const [showFileUpload, setShowFileUpload] = useState(false);
    const [fileToUpload, setFileToUpload] = useState<File | null>(null);
    const [fileUploadTitle, setFileUploadTitle] = useState('');
    const [fileUploading, setFileUploading] = useState(false);
    const [fileUploadError, setFileUploadError] = useState('');
    const fileUploadRef = useRef<HTMLInputElement>(null);

    // Mapping
    const [showMapForm, setShowMapForm] = useState(false);
    const [frameworks, setFrameworks] = useState<FrameworkDTO[]>([]);
    const [selectedFramework, setSelectedFramework] = useState('');
    const [requirements, setRequirements] = useState<RequirementDTO[]>([]);
    const [selectedReq, setSelectedReq] = useState('');
    const [savingMap, setSavingMap] = useState(false);

    // Activity trail
    const [activity, setActivity] = useState<AuditLogEntry[]>([]);
    const [activityLoading, setActivityLoading] = useState(false);

    // Test completed
    const [markingTest, setMarkingTest] = useState(false);

    // Automation
    const [editingAutomation, setEditingAutomation] = useState(false);
    const [autoEvidenceSource, setAutoEvidenceSource] = useState('');
    const [autoKey, setAutoKey] = useState('');
    const [savingAutomation, setSavingAutomation] = useState(false);

    // Sync status (conflict badge + Sync Now)
    const [syncStatus, setSyncStatus] = useState<string | null>(null);
    const [syncLastAt, setSyncLastAt] = useState<string | null>(null);
    const [syncError, setSyncError] = useState<string | null>(null);
    const [syncing, setSyncing] = useState(false);
    const [syncResult, setSyncResult] = useState<{ status: string; summary?: string } | null>(null);

    // Edit modal state
    const [showEditModal, setShowEditModal] = useState(false);
    const [editForm, setEditForm] = useState({ name: '', description: '', intent: '', category: '', frequency: '', owner: '' });
    const [savingEdit, setSavingEdit] = useState(false);
    const [editError, setEditError] = useState('');
    const [editSuccess, setEditSuccess] = useState(false);

    // (fetchControl replaced by useQuery above — use refetch() below)

    // ─── Edit modal handlers ───

    const openEditModal = () => {
        if (!control) return;
        setEditForm({
            name: control.name || '',
            description: control.description || '',
            intent: control.intent || '',
            category: control.category || '',
            frequency: control.frequency || '',
            owner: control.ownerUserId || '',
        });
        setEditError('');
        setEditSuccess(false);
        setShowEditModal(true);
    };


    // ─── Mutation: edit control ─────────────────────────────────────
    //
    // Epic 69 migration — the prior React Query `useMutation` with
    // `onMutate` / `onError` rollback hooks is now a single
    // `useTenantMutation`. The optimistic update walks the cached
    // page-data shape (control nested under `pageData.control`)
    // because the SWR cache holds the whole envelope, not the bare
    // detail. Rollback is automatic on throw via SWR's
    // `rollbackOnError: true` default.
    const editMutation = useTenantMutation<
        ControlPageDataDTO,
        typeof editForm,
        unknown
    >({
        key: pageDataKey ?? '',
        mutationFn: async (form) => {
            const res = await fetch(apiUrl(`/controls/${controlId}`), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: form.name.trim(),
                    description: form.description.trim() || null,
                    intent: form.intent.trim() || null,
                    category: form.category.trim() || null,
                    frequency: form.frequency || null,
                }),
            });
            if (!res.ok) {
                const err = await res
                    .json()
                    .catch(() => ({ error: 'Update failed' }));
                throw new Error(extractMutationError(err, 'Update failed'));
            }
            // If owner changed, call the separate owner endpoint
            const originalOwner = control?.ownerUserId || '';
            if (form.owner.trim() !== originalOwner) {
                const ownerRes = await fetch(
                    apiUrl(`/controls/${controlId}/owner`),
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            ownerUserId: form.owner.trim() || null,
                        }),
                    },
                );
                if (!ownerRes.ok) {
                    const ownerErr = await ownerRes
                        .json()
                        .catch(() => ({ error: 'Owner update failed' }));
                    throw new Error(
                        extractMutationError(ownerErr, 'Owner update failed'),
                    );
                }
            }
            return form;
        },
        optimisticUpdate: (current, form) =>
            current
                ? {
                      ...current,
                      control: {
                          ...current.control,
                          name: form.name.trim(),
                          description: form.description.trim() || null,
                          intent: form.intent.trim() || null,
                          category: form.category.trim() || null,
                          frequency: form.frequency || null,
                      },
                  }
                : (current as unknown as ControlPageDataDTO),
        // Refresh the list cache too — the controls list page shows
        // these same fields.
        invalidate: [CACHE_KEYS.controls.list()],
    });

    const handleEditSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editForm.name || editForm.name.trim().length < 3) {
            setEditError('Title must be at least 3 characters.');
            return;
        }
        setSavingEdit(true);
        setEditError('');
        try {
            await editMutation.trigger(editForm);
            setShowEditModal(false);
            setEditSuccess(true);
            setTimeout(() => setEditSuccess(false), 3000);
        } catch (err) {
            setEditError(err instanceof Error ? err.message : 'Update failed');
        } finally {
            setSavingEdit(false);
        }
    };

    const handleEditCancel = () => {
        setShowEditModal(false);
        setEditError('');
    };

    // Fetch frameworks when mapping tab opens
    useEffect(() => {
        if (tab !== 'mappings') return;
        fetch(apiUrl('/controls/frameworks')).then(r => r.ok ? r.json() : []).then(setFrameworks).catch(() => { });
    }, [tab, apiUrl]);

    // Fetch requirements when framework selected
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (!selectedFramework) { setRequirements([]); return; }
        fetch(apiUrl(`/controls/frameworks/${selectedFramework}/requirements`))
            .then(r => r.ok ? r.json() : []).then(setRequirements).catch(() => { });
    }, [selectedFramework, apiUrl]);

    // Fetch activity when activity tab opens
    useEffect(() => {
        if (tab !== 'activity') return;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setActivityLoading(true);
        fetch(apiUrl(`/controls/${controlId}/activity`)).then(r => r.ok ? r.json() : []).then(setActivity).catch(() => { }).finally(() => setActivityLoading(false));
    }, [tab, apiUrl, controlId]);

    // Hydrate sync status from the page-data response (one round-trip
    // instead of the previous control-then-sync waterfall). The
    // dependency on the data identity — not just on automationKey —
    // ensures the badge updates after `refetch()` lands a fresh
    // page-data payload (e.g. after Sync Now or after an edit that
    // changes the automationKey).
    useEffect(() => {
        if (!initialSyncStatus) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setSyncStatus(null);
            setSyncLastAt(null);
            setSyncError(null);
            return;
        }
        setSyncStatus(initialSyncStatus.syncStatus ?? null);
        setSyncLastAt(initialSyncStatus.lastSyncedAt ?? null);
        setSyncError(initialSyncStatus.errorMessage ?? null);
    }, [initialSyncStatus]);

    const handleSyncNow = async () => {
        setSyncing(true);
        setSyncResult(null);
        try {
            const res = await fetch(apiUrl(`/controls/${controlId}/sync`), { method: 'POST' });
            const data = await res.json();
            if (res.ok && data.execution) {
                setSyncResult({ status: data.execution.status, summary: data.execution.summary });
                // One refetch — the page-data payload re-runs the
                // sync-mapping lookup server-side, so we get the
                // post-sync status without a second round-trip. The
                // useEffect on `initialSyncStatus` writes the new
                // values into the badge state.
                await refetch();
            } else {
                setSyncResult({ status: 'ERROR', summary: data.error || 'Sync failed' });
            }
        } catch {
            setSyncResult({ status: 'ERROR', summary: 'Network error' });
        }
        setSyncing(false);
    };

    const handleMarkTestCompleted = async () => {
        setMarkingTest(true);
        await fetch(apiUrl(`/controls/${controlId}/test-completed`), { method: 'POST' });
        await refetch();
        setMarkingTest(false);
    };

    const saveAutomation = async () => {
        setSavingAutomation(true);
        await fetch(apiUrl(`/controls/${controlId}`), {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ evidenceSource: autoEvidenceSource || null, automationKey: autoKey || null }),
        });
        await refetch();
        setSavingAutomation(false);
        setEditingAutomation(false);
    };

    // ─── Mutation: change control status (Epic 69 pilot #2) ────────
    //
    // The headline migration of this file. The previous flow was
    // `fetch(POST /status) → await refetch() → invalidateQueries(list)`,
    // a coarse round-trip that left the badge showing the old value
    // for the duration of the network call.
    //
    // The new flow uses `useTenantMutation`:
    //
    //   1. `optimisticUpdate` flips `control.status` in the cached
    //      page-data envelope synchronously — the badge re-renders
    //      with the predicted value before the POST is sent.
    //   2. `mutationFn` performs the POST. A non-2xx response throws.
    //   3. On success, SWR background-revalidates the page-data key
    //      (re-fetches `/controls/{id}/page-data`) — confirming the
    //      server agrees with the prediction. The `invalidate`
    //      sibling (`/controls`) refreshes the list page in parallel.
    //   4. On failure, `rollbackOnError: true` (the default) restores
    //      the prior `control.status` automatically — the badge
    //      flips back to the original value with no spinner thrash.
    //
    // No `router.refresh()` involved. No coarse page reload. No
    // imperative `refetch()` chained behind state setters.
    const statusMutation = useTenantMutation<
        ControlPageDataDTO,
        { status: string },
        unknown
    >({
        key: pageDataKey ?? '',
        mutationFn: async ({ status }) => {
            const res = await fetch(apiUrl(`/controls/${controlId}/status`), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status }),
            });
            if (!res.ok) {
                const err = await res
                    .json()
                    .catch(() => ({ error: 'Status update failed' }));
                throw new Error(
                    extractMutationError(err, 'Status update failed'),
                );
            }
            return res.json().catch(() => null);
        },
        optimisticUpdate: (current, { status }) =>
            current
                ? {
                      ...current,
                      control: { ...current.control, status },
                  }
                : (current as unknown as ControlPageDataDTO),
        // List page shows status badges too — keep it in sync.
        invalidate: [CACHE_KEYS.controls.list()],
    });

    const changeStatus = async (status: string) => {
        setChangingStatus(true);
        try {
            await statusMutation.trigger({ status });
        } catch {
            // Rollback already applied by the hook; the error is
            // available on `statusMutation.error` for any future
            // toast surface. Status badge has reverted on its own.
        } finally {
            setChangingStatus(false);
        }
    };

    const saveApplicability = async () => {
        if (appChoice === 'NOT_APPLICABLE' && !appJustification.trim()) return;
        setSavingApp(true);
        await fetch(apiUrl(`/controls/${controlId}/applicability`), {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ applicability: appChoice, justification: appChoice === 'NOT_APPLICABLE' ? appJustification : null }),
        });
        await refetch();
        setSavingApp(false);
        setShowApplicability(false);
    };

    const createTask = async (e: React.FormEvent) => {
        e.preventDefault();
        setSavingTask(true);
        await fetch(apiUrl(`/controls/${controlId}/tasks`), {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: taskTitle, description: taskDesc || undefined, dueAt: taskDue || undefined }),
        });
        setTaskTitle(''); setTaskDesc(''); setTaskDue('');
        setShowTaskForm(false);
        await refetch();
        setSavingTask(false);
    };

    const updateTaskStatus = async (taskId: string, status: string) => {
        await fetch(apiUrl(`/controls/tasks/${taskId}`), {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status }),
        });
        await refetch();
    };

    const linkEvidence = async (e: React.FormEvent) => {
        e.preventDefault();
        setSavingEvidence(true);
        await fetch(apiUrl(`/controls/${controlId}/evidence`), {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kind: 'LINK', url: evidenceUrl, note: evidenceNote || undefined }),
        });
        setEvidenceUrl(''); setEvidenceNote('');
        setShowEvidenceForm(false);
        await refetch();
        setSavingEvidence(false);
    };

    // Epic 67 — delayed-commit unlink. Optimistic remove via SWR
    // `mutate(key, value, { revalidate: false })` so the row
    // disappears immediately; the actual DELETE fires after the 5 s
    // undo window. Snapshot is the WHOLE pageData so undo can
    // restore even if the user concurrently triggered another
    // change.
    //
    // Migrated from `queryClient.setQueryData/getQueryData` to the
    // SWR equivalent in the Epic 69 pass — semantics identical.
    const unlinkEvidence = (linkId: string) => {
        if (!pageDataKey) return;
        const cacheKey = apiUrl(pageDataKey);
        const previous = pageDataQuery.data;
        if (previous) {
            swrMutate<ControlPageDataDTO>(
                cacheKey,
                {
                    ...previous,
                    control: {
                        ...previous.control,
                        evidenceLinks: (previous.control.evidenceLinks || [])
                            .filter(
                                (link: EvidenceLinkDTO) => link.id !== linkId,
                            ),
                    },
                },
                { revalidate: false },
            );
        }
        triggerUndoToast({
            message: 'Evidence unlinked',
            undoMessage: 'Undo',
            action: async () => {
                const res = await fetch(
                    apiUrl(`/controls/${controlId}/evidence/${linkId}`),
                    { method: 'DELETE' },
                );
                if (!res.ok) throw new Error('Unlink failed');
                await refetch();
            },
            undoAction: () => {
                if (previous) {
                    swrMutate<ControlPageDataDTO>(cacheKey, previous, {
                        revalidate: false,
                    });
                }
            },
            onError: () => {
                if (previous) {
                    swrMutate<ControlPageDataDTO>(cacheKey, previous, {
                        revalidate: false,
                    });
                }
            },
        });
    };

    const handleFileUpload = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!fileToUpload) return;
        setFileUploading(true);
        setFileUploadError('');
        try {
            const formData = new FormData();
            formData.append('file', fileToUpload);
            if (fileUploadTitle) formData.append('title', fileUploadTitle);
            formData.append('controlId', controlId);
            const res = await fetch(apiUrl('/evidence/uploads'), { method: 'POST', body: formData });
            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: 'Upload failed' }));
                throw new Error(err.error || err.message || 'Upload failed');
            }
            setFileToUpload(null);
            setFileUploadTitle('');
            setShowFileUpload(false);
            if (fileUploadRef.current) fileUploadRef.current.value = '';
            await refetch();
        } catch (err: unknown) {
            setFileUploadError(err instanceof Error ? err.message : 'Upload failed');
        } finally {
            setFileUploading(false);
        }
    };

    const mapRequirement = async () => {
        if (!selectedReq) return;
        setSavingMap(true);
        await fetch(apiUrl(`/controls/${controlId}/requirements`), {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requirementId: selectedReq }),
        });
        setSelectedReq('');
        setShowMapForm(false);
        await refetch();
        setSavingMap(false);
    };

    // Epic 67 — delayed-commit unmap. Same shape as unlinkEvidence
    // above; migrated to SWR cache writes in the Epic 69 pass.
    const unmapRequirement = (reqId: string) => {
        if (!pageDataKey) return;
        const cacheKey = apiUrl(pageDataKey);
        const previous = pageDataQuery.data;
        if (previous) {
            swrMutate<ControlPageDataDTO>(
                cacheKey,
                {
                    ...previous,
                    control: {
                        ...previous.control,
                        frameworkMappings: (previous.control.frameworkMappings || [])
                            .filter(
                                (m: FrameworkMappingDTO) =>
                                    m.fromRequirement?.id !== reqId &&
                                    m.fromRequirementId !== reqId,
                            ),
                    },
                },
                { revalidate: false },
            );
        }
        triggerUndoToast({
            message: 'Requirement unmapped',
            undoMessage: 'Undo',
            action: async () => {
                const res = await fetch(
                    apiUrl(`/controls/${controlId}/requirements`),
                    {
                        method: 'DELETE',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ requirementId: reqId }),
                    },
                );
                if (!res.ok) throw new Error('Unmap failed');
                await refetch();
            },
            undoAction: () => {
                if (previous) {
                    swrMutate<ControlPageDataDTO>(cacheKey, previous, {
                        revalidate: false,
                    });
                }
            },
            onError: () => {
                if (previous) {
                    swrMutate<ControlPageDataDTO>(cacheKey, previous, {
                        revalidate: false,
                    });
                }
            },
        });
    };

    // Loading / error / empty states render through the shared
    // EntityDetailLayout — same skeleton + same error/empty copy
    // every detail page in Inflect uses.
    if (loading) {
        return (
            <EntityDetailLayout loading title="">
                {null}
            </EntityDetailLayout>
        );
    }
    if (error) {
        return (
            <EntityDetailLayout error={error} title="">
                {null}
            </EntityDetailLayout>
        );
    }
    if (!control) {
        return (
            <EntityDetailLayout empty={{ message: 'Control not found.' }} title="">
                {null}
            </EntityDetailLayout>
        );
    }

    const doneTasks = control.controlTasks?.filter((t: ControlTaskDTO) => t.status === 'DONE').length ?? 0;
    const totalTasks = control.controlTasks?.length ?? 0;
    const tabs: { key: Tab; label: string; count?: number }[] = [
        { key: 'overview', label: 'Overview' },
        { key: 'tasks', label: 'Tasks', count: totalTasks },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { key: 'evidence', label: 'Evidence', count: (control.evidenceLinks?.length ?? 0) + ((control.evidence ?? []).filter((e: any) => !e.fileRecordId || !control.evidenceLinks?.some((l: EvidenceLinkDTO) => l.fileId === e.fileRecordId)).length) },
        { key: 'mappings', label: 'Mappings', count: control.frameworkMappings?.length ?? 0 },
        { key: 'traceability', label: 'Traceability' },
        { key: 'activity', label: 'Activity' },
        { key: 'tests', label: 'Tests' },
    ];

    // ── Header meta strip (Polish PR-1) ──
    //
    // Replaced a 6-badge fragment with the shared <MetaStrip>
    // primitive. Sync-state indicators (CONFLICT / FAILED / SYNCED)
    // moved OUT of meta into a per-page InlineNotice — they're
    // alerts, not metadata. The exception badge stays as a
    // status-shaped meta entry; the per-control code stays as a
    // copyable text entry.
    const headerMeta = (
        <MetaStrip
            items={[
                ...(control.code
                    ? [
                          {
                              label: 'Code',
                              value: (
                                  <CopyText
                                      value={control.code}
                                      label={`Copy control code ${control.code}`}
                                      successMessage="Control code copied"
                                      className="text-xs text-content-subtle"
                                  >
                                      {control.code}
                                  </CopyText>
                              ),
                          } as const,
                      ]
                    : []),
                {
                    kind: 'status' as const,
                    id: 'control-status',
                    label: 'Status',
                    value: STATUS_LABELS[control.status] ?? control.status,
                    variant:
                        CONTROL_STATUS_VARIANT[control.status] ?? 'neutral',
                },
                {
                    kind: 'status' as const,
                    id: 'control-applicability',
                    label: 'Applicability',
                    value:
                        control.applicability === 'NOT_APPLICABLE'
                            ? 'Not Applicable'
                            : 'Applicable',
                    variant:
                        control.applicability === 'NOT_APPLICABLE'
                            ? 'warning'
                            : 'success',
                },
            ]}
        />
    );

    // Sync state migrated out of the meta strip — shown as a banner
    // below the page header so the meta strip stays at 3 stable
    // items.
    const syncBanner = (
        <>
            {syncStatus === 'CONFLICT' && (
                <Tooltip
                    title="Sync conflict"
                    content={syncError ?? 'Local and remote state diverged — resolve before editing.'}
                >
                    <StatusBadge variant="error" className="flex items-center gap-1 cursor-help" id="sync-conflict-badge">
                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
                        Sync Conflict
                    </StatusBadge>
                </Tooltip>
            )}
            {syncStatus === 'FAILED' && (
                <Tooltip
                    title="Last sync failed"
                    content={syncError ?? 'The integration could not reach the source system.'}
                >
                    <StatusBadge variant="error" className="flex items-center gap-1 cursor-help" id="sync-failed-badge">
                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>
                        Sync Failed
                    </StatusBadge>
                </Tooltip>
            )}
            {syncStatus === 'SYNCED' && (
                <Tooltip content={syncLastAt ? `Last synced: ${formatDateTime(syncLastAt)}` : 'Synced'}>
                    <StatusBadge variant="success" className="flex items-center gap-1 cursor-help" id="sync-ok-badge">
                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                        Synced
                    </StatusBadge>
                </Tooltip>
            )}
            <ControlExceptionHeaderBadge
                tenantSlug={tenantSlug}
                controlId={control.id}
            />
        </>
    );

    // ── Header actions (right side) ──
    const headerActions = permissions.canWrite ? (
        <>
            <Combobox
                hideSearch
                id="control-status-select"
                selected={STATUS_CB_OPTIONS.find(o => o.value === control.status) ?? null}
                setSelected={(opt) => { if (opt) changeStatus(opt.value); }}
                options={STATUS_CB_OPTIONS}
                disabled={changingStatus}
                placeholder="Status"
                matchTriggerWidth
                buttonProps={{ className: 'w-40 text-sm' }}
            />
            <Button variant="secondary" onClick={() => { setAppChoice(control.applicability); setAppJustification(control.applicabilityJustification || ''); setShowApplicability(!showApplicability); }} id="toggle-applicability-btn">
                Applicability
            </Button>
            {control.applicability !== 'NOT_APPLICABLE' && (
                <Button variant="primary" onClick={handleMarkTestCompleted} disabled={markingTest} id="mark-test-completed-btn">
                    {markingTest ? '...' : 'Mark Test Completed'}
                </Button>
            )}
        </>
    ) : null;

    return (
        <EntityDetailLayout
            id="control-detail-page"
            breadcrumbs={[
                { label: 'Dashboard', href: tenantHref('/dashboard') },
                { label: 'Controls', href: tenantHref('/controls') },
                { label: control.name },
            ]}
            title={<span id="control-title">{control.name}</span>}
            meta={headerMeta}
            actions={headerActions}
            tabs={tabs}
            activeTab={tab}
            onTabChange={(next) => setTab(next as Tab)}
        >
            {/* Sync state + exception badges (moved out of meta strip
                in Polish PR-1). Renders inline above tab content. */}
            {(syncStatus !== 'NONE' || true) && (
                <div className="flex flex-wrap gap-tight" data-testid="control-sync-banner">
                    {syncBanner}
                </div>
            )}
            {/* Applicability modal */}
            {showApplicability && permissions.canWrite && (
                <div className={cn(cardVariants({ density: 'compact' }), 'space-y-compact')}>
                    <Heading level={3}>Set Applicability</Heading>
                    <div className="flex gap-default">
                        <label className="flex items-center gap-tight text-sm text-content-default">
                            <input type="radio" value="APPLICABLE" checked={appChoice === 'APPLICABLE'} onChange={() => setAppChoice('APPLICABLE')} />
                            Applicable
                        </label>
                        <label className="flex items-center gap-tight text-sm text-content-default">
                            <input type="radio" value="NOT_APPLICABLE" checked={appChoice === 'NOT_APPLICABLE'} onChange={() => setAppChoice('NOT_APPLICABLE')} />
                            Not Applicable
                        </label>
                    </div>
                    {appChoice === 'NOT_APPLICABLE' && (
                        <textarea className="input w-full" rows={2} placeholder="Justification required..." value={appJustification} onChange={e => setAppJustification(e.target.value)} id="applicability-justification" />
                    )}
                    <Button variant="primary" onClick={saveApplicability} disabled={savingApp || (appChoice === 'NOT_APPLICABLE' && !appJustification.trim())} id="save-applicability-btn">
                        {savingApp ? 'Saving...' : 'Save'}
                    </Button>
                </div>
            )}

            {/* Tab content — tab bar is rendered by EntityDetailLayout */}
            {tab === 'overview' && (
                <div className={cn(cardVariants(), 'space-y-default')}>
                    {/* Overview header with Edit button */}
                    {permissions.canWrite && (
                        <div className="flex justify-end -mt-1 -mb-2">
                            <Button
                                variant="secondary"
                                onClick={openEditModal}
                                data-testid="control-edit-button"
                                id="control-edit-button"
                            >
                                <PencilIcon size={14} />
                                Edit
                            </Button>
                        </div>
                    )}
                    <div className="grid grid-cols-2 gap-section">
                        <div>
                            <span className="text-xs text-content-subtle uppercase">Description</span>
                            <p className="text-sm text-content-default mt-1">{control.description || 'No description.'}</p>
                        </div>
                        <div>
                            <span className="text-xs text-content-subtle uppercase">Intent</span>
                            <p className="text-sm text-content-default mt-1">{control.intent || '—'}</p>
                        </div>
                        <div>
                            <span className="text-xs text-content-subtle uppercase">Category</span>
                            <p className="text-sm text-content-default mt-1">{control.category || '—'}</p>
                        </div>
                        <div>
                            <span className="text-xs text-content-subtle uppercase">Frequency</span>
                            <p className="text-sm text-content-default mt-1">{control.frequency ? FREQ_LABELS[control.frequency] || control.frequency : '—'}</p>
                        </div>
                        <div>
                            <span className="text-xs text-content-subtle uppercase">Owner</span>
                            <p className="text-sm text-content-default mt-1">{control.owner?.name || '—'}</p>
                        </div>
                        <div>
                            <span className="text-xs text-content-subtle uppercase">Tasks Progress</span>
                            <p className="text-sm text-content-default mt-1">{doneTasks}/{totalTasks} completed</p>
                        </div>
                        {control.applicability === 'NOT_APPLICABLE' && control.applicabilityJustification && (
                            <div className="col-span-2">
                                <span className="text-xs text-content-subtle uppercase">N/A Justification</span>
                                <p className="text-sm text-content-warning mt-1">{control.applicabilityJustification}</p>
                            </div>
                        )}
                        <div>
                            <span className="text-xs text-content-subtle uppercase">Contributors</span>
                            <div className="text-sm text-content-default mt-1">
                                {(control.contributors?.length ?? 0) > 0 ? control.contributors?.map((c: ContributorDTO) => (
                                    <StatusBadge variant="neutral" className="mr-1" key={c.user.id}>{c.user.name ?? '—'}</StatusBadge>
                                )) : '—'}
                            </div>
                        </div>
                        <div>
                            <span className="text-xs text-content-subtle uppercase">Last Tested</span>
                            <p className="text-sm text-content-default mt-1">{control.lastTested ? formatDate(control.lastTested) : '—'}</p>
                        </div>
                        <div>
                            <span className="text-xs text-content-subtle uppercase">Next Due</span>
                            <p className="text-sm text-content-default mt-1">{control.nextDueAt ? formatDate(control.nextDueAt) : '—'}</p>
                        </div>
                    </div>
                    {/* Automation Section */}
                    <div className="border-t border-border-default pt-4 mt-4">
                        <div className="flex items-center justify-between mb-2">
                            <Heading level={3}>Automation</Heading>
                            <div className="flex items-center gap-tight">
                                {/* Sync Now button — only when automationKey is set */}
                                {control.automationKey && permissions.canWrite && !editingAutomation && (
                                    <Tooltip content="Manually trigger a sync check against the source system.">
                                        <Button
                                            variant="secondary"
                                            size="xs"
                                            className="flex items-center gap-1 disabled:opacity-50"
                                            onClick={handleSyncNow}
                                            disabled={syncing}
                                            id="sync-now-btn"
                                        >
                                            {syncing ? (
                                                <svg className="animate-spin" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                                            ) : (
                                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
                                            )}
                                            {syncing ? 'Syncing…' : 'Sync Now'}
                                        </Button>
                                    </Tooltip>
                                )}
                                {permissions.canWrite && (
                                    <button className={`${textLinkVariants({ tone: 'link' })} text-xs`} onClick={() => { setAutoEvidenceSource(control.evidenceSource || ''); setAutoKey(control.automationKey || ''); setEditingAutomation(!editingAutomation); }} id="edit-automation-btn">
                                        {editingAutomation ? 'Cancel' : 'Edit'}
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Sync result flash */}
                        {syncResult && (
                            <div className={`mb-3 p-2.5 rounded text-xs flex items-start gap-tight ${
                                syncResult.status === 'PASSED' ? 'bg-bg-success border border-border-success text-content-success'
                                : syncResult.status === 'FAILED' || syncResult.status === 'ERROR' ? 'bg-bg-error border border-border-error text-content-error'
                                : 'bg-bg-elevated/50 border border-border-emphasis text-content-default'
                            }`} id="sync-result-banner">
                                <span className="font-semibold">{syncResult.status}</span>
                                {syncResult.summary && <span className="opacity-80">{syncResult.summary}</span>}
                            </div>
                        )}

                        {editingAutomation && permissions.canWrite ? (
                            <div className="space-y-tight">
                                <Combobox
                                    hideSearch
                                    id="evidence-source-select"
                                    selected={EVIDENCE_SOURCE_OPTIONS.find(o => o.value === autoEvidenceSource) ?? null}
                                    setSelected={(opt) => setAutoEvidenceSource(opt?.value ?? '')}
                                    options={EVIDENCE_SOURCE_OPTIONS}
                                    placeholder="No source"
                                    matchTriggerWidth
                                />
                                {autoEvidenceSource === 'INTEGRATION' && (
                                    <input type="text" className="input w-full" placeholder="Automation key (e.g. aws-cis-1.2)" value={autoKey} onChange={e => setAutoKey(e.target.value)} id="automation-key-input" />
                                )}
                                <Button variant="primary" onClick={saveAutomation} disabled={savingAutomation} id="save-automation-btn">
                                    {savingAutomation ? 'Saving...' : 'Save'}
                                </Button>
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 gap-default">
                                <div>
                                    <span className="text-xs text-content-subtle">Evidence Source</span>
                                    <p className="text-sm text-content-default mt-1">{control.evidenceSource || '—'}</p>
                                </div>
                                <div>
                                    <span className="text-xs text-content-subtle">Automation Key</span>
                                    <p className="text-sm text-content-default mt-1 font-mono">{control.automationKey || '—'}</p>
                                </div>
                                {syncStatus && (
                                    <div>
                                        <span className="text-xs text-content-subtle">Sync Status</span>
                                        <div className="mt-1 flex items-center gap-1.5">
                                            <StatusBadge variant={syncStatus === 'SYNCED' ? 'success'
                                                : syncStatus === 'CONFLICT' ? 'error'
                                                : syncStatus === 'FAILED' ? 'error'
                                                : syncStatus === 'STALE' ? 'warning'
                                                : 'neutral'}>{syncStatus}</StatusBadge>
                                            {syncLastAt && (
                                                <span className="text-xs text-content-subtle">{formatDateTime(syncLastAt)}</span>
                                            )}
                                        </div>
                                        {syncError && syncStatus !== 'SYNCED' && (
                                            <p className="text-xs text-content-error mt-1 truncate" title={syncError}>{syncError}</p>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Edit Control Modal — extracted to _modals/EditControlModal.tsx
                in Elevation PR-2. Page still owns state + mutation; the
                modal is presentational. */}
            <EditControlModal
                open={showEditModal}
                setOpen={setShowEditModal}
                form={editForm}
                setForm={setEditForm}
                saving={savingEdit}
                error={editError}
                currentOwnerName={control.owner?.name}
                categoryOptions={CATEGORY_CB_OPTIONS}
                frequencyOptions={FREQ_CB_OPTIONS}
                onCancel={handleEditCancel}
                onSubmit={handleEditSave}
            />

            {/* Success toast */}
            {editSuccess && (
                <div className="fixed bottom-6 right-6 z-50 bg-bg-success-emphasis text-content-emphasis px-4 py-2 rounded-lg shadow-lg animate-fadeIn text-sm" id="edit-success-toast">
                    Control updated
                </div>
            )}

            {tab === 'tasks' && (
                <div className="space-y-default">
                    {permissions.canWrite && (
                        <div className="flex justify-end">
                            <Button variant="primary" onClick={() => setShowTaskForm(!showTaskForm)} id="create-task-btn">
                                + Task
                            </Button>
                        </div>
                    )}
                    {showTaskForm && permissions.canWrite && (
                        <form onSubmit={createTask} className={cn(cardVariants({ density: 'compact' }), 'space-y-compact')}>
                            <input type="text" className="input w-full" placeholder="Task title *" value={taskTitle} onChange={e => setTaskTitle(e.target.value)} required id="task-title-input" />
                            <textarea className="input w-full" rows={2} placeholder="Description (optional)" value={taskDesc} onChange={e => setTaskDesc(e.target.value)} id="task-desc-input" />
                            {/* Epic 58 — shared DatePicker. `taskDue`
                                keeps its YMD-string shape. */}
                            <DatePicker
                                id="task-due-input"
                                className="w-full"
                                placeholder="Due date"
                                clearable
                                align="start"
                                value={parseYMD(taskDue)}
                                onChange={(next) => setTaskDue(toYMD(next) ?? '')}
                                disabledDays={{
                                    before: startOfUtcDay(new Date()),
                                }}
                                aria-label="Task due date"
                            />
                            <Button type="submit" variant="primary" disabled={savingTask} id="submit-task-btn">
                                {savingTask ? 'Creating...' : 'Create'}
                            </Button>
                        </form>
                    )}
                    <div className={cn(cardVariants({ density: 'none' }), 'overflow-hidden')}>
                        {(control.controlTasks?.length ?? 0) === 0 ? (
                            <InlineEmptyState
                                title="No tasks yet"
                                description="Tasks linked to this control show up here once any are created."
                            />
                        ) : (
                            <table className="data-table" id="tasks-table">
                                <thead>
                                    <tr><th>Title</th><th>Status</th><th>Assignee</th><th>Due</th>{permissions.canWrite && <th>Actions</th>}</tr>
                                </thead>
                                <tbody>
                                    {control.controlTasks?.map((t: ControlTaskDTO) => (
                                        <tr key={t.id}>
                                            <td className="text-sm text-content-emphasis">{t.title}</td>
                                            <td><StatusBadge variant={TASK_STATUS_BADGE[t.status] || 'neutral'}>{t.status}</StatusBadge></td>
                                            <td className="text-xs text-content-muted">{t.assignee?.name || '—'}</td>
                                            <td className="text-xs text-content-muted">{t.dueAt ? formatDate(t.dueAt) : '—'}</td>
                                            {permissions.canWrite && (
                                                <td>
                                                    {t.status !== 'DONE' && (
                                                        <Button variant="secondary" size="sm" onClick={() => updateTaskStatus(t.id, 'DONE')} id={`mark-done-${t.id}`}>
                                                            Done
                                                        </Button>
                                                    )}
                                                </td>
                                            )}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                    {/* Linked Work Items (via TaskLink) */}
                    <div className={cn(cardVariants({ density: 'compact' }), 'mt-4')} id="linked-work-items-section">
                        <Heading level={3} className="mb-3">Linked Work Items (Tasks)</Heading>
                        <LinkedTasksPanel
                            apiBase={apiUrl('')}
                            entityType="CONTROL"
                            entityId={controlId}
                            tenantHref={tenantHref}
                        />
                    </div>
                </div>
            )}

            {tab === 'evidence' && (
                <div className="space-y-default">
                    {permissions.canWrite && (
                        <div className="flex justify-end gap-tight">
                            <Button variant="secondary" onClick={() => { setShowFileUpload(!showFileUpload); setShowEvidenceForm(false); }} id="upload-evidence-btn">
                                Upload Evidence
                            </Button>
                            <Button variant="primary" onClick={() => { setShowEvidenceForm(!showEvidenceForm); setShowFileUpload(false); }} id="link-evidence-btn">
                                + Evidence
                            </Button>
                        </div>
                    )}
                    {/* File upload form for this control */}
                    {showFileUpload && permissions.canWrite && (
                        <form onSubmit={handleFileUpload} className={cn(cardVariants({ density: 'compact' }), 'space-y-compact')} id="control-upload-form">
                            <Heading level={3}>Upload Evidence for {control.name}</Heading>
                            <input
                                ref={fileUploadRef}
                                type="file"
                                className="input w-full file:mr-4 file:py-1 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium file:bg-[var(--brand-default)] file:text-content-emphasis hover:file:bg-[var(--brand-default)]"
                                onChange={e => setFileToUpload(e.target.files?.[0] || null)}
                                required
                                id="control-file-input"
                                accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.csv,.txt,.doc,.docx,.xlsx,.xls,.json,.zip"
                            />
                            {fileToUpload && (
                                <p className="text-xs text-content-muted">{fileToUpload.name} ({fileToUpload.size < 1048576 ? `${(fileToUpload.size / 1024).toFixed(1)} KB` : `${(fileToUpload.size / 1048576).toFixed(1)} MB`})</p>
                            )}
                            <input
                                type="text"
                                className="input w-full"
                                placeholder="Title (defaults to filename)"
                                value={fileUploadTitle}
                                onChange={e => setFileUploadTitle(e.target.value)}
                                id="control-upload-title"
                            />
                            {fileUploadError && (
                                <div className="text-content-error text-sm bg-bg-error rounded px-3 py-2">{fileUploadError}</div>
                            )}
                            {fileUploading && (
                                // Epic 59 — ProgressBar primitive. The actual
                                // upload is XHR-bounded so we show a stable
                                // 60% "working" signal; the ARIA value stays
                                // correct for AT consumers.
                                <ProgressBar
                                    value={60}
                                    size="md"
                                    variant="brand"
                                    aria-label="Uploading evidence file"
                                />
                            )}
                            <Button type="submit" variant="primary" disabled={fileUploading || !fileToUpload} id="submit-control-upload">
                                {fileUploading ? 'Uploading...' : 'Upload'}
                            </Button>
                        </form>
                    )}
                    {showEvidenceForm && permissions.canWrite && (
                        <form onSubmit={linkEvidence} className={cn(cardVariants({ density: 'compact' }), 'space-y-compact')}>
                            <input type="url" className="input w-full" placeholder="Evidence URL *" value={evidenceUrl} onChange={e => setEvidenceUrl(e.target.value)} required id="evidence-url-input" />
                            <textarea className="input w-full" rows={2} placeholder="Note (optional)" value={evidenceNote} onChange={e => setEvidenceNote(e.target.value)} id="evidence-note-input" />
                            <Button type="submit" variant="primary" disabled={savingEvidence} id="submit-evidence-btn">
                                {savingEvidence ? 'Linking...' : 'Link Evidence'}
                            </Button>
                        </form>
                    )}
                    <div className={cn(cardVariants({ density: 'none' }), 'overflow-hidden')}>
                        {(() => {
                            const linkedFileIds = new Set(control.evidenceLinks?.map((l: EvidenceLinkDTO) => l.fileId).filter(Boolean) ?? []);
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            const directEvidence = (control.evidence ?? []).filter((e: any) => !e.fileRecordId || !linkedFileIds.has(e.fileRecordId));
                            const hasLinks = (control.evidenceLinks?.length ?? 0) > 0;
                            const hasEvidence = directEvidence.length > 0;
                            if (!hasLinks && !hasEvidence) {
                                return (
                                    <div id="no-evidence">
                                        <InlineEmptyState
                                            title="No evidence linked"
                                            description="Link existing evidence or upload new files to satisfy this control."
                                        />
                                    </div>
                                );
                            }
                            return (
                                <table className="data-table" id="evidence-table">
                                    <thead>
                                        <tr><th>Type</th><th>Title / URL</th><th>Status</th><th>Date</th>{permissions.canWrite && <th>Actions</th>}</tr>
                                    </thead>
                                    <tbody>
                                        {control.evidenceLinks?.map((el: EvidenceLinkDTO) => (
                                            <tr key={`link-${el.id}`}>
                                                <td><StatusBadge variant={el.kind === 'FILE' ? 'success' : 'info'}>{el.kind}</StatusBadge></td>
                                                <td className="text-sm">
                                                    {el.url ? <a href={el.url} target="_blank" rel="noopener noreferrer" className={textLinkVariants({ tone: 'link' })}>{el.url}</a> : (el.note || '—')}
                                                </td>
                                                <td className="text-xs text-content-muted">{el.createdBy?.name || '—'}</td>
                                                <td className="text-xs text-content-muted">{el.createdAt ? formatDate(el.createdAt) : '—'}</td>
                                                {permissions.canWrite && (
                                                    <td>
                                                        <button className="text-content-error text-xs hover:text-content-error" onClick={() => unlinkEvidence(el.id)} id={`unlink-${el.id}`}>
                                                            × Remove
                                                        </button>
                                                    </td>
                                                )}
                                            </tr>
                                        ))}
                                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                        {directEvidence.map((ev: any) => (
                                            <tr key={`ev-${ev.id}`}>
                                                <td><StatusBadge variant={ev.type === 'FILE' ? 'success' : ev.type === 'TEXT' ? 'neutral' : 'info'}>{ev.type}</StatusBadge></td>
                                                <td className="text-sm">
                                                    <Link href={tenantHref(`/evidence`)} className={textLinkVariants({ tone: 'link' })}>{ev.title}</Link>
                                                </td>
                                                <td>
                                                    <StatusBadge variant={ev.status === 'APPROVED' ? 'success' : ev.status === 'REJECTED' ? 'error' : ev.status === 'SUBMITTED' ? 'info' : 'neutral'}>
                                                        {ev.status}
                                                    </StatusBadge>
                                                </td>
                                                <td className="text-xs text-content-muted">{ev.createdAt ? formatDate(ev.createdAt) : '—'}</td>
                                                {permissions.canWrite && <td />}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            );
                        })()}
                    </div>
                </div>
            )}

            {tab === 'mappings' && (
                <div className="space-y-default">
                    {permissions.canWrite && (
                        <div className="flex justify-end">
                            <Button variant="primary" onClick={() => setShowMapForm(!showMapForm)} id="map-requirement-btn">
                                + Map Requirement
                            </Button>
                        </div>
                    )}
                    {showMapForm && permissions.canWrite && (
                        <div className={cn(cardVariants({ density: 'compact' }), 'space-y-compact')}>
                            <Combobox
                                id="framework-select"
                                selected={frameworks.map((f: FrameworkDTO) => ({ value: f.key ?? f.id ?? '', label: f.name })).find(o => o.value === selectedFramework) ?? null}
                                setSelected={(opt) => setSelectedFramework(opt?.value ?? '')}
                                options={frameworks.map((f: FrameworkDTO) => ({ value: f.key ?? f.id ?? '', label: f.name }))}
                                placeholder="Select Framework..."
                                matchTriggerWidth
                            />
                            {requirements.length > 0 && (
                                <>
                                    <Combobox
                                        id="requirement-select"
                                        selected={requirements.map((r: RequirementDTO) => ({ value: r.id, label: `${r.code ? `${r.code} — ` : ''}${r.title || r.description}` })).find(o => o.value === selectedReq) ?? null}
                                        setSelected={(opt) => setSelectedReq(opt?.value ?? '')}
                                        options={requirements.map((r: RequirementDTO) => ({ value: r.id, label: `${r.code ? `${r.code} — ` : ''}${r.title || r.description}` }))}
                                        placeholder="Select Requirement..."
                                        matchTriggerWidth
                                    />
                                    <Button variant="primary" onClick={mapRequirement} disabled={!selectedReq || savingMap} id="submit-mapping-btn">
                                        {savingMap ? 'Mapping...' : 'Map'}
                                    </Button>
                                </>
                            )}
                        </div>
                    )}
                    <div className={cn(cardVariants({ density: 'none' }), 'overflow-hidden')}>
                        {(control.frameworkMappings?.length ?? 0) === 0 ? (
                            <InlineEmptyState
                                title="No framework mappings"
                                description="Map this control to specific framework requirements to track coverage."
                            />
                        ) : (
                            <table className="data-table" id="mappings-table">
                                <thead>
                                    <tr><th>Framework</th><th>Requirement</th>{permissions.canWrite && <th>Actions</th>}</tr>
                                </thead>
                                <tbody>
                                    {control.frameworkMappings?.map((m: FrameworkMappingDTO) => (
                                        <tr key={m.id}>
                                            <td className="text-sm text-content-emphasis">{m.fromRequirement?.framework?.name || '—'}</td>
                                            <td className="text-sm text-content-default">
                                                {m.fromRequirement?.code && (
                                                    <CopyText
                                                        value={m.fromRequirement.code}
                                                        label={`Copy requirement code ${m.fromRequirement.code}`}
                                                        successMessage="Requirement code copied"
                                                        className="mr-2 text-content-subtle"
                                                    >
                                                        {m.fromRequirement.code}
                                                    </CopyText>
                                                )}
                                                {m.fromRequirement?.title || m.fromRequirement?.description || '—'}
                                            </td>
                                            {permissions.canWrite && (
                                                <td>
                                                    <button className="text-content-error text-xs hover:text-content-error" onClick={() => unmapRequirement(m.fromRequirement?.id || m.fromRequirementId || '')} id={`unmap-${m.id}`}>
                                                        × Remove
                                                    </button>
                                                </td>
                                            )}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            )}

            {tab === 'traceability' && (
                <TraceabilityPanel
                    apiBase={apiUrl('')}
                    entityType="control"
                    entityId={controlId}
                    canWrite={permissions.canWrite}
                    tenantHref={tenantHref}
                />
            )}

            {tab === 'activity' && (
                <div className={cn(cardVariants({ density: 'none' }), 'overflow-hidden')}>
                    {activityLoading ? (
                        <div className="p-8 text-center text-content-subtle animate-pulse">Loading activity…</div>
                    ) : activity.length === 0 ? (
                        <InlineEmptyState
                            title="No activity recorded"
                            description="Status changes, link updates, and edits show up here once anything moves."
                        />
                    ) : (
                        <div className="divide-y divide-border-default/50" id="activity-feed">
                            {activity.map((ev: AuditLogEntry) => (
                                <div key={ev.id} className="px-5 py-3 flex items-start gap-compact">
                                    <div className="mt-0.5">
                                        <StatusBadge variant="info">{EVENT_LABELS[ev.action] || ev.action}</StatusBadge>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm text-content-default">{ev.details}</p>
                                        <p className="text-xs text-content-subtle mt-0.5">
                                            {ev.user?.name || 'System'} · {formatDateTime(ev.createdAt)}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {tab === 'tests' && (
                <div className={cardVariants({ density: 'compact' })}>
                    <TestPlansPanel controlId={controlId} />
                </div>
            )}

            {/* Epic G-5 — Control exceptions section. Renders below
              * the active tab on every tab so the workflow is always
              * one scroll away from the control. */}
            <div className={cn(cardVariants({ density: 'compact' }), 'mt-6')}>
                <ControlExceptionsPanel
                    tenantSlug={tenantSlug}
                    controlId={controlId}
                    compensatingControlChoices={[]}
                    defaultRiskAcceptedByUserId={control.ownerUserId ?? ''}
                    canWrite={permissions.canWrite}
                    canAdmin={permissions.canAdmin}
                />
            </div>
        </EntityDetailLayout>
    );
}
