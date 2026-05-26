"use client";

/**
 * Epic P2-PR-B — `useTenantAssets(tenantSlug)`.
 *
 * Sibling of `useTenantControls` (P2-PR-A) and `useTenantRisks`
 * (P2-PR-B) for the inspector's asset-node picker. Assets carry a
 * `key` (short code) + `name` so the label format is "<key> · <name>"
 * when key is present, otherwise bare name.
 */
import { useEffect, useState } from "react";

export interface TenantAssetOption {
    id: string;
    key: string | null;
    name: string;
}

interface TenantAssetsState {
    options: TenantAssetOption[];
    loading: boolean;
    error: string | null;
}

const CACHE = new Map<string, TenantAssetOption[]>();

export function useTenantAssets(tenantSlug: string): TenantAssetsState {
    const cached = CACHE.get(tenantSlug);
    const [state, setState] = useState<TenantAssetsState>(() => ({
        options: cached ?? [],
        loading: cached === undefined && tenantSlug !== "",
        error: null,
    }));

    useEffect(() => {
        if (tenantSlug === "") {
            setState({ options: [], loading: false, error: null });
            return;
        }
        if (CACHE.has(tenantSlug)) {
            setState({
                options: CACHE.get(tenantSlug) ?? [],
                loading: false,
                error: null,
            });
            return;
        }

        let cancelled = false;
        setState({ options: [], loading: true, error: null });
        const fetchAssets = async () => {
            try {
                const res = await fetch(`/api/t/${tenantSlug}/assets`);
                if (!res.ok) {
                    throw new Error(`Could not load assets (${res.status})`);
                }
                const body = (await res.json()) as unknown;
                const rows = Array.isArray(body)
                    ? (body as unknown[])
                    : Array.isArray(
                            (body as { assets?: unknown[] })?.assets,
                        )
                      ? (body as { assets: unknown[] }).assets
                      : Array.isArray((body as { data?: unknown[] })?.data)
                        ? (body as { data: unknown[] }).data
                        : [];
                const options: TenantAssetOption[] = rows
                    .map((r) => {
                        const row = r as {
                            id?: unknown;
                            key?: unknown;
                            name?: unknown;
                        };
                        if (typeof row.id !== "string") return null;
                        return {
                            id: row.id,
                            key:
                                typeof row.key === "string" ? row.key : null,
                            name:
                                typeof row.name === "string"
                                    ? row.name
                                    : "(unnamed)",
                        };
                    })
                    .filter((r): r is TenantAssetOption => r !== null);
                CACHE.set(tenantSlug, options);
                if (!cancelled) {
                    setState({ options, loading: false, error: null });
                }
            } catch (err) {
                if (!cancelled) {
                    setState({
                        options: [],
                        loading: false,
                        error:
                            err instanceof Error
                                ? err.message
                                : "Could not load assets",
                    });
                }
            }
        };
        void fetchAssets();
        return () => {
            cancelled = true;
        };
    }, [tenantSlug]);

    return state;
}

export function formatAssetLabel(opt: TenantAssetOption): string {
    return opt.key ? `${opt.key} · ${opt.name}` : opt.name;
}

export function __resetTenantAssetsCacheForTests(): void {
    CACHE.clear();
}
