'use client';
/* TODO(swr-migration): this file has fetch-on-mount + setState
 * patterns flagged by react-hooks/set-state-in-effect. Each call site
 * carries an inline disable directive; collectively they should
 * migrate to useTenantSWR (Epic 69 shape) so the rule can lift. */

import { formatDate } from '@/lib/format-date';
import { useEffect, useState, useCallback, use } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useTenantApiUrl, useTenantHref, useTenantContext } from '@/lib/tenant-context-provider';
import { Button } from '@/components/ui/button';
import { SkeletonDetailPage } from '@/components/ui/skeleton';
import { Combobox } from '@/components/ui/combobox';
import { Tooltip } from '@/components/ui/tooltip';
import { StatusBadge, type StatusBadgeVariant } from '@/components/ui/status-badge';
import { Heading } from '@/components/ui/typography';
import { RequiredMarker } from '@/components/ui/required-marker';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';

const CRIT_BADGE: Record<string, StatusBadgeVariant> = { LOW: 'neutral', MEDIUM: 'warning', HIGH: 'error', CRITICAL: 'error' };
const STATUS_BADGE: Record<string, StatusBadgeVariant> = {
    DRAFT: 'neutral', IN_REVIEW: 'warning', APPROVED: 'success', REJECTED: 'error',
};

