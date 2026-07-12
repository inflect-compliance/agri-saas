'use client';
/* TODO(swr-migration): this file has fetch-on-mount + setState
 * patterns flagged by react-hooks/set-state-in-effect. Each call site
 * carries an inline disable directive; collectively they should
 * migrate to useTenantSWR (Epic 69 shape) so the rule can lift. */

/* eslint-disable react-hooks/exhaustive-deps -- Various useEffect/useMemo dep arrays in this file deliberately omit identity-unstable callbacks (handlers recreated each render) or use selector functions whose change-detection happens elsewhere. Adding the deps would either trigger unnecessary re-runs OR cause infinite render loops; the proper structural fix is to wrap parent-level callbacks in useCallback. Tracked as follow-up. */
/**
 * Epic 54 — New Risk modal.
 *
 * Modal-based replacement for the legacy `/risks/new` wizard. The wizard
 * split risk creation across four screens (choose / template / details /
 * scoring / controls) with a full-page context switch — this compact
 * single-step modal preserves every business knob (same POST payload,
 * same template pre-fill, same post-create control linking, same score
 * formula) while keeping the risk register visible behind the overlay.
 *
 * Business contract preserved:
 *   - `POST /api/t/:slug/risks` with
 *       { title, description?, category?, likelihood, impact,
 *         treatmentOwner?, nextReviewAt?, templateId? }
 *   - When a template is selected, `templateId` rides along so the
 *     server-side usecase can record the provenance.
 *   - After the risk is created, sequential best-effort POSTs to
 *     `/risks/:id/controls` for every selected control id — identical
 *     to the legacy wizard's two-phase behaviour.
 *   - `queryKeys.risks.all(tenantSlug)` invalidated on success — fixes
 *     the latent bug on the legacy wizard where open tabs wouldn't
 *     refresh after a redirect back to the list.
 *
 * Preserved form IDs (`risk-title`, `risk-category`, `risk-description`,
 * `risk-owner`, `risk-review-date`, `submit-risk`) so the existing E2E
 * suite continues to match against the modal surface.
 */

import { useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSWRConfig } from 'swr';
import { CACHE_KEYS } from '@/lib/swr-keys';
import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type Dispatch,
    type SetStateAction,
} from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { FormField } from '@/components/ui/form-field';
import { FormError } from '@/components/ui/form-error';
import { FormSection } from '@/components/ui/form-section';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { UserCombobox } from '@/components/ui/user-combobox';
import { RiskEvaluationFields } from './_shared/RiskEvaluationFields';
import { RISK_TREATMENT_OPTIONS } from './_shared/risk-options';
import { DatePicker } from '@/components/ui/date-picker/date-picker';
import {
    parseYMD,
    startOfUtcDay,
    toYMD,
} from '@/components/ui/date-picker/date-utils';
import { queryKeys } from '@/lib/queryKeys';
import { useFormTelemetry } from '@/lib/telemetry/form-telemetry';

// ─── Constants ──────────────────────────────────────────────────────

const CATEGORIES = [
    'Technical',
    'Operational',
    'Compliance',
    'Strategic',
    'Financial',
    'Reputational',
    'Physical',
    'Human Resources',
] as const;

const CATEGORY_OPTIONS: ComboboxOption[] = CATEGORIES.map((c) => ({
    value: c,
    label: c,
}));


// ─── Types ──────────────────────────────────────────────────────────

interface ControlOption {
    id: string;
    annexId: string | null;
    name: string;
    status: string;
}

interface RiskTemplate {
    id: string;
    title: string;
    description: string | null;
    category: string | null;
    defaultLikelihood: number;
    defaultImpact: number;
    frameworkTag: string | null;
}

export interface NewRiskModalProps {
    open: boolean;
    setOpen: Dispatch<SetStateAction<boolean>>;
    tenantSlug: string;
    apiUrl: (path: string) => string;
}

// ─── Component ──────────────────────────────────────────────────────

