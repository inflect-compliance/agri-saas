'use client';

/**
 * OfflineSyncBar — the shared online/offline + pending-sync status strip for
 * every offline-capable field surface. Presentational: the host owns a
 * single `useOfflineSync()` instance and passes its values in (so a surface
 * never spins up two competing flush loops). Shows a "Sync now" button when
 * there's queued work and we're back online.
 */
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { cn } from '@/lib/cn';

export interface OfflineSyncBarProps {
    online: boolean;
    pending: number;
    onSyncNow: () => void;
    className?: string;
}

export function OfflineSyncBar({ online, pending, onSyncNow, className }: OfflineSyncBarProps) {
    return (
        <div
            data-testid="offline-sync-bar"
            className={cn(
                'flex items-center justify-between rounded-lg border border-border-subtle bg-bg-default px-3 py-2',
                className,
            )}
        >
            <span className="flex items-center gap-compact text-sm">
                <StatusBadge variant={online ? 'success' : 'warning'}>{online ? 'Online' : 'Offline'}</StatusBadge>
                {pending > 0 && (
                    <span className="text-content-secondary" data-testid="offline-pending-count">
                        {pending} queued
                    </span>
                )}
            </span>
            {pending > 0 && online && (
                <Button variant="secondary" size="sm" onClick={onSyncNow}>Sync now</Button>
            )}
        </div>
    );
}

export default OfflineSyncBar;
