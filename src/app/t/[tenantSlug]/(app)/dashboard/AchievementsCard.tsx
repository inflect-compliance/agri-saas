'use client';

import { useEffect, useRef } from 'react';

import { Card } from '@/components/ui/card';
import { Heading } from '@/components/ui/typography';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/format-date';
import { cn } from '@/lib/cn';
import { useCelebration, useLocalStorage } from '@/components/ui/hooks';
import { MILESTONES, readCelebratedAchievements, markAchievementsCelebrated, type CelebrationPreset } from '@/lib/celebrations';
import { AG_MILESTONE_ORDER, type AchievementItem, type AchievementsResult } from '@/app-layer/usecases/achievements';

/**
 * Achievements card — the milestones that matter, surfaced on the ag
 * dashboard. Earned milestones fire a ONE-TIME celebration per browser
 * (localStorage dedupe via celebrations.ts; the confetti itself is
 * reduced-motion-safe via useCelebration → canvas-confetti
 * `disableForReducedMotion`). Includes an opt-in journaling streak that's
 * encouraging, never guilt-trippy.
 */
const PRESET_WEIGHT: Record<CelebrationPreset, number> = { fireworks: 3, burst: 2, rain: 1 };

export default function AchievementsCard({ achievements }: { achievements: AchievementsResult }) {
    const { celebrate } = useCelebration();
    const fired = useRef(false);
    const [streakOptIn, setStreakOptIn] = useLocalStorage<boolean>('agri.journalStreak.optIn.v1', false);

    // Fire ONE celebration per dashboard visit for any newly-earned milestone
    // (the highest-weight preset), then mark ALL newly-earned as celebrated so
    // a freshly-rolled-out tenant with a backlog doesn't get a confetti storm
    // — each genuinely-new milestone thereafter celebrates exactly once. The
    // dedupe read is synchronous (celebrations.ts), so it's correct on mount.
    useEffect(() => {
        if (fired.current) return;
        fired.current = true;
        const celebrated = readCelebratedAchievements();
        const newly = achievements.milestones.filter((m) => m.earned && !celebrated.has(m.key));
        if (newly.length === 0) return;
        const top = newly.reduce((best, m) =>
            PRESET_WEIGHT[MILESTONES[m.key].preset] > PRESET_WEIGHT[MILESTONES[best.key].preset] ? m : best,
        );
        celebrate(top.key);
        markAchievementsCelebrated(newly.map((m) => m.key));
    }, [achievements, celebrate]);

    const byKey = new Map(achievements.milestones.map((m) => [m.key, m]));
    const ordered = AG_MILESTONE_ORDER.map((k) => byKey.get(k)).filter((m): m is AchievementItem => Boolean(m));
    const earnedCount = ordered.filter((m) => m.earned).length;

    const toggleStreak = () => setStreakOptIn(!streakOptIn);

    const { current, best } = achievements.streak;

    return (
        <Card>
            <div className="mb-3 flex items-baseline justify-between gap-tight">
                <Heading level={3} id="achievements-heading">Achievements</Heading>
                <span className="text-xs text-content-muted tabular-nums">{earnedCount}/{ordered.length}</span>
            </div>
            <ul className="space-y-tight" aria-labelledby="achievements-heading">
                {ordered.map((m) => (
                    <li
                        key={m.key}
                        className={cn('flex items-baseline gap-tight text-xs', m.earned ? 'text-content-default' : 'text-content-subtle')}
                    >
                        <span aria-hidden="true">{m.earned ? '🏅' : '🔒'}</span>
                        <span className={cn('truncate', m.earned && 'font-medium')}>{MILESTONES[m.key].message}</span>
                        {m.earned && m.earnedAt && (
                            <span className="ml-auto whitespace-nowrap text-content-muted">{formatDate(m.earnedAt)}</span>
                        )}
                    </li>
                ))}
            </ul>

            {/* Opt-in journaling streak — encouraging, never guilt-trippy. */}
            <div className="mt-3 border-t border-border-subtle pt-3">
                {streakOptIn ? (
                    <p className="text-xs text-content-secondary">
                        {current > 0
                            ? `🔥 ${current}-day journaling streak${best > current ? ` · best ${best}` : ''}.`
                            : `Log an entry to begin a streak${best > 0 ? ` — your best is ${best} ${best === 1 ? 'day' : 'days'}` : ''}.`}{' '}
                        <button type="button" onClick={toggleStreak} className="text-content-muted underline">Hide</button>
                    </p>
                ) : (
                    <Button variant="ghost" size="sm" className="text-xs" onClick={toggleStreak}>
                        Track my journaling streak
                    </Button>
                )}
            </div>
        </Card>
    );
}
