'use client';

/**
 * Automation inspector panel (Visual Rule Editor VR-4).
 *
 * Inline rule configuration when an automation node is selected — the Rule
 * Builder's per-step forms, without leaving the canvas. Branches on node kind
 * (trigger / condition / action / slaGate); edits auto-save to the linked
 * AutomationRule (the node's `dataJson.ruleId`, written by the VR-3 sync).
 *
 * The panel edits the RULE (logic lives on AutomationRule, per the VR-3
 * invariant); it never writes logic back onto the node.
 */
import { useState, useEffect, useMemo } from 'react';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/ui/form-field';
import { useTenantSWR } from '@/lib/hooks/use-tenant-swr';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';
import { CACHE_KEYS } from '@/lib/swr-keys';
import { eventOptionsByDomain } from '@/lib/automation/event-labels';

type AutomationKind = 'trigger' | 'condition' | 'action' | 'slaGate';

interface Rule {
    id: string;
    name: string;
    description: string | null;
    triggerEvent: string;
    triggerFilterJson: unknown;
    actionType: string;
    actionConfigJson: unknown;
    status: string;
    slaWindowMinutes: number | null;
}

const ACTION_OPTIONS: ComboboxOption[] = [
    { value: 'NOTIFY_USER', label: 'Notify user' },
    { value: 'CREATE_TASK', label: 'Create task' },
    { value: 'UPDATE_STATUS', label: 'Update status' },
    { value: 'WEBHOOK', label: 'Webhook' },
];

const TRIGGER_OPTIONS: ComboboxOption[] = eventOptionsByDomain().flatMap((g) =>
    g.events.map((ev) => ({ value: ev.name, label: ev.label })),
);

export function AutomationInspectorPanel({
    kind,
    ruleId,
}: {
    kind: AutomationKind;
    ruleId: string | null;
}) {
    const apiUrl = useTenantApiUrl();
    const { data: rule, mutate } = useTenantSWR<Rule>(
        ruleId ? CACHE_KEYS.automation.rules.detail(ruleId) : null,
    );
    const [name, setName] = useState('');
    const [sla, setSla] = useState('');

    useEffect(() => {
        setName(rule?.name ?? '');
        setSla(rule?.slaWindowMinutes != null ? String(rule.slaWindowMinutes) : '');
    }, [rule?.id, rule?.name, rule?.slaWindowMinutes]);

    // Auto-save via PUT (UpdateAutomationRuleSchema accepts each field
    // optionally; its action-config superRefine only fires when actionType
    // AND actionConfig are sent together, so single-field edits are valid).
    async function patchRule(patch: Record<string, unknown>) {
        if (!ruleId || !rule) return;
        await fetch(apiUrl(CACHE_KEYS.automation.rules.detail(ruleId)), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
        });
        await mutate();
    }

    const triggerSelected = useMemo(
        () => TRIGGER_OPTIONS.find((o) => o.value === rule?.triggerEvent) ?? null,
        [rule?.triggerEvent],
    );
    const actionSelected = useMemo(
        () => ACTION_OPTIONS.find((o) => o.value === rule?.actionType) ?? null,
        [rule?.actionType],
    );

    if (!ruleId) {
        return (
            <p className="text-sm text-content-muted" data-testid="automation-inspector-unsynced">
                Save the canvas to link this node to a rule, then configure it here.
            </p>
        );
    }

    return (
        <div className="space-y-default" data-testid="automation-inspector">
            <div className="flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-wide text-content-subtle">
                    {kind} rule
                </span>
                <label className="flex items-center gap-tight text-xs text-content-muted">
                    {rule?.status === 'ENABLED' ? 'Enabled' : 'Disabled'}
                    <Switch
                        checked={rule?.status === 'ENABLED'}
                        onCheckedChange={(c) => patchRule({ status: c ? 'ENABLED' : 'DISABLED' })}
                        aria-label="Toggle rule enabled"
                    />
                </label>
            </div>

            <FormField label="Rule name">
                <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={() => name.trim() && name !== rule?.name && patchRule({ name: name.trim() })}
                />
            </FormField>

            {kind === 'trigger' && (
                <FormField label="Trigger event">
                    <Combobox
                        options={TRIGGER_OPTIONS}
                        selected={triggerSelected}
                        setSelected={(o) => o && patchRule({ triggerEvent: o.value })}
                        placeholder="Select event…"
                        forceDropdown
                        matchTriggerWidth
                    />
                </FormField>
            )}

            {kind === 'action' && (
                <FormField label="Action type">
                    <Combobox
                        options={ACTION_OPTIONS}
                        selected={actionSelected}
                        setSelected={(o) => o && patchRule({ actionType: o.value })}
                        placeholder="Select action…"
                        forceDropdown
                        matchTriggerWidth
                    />
                </FormField>
            )}

            {kind === 'condition' && (
                <p className="text-xs text-content-subtle">
                    Condition filter: {rule?.triggerFilterJson ? 'configured' : 'matches all'}.
                    Edit the full filter in the rule builder.
                </p>
            )}

            {kind === 'slaGate' && (
                <FormField label="SLA window (minutes)">
                    <Input
                        type="number"
                        min={1}
                        value={sla}
                        onChange={(e) => setSla(e.target.value)}
                        onBlur={() =>
                            patchRule({ slaWindowMinutes: sla ? Number(sla) : null })
                        }
                        placeholder="e.g. 1440"
                    />
                </FormField>
            )}
        </div>
    );
}