export function NewRiskModal({
    open,
    setOpen,
    tenantSlug,
    apiUrl,
}: NewRiskModalProps) {
    const tn = useTranslations('newRisk');
    const close = useCallback(() => setOpen(false), [setOpen]);
    const queryClient = useQueryClient();
    // Epic 69 — bridge cache invalidation. RisksClient now reads
    // from `useTenantSWR(CACHE_KEYS.risks.list())`, so the React
    // Query invalidation alone wouldn't refresh the page. We
    // invalidate BOTH caches.
    const { mutate: swrMutate } = useSWRConfig();
    const titleRef = useRef<HTMLInputElement>(null);

    const [form, setForm] = useState({
        title: '',
        description: '',
        category: '',
        likelihood: 3,
        impact: 3,
        ownerUserId: '',
        treatment: '',
        treatmentNotes: '',
        nextReviewAt: '',
    });
    const [templateId, setTemplateId] = useState('');
    const [selectedControlIds, setSelectedControlIds] = useState<Set<string>>(
        new Set(),
    );
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');

    // ─── Lookups — controls + templates load while the modal is open ───
    const controlsQuery = useQuery<ControlOption[]>({
        queryKey: ['risks', tenantSlug, 'controls-for-new-risk'],
        enabled: open,
        queryFn: async () => {
            const res = await fetch(apiUrl('/controls'));
            if (!res.ok) throw new Error(`Controls: ${res.status}`);
            const data = await res.json();
            // GET /controls returns the backfill-capped shape
            // `{ rows, truncated }` (applyBackfillCap), not a bare array —
            // the previous `Array.isArray` guard always fell through to []
            // so the link-controls list was permanently empty.
            const list: ControlOption[] = Array.isArray(data)
                ? data
                : Array.isArray(data?.rows)
                  ? data.rows
                  : [];
            return list.map((c: ControlOption) => ({
                id: c.id,
                annexId: c.annexId ?? null,
                name: c.name,
                status: c.status,
            }));
        },
    });
    const controls = controlsQuery.data ?? [];

    const templatesQuery = useQuery<RiskTemplate[]>({
        queryKey: ['risks', tenantSlug, 'templates'],
        enabled: open,
        queryFn: async () => {
            const res = await fetch('/api/risk-templates');
            if (!res.ok) return [];
            const data = await res.json();
            return Array.isArray(data) ? data : [];
        },
    });
    const templates = templatesQuery.data ?? [];
    const selectedTemplate = useMemo(
        () => templates.find((t) => t.id === templateId) ?? null,
        [templates, templateId],
    );
    // Project the templates into ComboboxOption shape. The category
    // is appended to the label so it becomes part of the fuzzy search
    // index (typing "compliance" matches all compliance templates).
    const templateOptions = useMemo<ComboboxOption<RiskTemplate>[]>(
        () =>
            templates.map((tmpl) => ({
                value: tmpl.id,
                label: tmpl.category ? `${tmpl.title} · ${tmpl.category}` : tmpl.title,
                meta: tmpl,
            })),
        [templates],
    );

    // ─── Reset + focus on open ───
    useEffect(() => {
        if (!open) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setForm({
            title: '',
            description: '',
            category: '',
            likelihood: 3,
            impact: 3,
            ownerUserId: '',
            treatment: '',
            treatmentNotes: '',
            nextReviewAt: '',
        });
        setTemplateId('');
        setSelectedControlIds(new Set());
        setError('');
        setSubmitting(false);
        const t = setTimeout(() => titleRef.current?.focus(), 60);
        return () => clearTimeout(t);
    }, [open]);

    // Pre-fill from a newly selected template. We keep whatever the user
    // has already edited; only the fields that came from the old template
    // (now overridden) move to the new template's defaults.
    const applyTemplate = (id: string) => {
        setTemplateId(id);
        const tmpl = templates.find((t) => t.id === id);
        if (!tmpl) return;
        setForm((prev) => ({
            ...prev,
            title: tmpl.title,
            description: tmpl.description ?? '',
            category: tmpl.category ?? '',
            likelihood: tmpl.defaultLikelihood,
            impact: tmpl.defaultImpact,
        }));
    };

    const update = <K extends keyof typeof form>(
        field: K,
        value: (typeof form)[K],
    ) => setForm((prev) => ({ ...prev, [field]: value }));

    const toggleControl = (id: string) =>
        setSelectedControlIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    const canSubmit = form.title.trim().length > 0 && !submitting;

    const telemetry = useFormTelemetry('NewRiskModal');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canSubmit) return;
        setSubmitting(true);
        setError('');
        telemetry.trackSubmit({
            hasTemplate: Boolean(selectedTemplate),
            likelihood: form.likelihood,
            impact: form.impact,
            controlLinkCount: selectedControlIds.size,
        });
        try {
            const payload: Record<string, unknown> = {
                title: form.title.trim(),
                description: form.description.trim() || undefined,
                category: form.category || undefined,
                likelihood: form.likelihood,
                impact: form.impact,
                ownerUserId: form.ownerUserId || undefined,
                treatment: form.treatment || undefined,
                treatmentNotes: form.treatmentNotes.trim() || undefined,
            };
            if (form.nextReviewAt) {
                payload.nextReviewAt = new Date(
                    form.nextReviewAt,
                ).toISOString();
            }
            if (selectedTemplate) {
                payload.templateId = selectedTemplate.id;
            }

            const res = await fetch(apiUrl('/risks'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(
                    data.message ||
                        data.error ||
                        `Failed to create risk (${res.status})`,
                );
            }
            const risk = await res.json();

            // Phase 2 — link selected controls. Matches the legacy
            // two-phase wizard; failures are best-effort so a partial
            // network hiccup doesn't orphan the created risk.
            for (const controlId of selectedControlIds) {
                await fetch(apiUrl(`/risks/${risk.id}/controls`), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ controlId }),
                }).catch(() => {
                    /* best-effort */
                });
            }

            queryClient.invalidateQueries({
                queryKey: queryKeys.risks.all(tenantSlug),
            });
            // Bridge to the SWR cache that RisksClient reads from.
            const risksUrlPrefix = apiUrl(CACHE_KEYS.risks.list());
            swrMutate(
                (key) =>
                    typeof key === 'string' &&
                    (key === risksUrlPrefix ||
                        key.startsWith(`${risksUrlPrefix}?`)),
                undefined,
                { revalidate: true },
            );
            telemetry.trackSuccess({ riskId: risk.id });
            close();
        } catch (err) {
            telemetry.trackError(err);
            setError(
                err instanceof Error ? err.message : tn('failedCreate'),
            );
            setSubmitting(false);
        }
    };

    return (
        <Modal
            showModal={open}
            setShowModal={setOpen}
            size="lg"
            title={tn('title')}
            description={tn('description')}
            preventDefaultClose={submitting}
        >
            <Modal.Header
                title={tn('title')}
                description={tn('headerDescription')}
            />
            <Modal.Form id="new-risk-form" onSubmit={handleSubmit}>
                <Modal.Body>
                    {error && (
                        <div
                            className="mb-4 rounded-lg border border-border-error bg-bg-error px-3 py-2 text-sm text-content-error"
                            id="new-risk-error"
                            role="alert"
                            data-testid="new-risk-error"
                        >
                            {error}
                        </div>
                    )}

                    {/* Roadmap-2 PR-6 — `<FormSection>` wraps the
                        risk-detail fields. The eyebrow gives the
                        section a name; future PRs split the
                        scoring + treatment fields into their own
                        subsections. The `disabled` prop is now
                        forwarded to a nested fieldset that owns
                        the disable behaviour while FormSection
                        owns the visual rhythm. */}
                    <fieldset disabled={submitting} className="m-0 p-0 border-0">
                    <FormSection eyebrow={tn('riskDetails')}>
                        {/* Template (optional) */}
                        {templates.length > 0 && (
                            <FormField
                                label={
                                    <>
                                        {tn('templateLabel')}{' '}
                                        <span className="text-content-muted">
                                            {tn('optional')}
                                        </span>
                                    </>
                                }
                                description={tn('templateDescription')}
                            >
                                <Combobox<false, RiskTemplate>
                                    id="risk-template-select"
                                    name="templateId"
                                    options={templateOptions}
                                    selected={
                                        templateOptions.find(
                                            (o) => o.value === templateId,
                                        ) ?? null
                                    }
                                    setSelected={(option) => {
                                        applyTemplate(option?.value ?? '');
                                    }}
                                    loading={templatesQuery.isLoading}
                                    placeholder={tn('noTemplate')}
                                    searchPlaceholder={tn('searchTemplates')}
                                    emptyState={tn('noTemplatesMatch')}
                                    matchTriggerWidth
                                    buttonProps={{ className: 'w-full' }}
                                    caret
                                />
                            </FormField>
                        )}

                        {/* Title */}
                        <FormField label={tn('titleLabel')} required>
                            <Input
                                id="risk-title"
                                ref={titleRef}
                                type="text"
                                placeholder={tn('titlePlaceholder')}
                                value={form.title}
                                onChange={(e) => update('title', e.target.value)}
                                required
                                autoComplete="off"
                            />
                        </FormField>
                        {form.title.length > 0 && !form.title.trim() && (
                            <FormError>{tn('titleEmpty')}</FormError>
                        )}

                        <div className="grid grid-cols-1 gap-default sm:grid-cols-2">
                            {/* Category */}
                            <FormField label={tn('categoryLabel')}>
                                <Combobox
                                    id="risk-category"
                                    name="category"
                                    options={CATEGORY_OPTIONS}
                                    selected={
                                        CATEGORY_OPTIONS.find(
                                            (o) => o.value === form.category,
                                        ) ?? null
                                    }
                                    setSelected={(o) =>
                                        update('category', o?.value ?? '')
                                    }
                                    placeholder={tn('categoryPlaceholder')}
                                    searchPlaceholder={tn('searchCategories')}
                                    matchTriggerWidth
                                    buttonProps={{ className: 'w-full' }}
                                    caret
                                />
                            </FormField>

                            {/* Owner — tenant-member people picker. */}
                            <FormField label={tn('ownerLabel')}>
                                <UserCombobox
                                    id="risk-owner"
                                    tenantSlug={tenantSlug}
                                    selectedId={form.ownerUserId || null}
                                    onChange={(userId) =>
                                        update('ownerUserId', userId ?? '')
                                    }
                                    matchTriggerWidth
                                    placeholder={tn('ownerPlaceholder')}
                                />
                            </FormField>
                        </div>

                        {/* Description */}
                        <FormField label={tn('descriptionLabel')}>
                            <Textarea
                                id="risk-description"
                                rows={3}
                                placeholder={tn('descriptionPlaceholder')}
                                value={form.description}
                                onChange={(e) =>
                                    update('description', e.target.value)
                                }
                            />
                        </FormField>

                        {/* Risk Evaluation — shared scoring box (matches
                            the detail edit modal). */}
                        <RiskEvaluationFields
                            likelihood={form.likelihood}
                            impact={form.impact}
                            onLikelihood={(v) => update('likelihood', v)}
                            onImpact={(v) => update('impact', v)}
                        />

                        {/* Treatment decision + notes */}
                        <div className="grid grid-cols-1 gap-default sm:grid-cols-2">
                            <FormField label={tn('treatmentLabel')}>
                                <Combobox
                                    id="risk-treatment"
                                    name="treatment"
                                    options={RISK_TREATMENT_OPTIONS}
                                    selected={
                                        RISK_TREATMENT_OPTIONS.find(
                                            (o) => o.value === form.treatment,
                                        ) ?? null
                                    }
                                    setSelected={(o) =>
                                        update('treatment', o?.value ?? '')
                                    }
                                    placeholder={tn('treatmentPlaceholder')}
                                    hideSearch
                                    matchTriggerWidth
                                    buttonProps={{ className: 'w-full' }}
                                    caret
                                />
                            </FormField>
                        </div>
                        <FormField label={tn('treatmentNotesLabel')}>
                            <Textarea
                                id="risk-treatment-notes"
                                rows={3}
                                placeholder={tn('treatmentNotesPlaceholder')}
                                value={form.treatmentNotes}
                                onChange={(e) =>
                                    update('treatmentNotes', e.target.value)
                                }
                            />
                        </FormField>

                        {/* Review date — Epic 58 shared DatePicker.
                            `form.nextReviewAt` stays a YMD string so the
                            server payload is unchanged; the picker
                            bridges to DateValue at the prop edge. */}
                        <FormField label={tn('nextReviewLabel')}>
                            <DatePicker
                                id="risk-review-date"
                                className="sm:max-w-xs"
                                placeholder={tn('selectDate')}
                                clearable
                                align="start"
                                value={parseYMD(form.nextReviewAt)}
                                onChange={(next) =>
                                    update('nextReviewAt', toYMD(next) ?? '')
                                }
                                disabledDays={{
                                    before: startOfUtcDay(new Date()),
                                }}
                                aria-label={tn('nextReviewDate')}
                            />
                        </FormField>

                        {/* Linked controls (optional, collapsible feel) */}
                        <details className="rounded-lg border border-border-subtle bg-bg-subtle">
                            <summary
                                className="cursor-pointer px-4 py-2 text-sm text-content-default"
                                data-testid="risk-controls-toggle"
                            >
                                {tn('linkControls')}{' '}
                                <span className="text-content-muted">
                                    {tn('selectedCount', { count: selectedControlIds.size })}
                                </span>
                            </summary>
                            <div className="border-t border-border-subtle px-4 py-3">
                                {controlsQuery.isLoading ? (
                                    <p className="text-sm text-content-muted">
                                        {tn('loadingControls')}
                                    </p>
                                ) : controls.length === 0 ? (
                                    <p className="text-sm text-content-muted">
                                        {tn('noControlsToLink')}
                                    </p>
                                ) : (
                                    <div
                                        className="max-h-40 space-y-1 overflow-y-auto"
                                        data-testid="risk-controls-list"
                                    >
                                        {controls.map((c) => (
                                            <label
                                                key={c.id}
                                                className="flex cursor-pointer items-center gap-tight rounded px-1 py-1 text-sm text-content-default hover:bg-bg-muted"
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={selectedControlIds.has(
                                                        c.id,
                                                    )}
                                                    onChange={() =>
                                                        toggleControl(c.id)
                                                    }
                                                    className="accent-brand-emphasis"
                                                    data-testid={`risk-control-opt-${c.id}`}
                                                />
                                                <span className="w-16 shrink-0 text-xs text-content-muted">
                                                    {c.annexId || 'CUST'}
                                                </span>
                                                <span className="text-content-emphasis">
                                                    {c.name}
                                                </span>
                                            </label>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </details>
                    </FormSection>
                    </fieldset>
                </Modal.Body>

                <Modal.Actions>
                    <Button
                        variant="secondary"
                        size="sm"
                        id="new-risk-cancel-btn"
                        onClick={() => {
                            if (!submitting) close();
                        }}
                        disabled={submitting}
                    >
                        {tn('cancel')}
                    </Button>
                    <Button
                        type="submit"
                        variant="primary"
                        size="sm"
                        id="submit-risk"
                        disabled={!canSubmit}
                    >
                        {submitting ? tn('creating') : tn('createRisk')}
                    </Button>
                </Modal.Actions>
            </Modal.Form>
        </Modal>
    );
}
