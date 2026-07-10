'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { cn } from '@/lib/cn';

/**
 * Shared shell for an AI-generated suggestion (agronomy copilot
 * explanation, photo pest/disease ID). Every AI surface MUST render
 * through this so two invariants always hold:
 *   1. a CONFIDENCE badge (icon + text, never colour-only), and
 *   2. a "verify with an agronomist" human-review disclaimer.
 *
 * AI here is triage, not diagnosis — the disclaimer is non-negotiable.
 */
export type AiConfidence = 'low' | 'medium' | 'high';

const CONFIDENCE_VARIANT = { high: 'success', medium: 'info', low: 'warning' } as const;

export interface AiSuggestionCardProps {
    title: string;
    confidence?: AiConfidence | null;
    /** Optional attribution (e.g. "claude-3.5-sonnet · 2h ago"). */
    meta?: string | null;
    children: ReactNode;
    className?: string;
}

export function AiSuggestionCard({ title, confidence, meta, children, className }: AiSuggestionCardProps) {
    const t = useTranslations('agStatus');
    return (
        <Card
            className={cn('p-4 space-y-default border-border-emphasis', className)}
            role="region"
            aria-label={t('aiSuggestionAria', { title })}
        >
            <div className="flex items-start justify-between gap-compact flex-wrap">
                <div className="min-w-0">
                    <div className="text-sm font-semibold text-content-default">{title}</div>
                    {meta && <div className="text-[11px] text-content-subtle mt-0.5">{meta}</div>}
                </div>
                {confidence && (
                    <StatusBadge variant={CONFIDENCE_VARIANT[confidence]} size="sm">
                        {t(`confidence.${confidence}`)}
                    </StatusBadge>
                )}
            </div>

            <div className="text-sm text-content-muted space-y-tight">{children}</div>

            <p className="text-[11px] text-content-subtle border-t border-border-subtle pt-2">
                {t('disclaimer')}
            </p>
        </Card>
    );
}
