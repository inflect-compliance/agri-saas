'use client';

/**
 * Shared "Risk Evaluation" scoring box — likelihood + impact sliders and
 * a tone-coloured score badge. Used by both NewRiskModal (create) and
 * EditRiskModal (detail) so the evaluation UI is identical on both
 * surfaces. `idPrefix` keeps the existing element ids stable
 * (`risk-*` for create, `risk-edit-*` for edit).
 */
import { InfoTooltip } from '@/components/ui/tooltip';
import { useTranslations } from 'next-intl';

export function getRiskBadge(score: number): {
    label: string;
    tone: 'success' | 'warning' | 'danger' | 'critical';
} {
    if (score <= 5) return { label: 'Low', tone: 'success' };
    if (score <= 12) return { label: 'Medium', tone: 'warning' };
    if (score <= 18) return { label: 'High', tone: 'danger' };
    return { label: 'Critical', tone: 'critical' };
}

const TONE_CLASSES: Record<ReturnType<typeof getRiskBadge>['tone'], string> = {
    success: 'border-border-success bg-bg-success text-content-success',
    warning: 'border-border-warning bg-bg-warning text-content-warning',
    danger: 'border-border-warning bg-bg-warning text-content-warning',
    critical: 'border-border-error bg-bg-error text-content-error',
};

export interface RiskEvaluationFieldsProps {
    likelihood: number;
    impact: number;
    onLikelihood: (v: number) => void;
    onImpact: (v: number) => void;
    /** Element-id prefix — 'risk' (create) or 'risk-edit' (edit). */
    idPrefix?: string;
}

export function RiskEvaluationFields({
    likelihood,
    impact,
    onLikelihood,
    onImpact,
    idPrefix = 'risk',
}: RiskEvaluationFieldsProps) {
    const t = useTranslations('riskEvaluation');
    const score = likelihood * impact;
    const badge = getRiskBadge(score);
    return (
        <div className="space-y-default rounded-lg border border-border-subtle bg-bg-subtle p-4">
            <p className="text-sm font-medium text-content-emphasis">
                {t('title')}
            </p>
            <div className="grid grid-cols-1 gap-default sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <div>
                    <div className="mb-1 flex items-center gap-1.5">
                        <label
                            className="text-sm text-content-default"
                            htmlFor={`${idPrefix}-likelihood`}
                        >
                            {t('likelihood')} ·{' '}
                            <span className="font-semibold text-content-emphasis">
                                {likelihood}
                            </span>
                        </label>
                        <InfoTooltip
                            aria-label={t('aboutLikelihood')}
                            iconClassName="h-3.5 w-3.5"
                            content={t('likelihoodHelp')}
                        />
                    </div>
                    <input
                        id={`${idPrefix}-likelihood`}
                        type="range"
                        min={1}
                        max={5}
                        value={likelihood}
                        onChange={(e) => onLikelihood(Number(e.target.value))}
                        className="w-full accent-brand-emphasis"
                    />
                </div>
                <div>
                    <div className="mb-1 flex items-center gap-1.5">
                        <label
                            className="text-sm text-content-default"
                            htmlFor={`${idPrefix}-impact`}
                        >
                            {t('impact')} ·{' '}
                            <span className="font-semibold text-content-emphasis">
                                {impact}
                            </span>
                        </label>
                        <InfoTooltip
                            aria-label={t('aboutImpact')}
                            iconClassName="h-3.5 w-3.5"
                            content={t('impactHelp')}
                        />
                    </div>
                    <input
                        id={`${idPrefix}-impact`}
                        type="range"
                        min={1}
                        max={5}
                        value={impact}
                        onChange={(e) => onImpact(Number(e.target.value))}
                        className="w-full accent-brand-emphasis"
                    />
                </div>
                <div
                    className={`shrink-0 rounded-md border px-3 py-2 text-center ${TONE_CLASSES[badge.tone]}`}
                    data-testid={`${idPrefix}-score-preview`}
                >
                    <p className="text-xs uppercase tracking-wider opacity-75">
                        {t('score')}
                    </p>
                    <p className="text-xl font-bold">{score}</p>
                    <p className="text-[11px] font-medium">{t(badge.label.toLowerCase())}</p>
                </div>
            </div>
        </div>
    );
}
