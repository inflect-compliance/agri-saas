'use client';

/**
 * Canvas sync status (VR-3).
 *
 * Tracks the Canvas ↔ AutomationRule sync state — updated optimistically on
 * save, confirmed on response. Drives the document-bar "In sync / Draft
 * changes / Sync error" indicator (wired in VR-2's doc bar, surfaced here).
 */
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

export type CanvasSyncState = 'synced' | 'pending' | 'error';

interface CanvasSyncStatusValue {
    status: CanvasSyncState;
    setStatus: (s: CanvasSyncState) => void;
}

const CanvasSyncStatusContext = createContext<CanvasSyncStatusValue>({
    status: 'synced',
    setStatus: () => {},
});

export function CanvasSyncStatusProvider({ children }: { children: ReactNode }) {
    const [status, setStatusRaw] = useState<CanvasSyncState>('synced');
    const setStatus = useCallback((s: CanvasSyncState) => setStatusRaw(s), []);
    return (
        <CanvasSyncStatusContext.Provider value={{ status, setStatus }}>
            {children}
        </CanvasSyncStatusContext.Provider>
    );
}

export function useCanvasSyncStatus(): CanvasSyncStatusValue {
    return useContext(CanvasSyncStatusContext);
}
