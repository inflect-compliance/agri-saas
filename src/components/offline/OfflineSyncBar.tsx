'use client';

/**
 * OfflineSyncBar — the shared online/offline + pending-sync status strip for
 * every offline-capable field surface. Presentational: the host owns a
 * single `useOfflineSync()` instance and passes its values in (so a surface
 * never spins up two competing flush loops). Shows a "Sync now" button when
 * there's queued work and we're back online.
 */
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { cn } from '@/lib/cn';

export interface OfflineSyncBarProps {
    online: boolean;
    pending: number;
    /** Subset of `pending` that are photo uploads — surfaced distinctly. */
    pendingPhotos?: number;
    onSyncNow: () => void;
    className?: string;
}

export function OfflineSyncBar({ online, pending, pendingPhotos = 0, onSyncNow, className }: OfflineSyncBarProps) {
    const t = useTranslations('offline');
    // Photos and text mutations queue in the same outbox but read very
    // differently to a field operator ("2 photos will upload" vs "3 marks
    // will sync"), so show them as separate counts.
    const mutations = Math.max(0, pending - pendingPhotos);
    return (
        <div
            data-testid="offline-sync-bar"
            className={cn(
                'flex items-center justify-between rounded-lg border border-border-subtle bg-bg-default px-3 py-2',
                className,
            )}
        >
            <span className="flex items-center gap-compact text-sm">
                <StatusBadge variant={online ? 'success' : 'warning'}>{online ? t('online') : t('offline')}</StatusBadge>
                {mutations > 0 && (
                    <span className="text-content-secondary" data-testid="offline-pending-count">
                        {t('queued', { count: mutations })}
                    </span>
                )}
                {pendingPhotos > 0 && (
                    <span className="text-content-secondary">
                        {t('photosQueued', { count: pendingPhotos })}
                    </span>
                )}
            </span>
            {pending > 0 && online && (
                <Button variant="secondary" size="sm" onClick={onSyncNow}>{t('syncNow')}</Button>
            )}
        </div>
    );
}

export default OfflineSyncBar;
