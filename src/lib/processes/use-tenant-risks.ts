"use client";

/**
 * Epic P2-PR-B — `useTenantRisks(tenantSlug)`.
 *
 * Sibling of `useTenantControls` (P2-PR-A) for the inspector's
 * risk-node picker. Same shape, different endpoint + option label
 * (Risks carry `title` only — no `ref`).
 *
 * Why a sibling module + not a generalised hook:
 *   The three pickers (controls, risks, assets) each hit a slightly
 *   different response shape and surface different label fields.
 *   Three short modules read more clearly than one parameterised
 *   abstraction at this scale; if we add a fourth picker we should
 *   reach for a `useTenantList<T>(...)` generic.
 */
import { useEffect, useState } from "react";

export interface TenantRiskOption {
    id: string;
    title: string;
}

interface TenantRisksState {
    options: TenantRiskOption[];
    loading: boolean;
    error: string | null;
}

const CACHE = new Map<string, TenantRiskOption[]>();

export function useTenantRisks(tenantSlug: string): TenantRisksState {
    const cached = CACHE.get(tenantSlug);
    const [state, setState] = useState<TenantRisksState>(() => ({
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
        const fetchRisks = async () => {
            try {
                const res = await fetch(`/api/t/${tenantSlug}/risks`);
                if (!res.ok) {
                    throw new Error(`Could not load risks (${res.status})`);
                }
                const body = (await res.json()) as unknown;
                // Normalise both bare-array AND `{ risks: [...] }`
                // / `{ data: [...] }` wrapper responses — the API
                // shape varies between paginated + non-paginated.
                const rows = Array.isArray(body)
                    ? (body as unknown[])
                    : Array.isArray(
                            (body as { risks?: unknown[] })?.risks,
                        )
                      ? (body as { risks: unknown[] }).risks
                      : Array.isArray((body as { data?: unknown[] })?.data)
                        ? (body as { data: unknown[] }).data
                        : [];
                const options: TenantRiskOption[] = rows
                    .map((r) => {
                        const row = r as {
                            id?: unknown;
                            title?: unknown;
                        };
                        if (typeof row.id !== "string") return null;
                        return {
                            id: row.id,
                            title:
                                typeof row.title === "string"
                                    ? row.title
                                    : "(untitled)",
                        };
                    })
                    .filter((r): r is TenantRiskOption => r !== null);
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
                                : "Could not load risks",
                    });
                }
            }
        };
        void fetchRisks();
        return () => {
            cancelled = true;
        };
    }, [tenantSlug]);

    return state;
}

export function __resetTenantRisksCacheForTests(): void {
    CACHE.clear();
}
