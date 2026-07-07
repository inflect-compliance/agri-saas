'use client';

/**
 * Soil-aware crop suitability pill (#37) — an ADVISORY good/caution/poor flag
 * shown when planning a crop on a parcel. `unknown` renders a quiet neutral
 * pill (we don't hide it — "not enough data" is honest signal). The reason
 * string is surfaced as a tooltip/title and, optionally, inline.
 *
 * Never automation: this is a suggestion, and the reason always carries the
 * "verify with a soil test / agronomist" advisory (built in the engine).
 */

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import type { SuitabilityFlag } from '@/lib/soil/suitability';

export interface SoilSuitabilityBadgeProps {
    flag: SuitabilityFlag;
    reason?: string;
    /** Show the reason text beneath the pill. */
    showReason?: boolean;
}

const TONE: Record<SuitabilityFlag, string> = {
    good: 'bg-[color-mix(in_srgb,#16a34a_18%,transparent)] text-[#166534] dark:text-[#4ade80]',
    caution: 'bg-[color-mix(in_srgb,#d97706_20%,transparent)] text-[#92400e] dark:text-[#fbbf24]',
    poor: 'bg-[color-mix(in_srgb,#dc2626_18%,transparent)] text-[#991b1b] dark:text-[#f87171]',
    unknown: 'bg-bg-muted text-content-muted',
};

export function SoilSuitabilityBadge({ flag, reason, showReason }: SoilSuitabilityBadgeProps) {
    const t = useTranslations('ag.soil');
    const label =
        flag === 'good'
            ? t('suitabilityGood')
            : flag === 'caution'
                ? t('suitabilityCaution')
                : flag === 'poor'
                    ? t('suitabilityPoor')
                    : t('suitabilityUnknown');

    return (
        <span className="inline-flex flex-col gap-1">
            <span
                className={cn(
                    'inline-flex w-fit items-center rounded-full px-2 py-0.5 text-xs font-medium',
                    TONE[flag],
                )}
                title={reason}
            >
                {label}
            </span>
            {showReason && reason && (
                <span className="text-xs text-content-muted">{reason}</span>
            )}
        </span>
    );
}