export default function AssessmentPage(
    props: { params: Promise<{ tenantSlug: string; vendorId: string; assessmentId: string }> }
) {
    const params = use(props.params);
    const t = useTranslations('vendors.assessment');
    const apiUrl = useTenantApiUrl();
    const tenantHref = useTenantHref();
    const { permissions, role } = useTenantContext();
    const canWrite = permissions?.canWrite;
    const isAdmin = role === 'ADMIN';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [assessment, setAssessment] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [answers, setAnswers] = useState<Record<string, any>>({});
    const [saving, setSaving] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [deciding, setDeciding] = useState(false);
    const [decideNotes, setDecideNotes] = useState('');
    const [savedMessage, setSavedMessage] = useState('');

    const fetchAssessment = useCallback(async () => {
        setLoading(true);
        const res = await fetch(apiUrl(`/vendors/${params.vendorId}/assessments/${params.assessmentId}`));
        if (res.ok) {
            const a = await res.json();
            setAssessment(a);
            // Populate answers from existing
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const ansMap: Record<string, any> = {};
            for (const ans of (a.answers || [])) {
                ansMap[ans.questionId] = ans.answerJson;
            }
            setAnswers(ansMap);
        }
        setLoading(false);
    }, [apiUrl, params.vendorId, params.assessmentId]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { fetchAssessment(); }, [fetchAssessment]);

    const saveAnswers = async () => {
        const answersArr = Object.entries(answers)
            .filter(([, v]) => v !== undefined && v !== '')
            .map(([questionId, answerJson]) => ({ questionId, answerJson }));
        if (answersArr.length === 0) return;
        setSaving(true);
        const res = await fetch(apiUrl(`/vendors/${params.vendorId}/assessments/${params.assessmentId}/answers`), {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ answers: answersArr }),
        });
        if (res.ok) {
            const result = await res.json();
            setSavedMessage(t('saved', { saved: result.saved, score: result.score, riskRating: result.riskRating }));
            setTimeout(() => setSavedMessage(''), 4000);
            fetchAssessment(); // refresh score
        }
        setSaving(false);
    };

    const submitAssessment = async () => {
        if (!confirm(t('submitConfirm'))) return;
        setSubmitting(true);
        const res = await fetch(apiUrl(`/vendors/${params.vendorId}/assessments/${params.assessmentId}/submit`), { method: 'POST' });
        if (res.ok) fetchAssessment();
        setSubmitting(false);
    };

    const decideAssessment = async (decision: string) => {
        setDeciding(true);
        const res = await fetch(apiUrl(`/vendors/${params.vendorId}/assessments/${params.assessmentId}/decide`), {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decision, notes: decideNotes || undefined }),
        });
        if (res.ok) fetchAssessment();
        setDeciding(false);
    };

    if (loading) return <SkeletonDetailPage />;
    if (!assessment) return <div className="text-content-error py-8 text-center">{t('notFound')}</div>;

    const isDraft = assessment.status === 'DRAFT';
    const isInReview = assessment.status === 'IN_REVIEW';
    const isDecided = assessment.status === 'APPROVED' || assessment.status === 'REJECTED';
    const questions = assessment.template?.questions || [];

    // Group questions by section
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sections: Record<string, any[]> = {};
    for (const q of questions) {
        if (!sections[q.section]) sections[q.section] = [];
        sections[q.section].push(q);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const renderInput = (q: any) => {
        const value = answers[q.id];
        const disabled = !isDraft || !canWrite;

        if (q.answerType === 'YES_NO') {
            return (
                <div className="flex gap-compact">
                    <label className="flex items-center gap-1.5 text-sm">
                        <input type="radio" name={`q-${q.id}`} checked={value === true || value === 'YES'}
                            onChange={() => setAnswers(p => ({ ...p, [q.id]: true }))} disabled={disabled} />
                        {t('yes')}
                    </label>
                    <label className="flex items-center gap-1.5 text-sm">
                        <input type="radio" name={`q-${q.id}`} checked={value === false || value === 'NO'}
                            onChange={() => setAnswers(p => ({ ...p, [q.id]: false }))} disabled={disabled} />
                        {t('no')}
                    </label>
                </div>
            );
        }

        if (q.answerType === 'SINGLE_SELECT' && q.optionsJson) {
            const options = Array.isArray(q.optionsJson) ? q.optionsJson : [];
            return (
                <Combobox
                    hideSearch
                    selected={options.map((o: string) => ({ value: o, label: o })).find((opt: { value: string }) => opt.value === value) ?? null}
                    setSelected={(opt) => setAnswers(p => ({ ...p, [q.id]: opt?.value ?? '' }))}
                    options={options.map((o: string) => ({ value: o, label: o }))}
                    placeholder={t('selectOption')}
                    disabled={disabled}
                    matchTriggerWidth
                    buttonProps={{ className: 'w-full max-w-xs' }}
                />
            );
        }

        if (q.answerType === 'NUMBER') {
            return <input type="number" className="input w-24" value={value ?? ''} disabled={disabled}
                onChange={e => setAnswers(p => ({ ...p, [q.id]: Number(e.target.value) }))} />;
        }

        // TEXT / MULTI_SELECT fallback
        return <input className="input w-full max-w-md" value={value || ''} disabled={disabled}
            onChange={e => setAnswers(p => ({ ...p, [q.id]: e.target.value }))} />;
    };

    return (
        <div className="space-y-section animate-fadeIn max-w-3xl mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-compact">
                    <Link href={tenantHref(`/vendors/${params.vendorId}`)} className="text-content-muted hover:text-content-emphasis">{t('backToVendor')}</Link>
                </div>
            </div>

            <div className={cn(cardVariants(), 'space-y-tight')}>
                <div className="flex items-center justify-between">
                    <Heading level={1} id="assessment-title">{assessment.template?.name || t('fallbackName')}</Heading>
                    <StatusBadge variant={STATUS_BADGE[assessment.status]} id="assessment-status">{assessment.status}</StatusBadge>
                </div>
                <div className="flex gap-default text-sm text-content-muted">
                    <span>{t('score')} <strong className="text-content-emphasis" id="assessment-score">{assessment.score != null ? assessment.score.toFixed(1) : '—'}</strong></span>
                    <span>{t('rating')} {assessment.riskRating ? <StatusBadge variant={CRIT_BADGE[assessment.riskRating]} id="assessment-rating">{assessment.riskRating}</StatusBadge> : '—'}</span>
                    <span>{t('requestedBy')} {assessment.requestedBy?.name || '—'}</span>
                </div>
                {assessment.decidedBy && <p className="text-sm text-content-muted">{t('decidedBy', { name: assessment.decidedBy.name, date: formatDate(assessment.decidedAt) })}</p>}
                {assessment.notes && <p className="text-sm text-content-default bg-bg-default/50 p-2 rounded">{assessment.notes}</p>}
            </div>

            {/* Saved message */}
            {savedMessage && <div className="bg-bg-success text-content-success p-2 rounded text-sm" id="save-success">{savedMessage}</div>}

            {/* Questions by section */}
            {Object.entries(sections).map(([section, sQuestions]) => (
                <div key={section} className={cn(cardVariants(), 'space-y-default')}>
                    <Heading level={2} className="border-b border-border-default pb-2">{section}</Heading>
                    {sQuestions.map((q, idx) => (
                        <div key={q.id} className="space-y-1.5">
                            <div className="flex items-start gap-tight">
                                <span className="text-xs text-content-subtle font-mono mt-0.5">{q.sortOrder}.</span>
                                <div className="flex-1">
                                    <p className="text-sm font-medium">{q.prompt}{q.required && <RequiredMarker />}</p>
                                    <div className="mt-1.5">{renderInput(q)}</div>
                                </div>
                                <Tooltip content={t('weightTooltip')}>
                                    <span className="text-xs text-content-subtle cursor-help">w:{q.weight}</span>
                                </Tooltip>
                            </div>
                        </div>
                    ))}
                </div>
            ))}

            {/* Actions */}
            <div className="flex gap-compact items-center flex-wrap">
                {isDraft && canWrite && (
                    <>
                        <Button variant="primary" onClick={saveAnswers} disabled={saving} id="save-answers-btn">
                            {saving ? t('saving') : t('saveAnswers')}
                        </Button>
                        <Button variant="secondary" onClick={submitAssessment} disabled={submitting} id="submit-assessment-btn">
                            {submitting ? t('submitting') : t('submitForReview')}
                        </Button>
                    </>
                )}
                {isInReview && isAdmin && (
                    <div className="flex items-center gap-tight w-full">
                        <input className="input flex-1" placeholder={t('decisionNotes')} value={decideNotes}
                            onChange={e => setDecideNotes(e.target.value)} id="decide-notes-input" />
                        <Button variant="primary" onClick={() => decideAssessment('APPROVED')} disabled={deciding} id="approve-assessment-btn">
                            {t('approve')}
                        </Button>
                        <Button variant="destructive" onClick={() => decideAssessment('REJECTED')} disabled={deciding} id="reject-assessment-btn">
                            {t('reject')}
                        </Button>
                    </div>
                )}
                {isDecided && (
                    <div className="text-sm text-content-muted">
                        {t('decidedPrefix')} <strong className={assessment.status === 'APPROVED' ? 'text-content-success' : 'text-content-error'}>{assessment.status}</strong>.
                        {assessment.riskRating && <span className="ml-2">{t('riskRatingLabel')} <StatusBadge variant={CRIT_BADGE[assessment.riskRating]}>{assessment.riskRating}</StatusBadge></span>}
                    </div>
                )}
            </div>
        </div>
    );
}
