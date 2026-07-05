'use client';

/**
 * Controlled field markup for the audit-create form.
 *
 *   title          — required.
 *   frameworkKey   — optional Framework picker (B8). Fetched from
 *                    `/api/t/<slug>/frameworks` on mount; empty
 *                    string = no link. The picker also surfaces a
 *                    "No framework" option for ad-hoc audits.
 *   auditors       — free text.
 *   scope          — textarea.
 *
 * The `generateChecklist` toggle stays true by default — auditors
 * who want a blank audit can clear the checklist after creation.
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Combobox } from '@/components/ui/combobox';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';
import type { NewAuditFormReturn } from './useNewAuditForm';

export interface NewAuditFieldsLabels {
    auditTitle: string;
    auditors: string;
    scope: string;
    /**
     * B8 — Framework picker label. Optional in the labels bag so the
     * default English string survives for callers that haven't
     * migrated i18n.
     */
    framework?: string;
}

interface FrameworkOption {
    value: string;
    label: string;
}

export function NewAuditFields({
    form,
    labels,
}: {
    form: NewAuditFormReturn;
    labels: NewAuditFieldsLabels;
}) {
    const t = useTranslations('audits');
    const NO_FRAMEWORK_OPTION: FrameworkOption = {
        value: '',
        label: t('form.noFramework'),
    };
    const apiUrl = useTenantApiUrl();
    const [frameworks, setFrameworks] = useState<FrameworkOption[]>([
        NO_FRAMEWORK_OPTION,
    ]);

    // B8 — lazy-load the framework catalog on mount. The list is
    // small (≈5-10 rows today) and the create-audit modal is
    // opened on demand, so a single GET on open is the right shape.
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const res = await fetch(apiUrl('/frameworks'));
                if (!res.ok) return;
                const rows = (await res.json()) as Array<{
                    key: string;
                    name: string;
                }>;
                if (cancelled) return;
                // eslint-disable-next-line react-hooks/set-state-in-effect
                setFrameworks([
                    NO_FRAMEWORK_OPTION,
                    ...rows.map((fw) => ({ value: fw.key, label: fw.name })),
                ]);
            } catch {
                // Fail-soft — the picker stays usable with just the
                // "No framework" option so audit creation never
                // blocks on a catalog GET.
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [apiUrl]);

    return (
        <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-default">
                <FormField label={labels.auditTitle} required>
                    <Input
                        id="audit-title-input"
                        value={form.fields.title}
                        onChange={(e) => form.setField('title', e.target.value)}
                        required
                    />
                </FormField>
                <FormField label={labels.framework ?? t('form.framework')}>
                    <Combobox
                        id="audit-framework-select"
                        data-testid="audit-framework-select"
                        options={frameworks}
                        selected={
                            frameworks.find(
                                (o) => o.value === form.fields.frameworkKey,
                            ) ?? NO_FRAMEWORK_OPTION
                        }
                        setSelected={(opt) =>
                            form.setField('frameworkKey', opt?.value ?? '')
                        }
                        placeholder={t('form.noFramework')}
                        matchTriggerWidth
                    />
                </FormField>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-default">
                <FormField label={labels.auditors}>
                    <Input
                        id="audit-auditors-input"
                        value={form.fields.auditors}
                        onChange={(e) =>
                            form.setField('auditors', e.target.value)
                        }
                    />
                </FormField>
            </div>

            <FormField label={labels.scope}>
                <Textarea
                    id="audit-scope-input"
                    className="h-24"
                    value={form.fields.scope}
                    onChange={(e) => form.setField('scope', e.target.value)}
                />
            </FormField>
        </>
    );
}
