'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTenantApiUrl, useTenantHref, useTenantContext } from '@/lib/tenant-context-provider';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { UserCombobox } from '@/components/ui/user-combobox';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { FormField } from '@/components/ui/form-field';
import { FormError } from '@/components/ui/form-error';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip } from '@/components/ui/tooltip';
import { DatePicker } from '@/components/ui/date-picker/date-picker';
import {
    parseYMD,
    startOfUtcDay,
    toYMD,
} from '@/components/ui/date-picker/date-utils';
import { useFormTelemetry } from '@/lib/telemetry/form-telemetry';

const TYPE_OPTIONS: ComboboxOption[] = [
    { value: 'TASK', label: 'Task' },
    { value: 'AUDIT_FINDING', label: 'Audit Finding' },
    { value: 'CONTROL_GAP', label: 'Control Gap' },
    { value: 'INCIDENT', label: 'Incident' },
    { value: 'IMPROVEMENT', label: 'Improvement' },
];
const SEVERITY_OPTIONS: ComboboxOption[] = [
    { value: 'INFO', label: 'Info' },
    { value: 'LOW', label: 'Low' },
    { value: 'MEDIUM', label: 'Medium' },
    { value: 'HIGH', label: 'High' },
    { value: 'CRITICAL', label: 'Critical' },
];
const PRIORITY_OPTIONS: ComboboxOption[] = [
    { value: 'P0', label: 'P0 — Critical' },
    { value: 'P1', label: 'P1 — High' },
    { value: 'P2', label: 'P2 — Medium' },
    { value: 'P3', label: 'P3 — Low' },
];

const LINK_ENTITY_OPTIONS: ComboboxOption[] = [
    { value: 'CONTROL', label: 'Control' },
    { value: 'FRAMEWORK_REQUIREMENT', label: 'Framework Requirement' },
    { value: 'ASSET', label: 'Asset' },
    { value: 'RISK', label: 'Risk' },
    { value: 'EVIDENCE', label: 'Evidence' },
];

const FINDING_OPTIONS: ComboboxOption[] = [
    { value: 'INTERNAL', label: 'Internal' },
    { value: 'EXTERNAL_AUDITOR', label: 'External Auditor' },
    { value: 'PEN_TEST', label: 'Pen Test' },
    { value: 'INCIDENT', label: 'Incident' },
];
const GAP_TYPE_OPTIONS: ComboboxOption[] = [
    { value: 'DESIGN', label: 'Design' },
    { value: 'OPERATING_EFFECTIVENESS', label: 'Operating Effectiveness' },
    { value: 'DOCUMENTATION', label: 'Documentation' },
];

type PendingLink = { entityType: string; entityId: string };

export default function NewTaskPage() {
    const apiUrl = useTenantApiUrl();
    const tenantHref = useTenantHref();
    const { tenantSlug } = useTenantContext();
    const router = useRouter();

    const [form, setForm] = useState({
        title: '', description: '', type: 'TASK', severity: 'MEDIUM',
        priority: 'P2', dueAt: '', assigneeUserId: '', controlId: '',
        findingSource: '', controlGapType: '',
    });
    const [pendingLinks, setPendingLinks] = useState<PendingLink[]>([]);
    const [linkEntityType, setLinkEntityType] = useState('CONTROL');
    const [linkEntityId, setLinkEntityId] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const update = (field: string, value: string) => setForm(prev => ({ ...prev, [field]: value }));

    const addPendingLink = () => {
        if (!linkEntityId.trim()) return;
        setPendingLinks(prev => [...prev, { entityType: linkEntityType, entityId: linkEntityId.trim() }]);
        setLinkEntityId('');
    };
    const removePendingLink = (idx: number) => {
        setPendingLinks(prev => prev.filter((_, i) => i !== idx));
    };

    // Validation: certain types require a control or link
    const needsControlOrLink = ['AUDIT_FINDING', 'CONTROL_GAP'].includes(form.type);
    const needsAssetOrControl = form.type === 'INCIDENT';
    const hasControlOrLink = !!form.controlId || pendingLinks.some(l => ['CONTROL', 'FRAMEWORK_REQUIREMENT'].includes(l.entityType));
    const hasAssetOrControl = !!form.controlId || pendingLinks.some(l => ['CONTROL', 'ASSET'].includes(l.entityType));

    const validationMessage = (() => {
        if (needsControlOrLink && !hasControlOrLink) return 'Audit Finding / Control Gap requires a control or framework requirement link.';
        if (needsAssetOrControl && !hasAssetOrControl) return 'Incident requires an asset or control link.';
        return '';
    })();

    const telemetry = useFormTelemetry('NewTaskPage');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (validationMessage) { setError(validationMessage); return; }
        setSaving(true);
        setError('');
        telemetry.trackSubmit({
            type: form.type,
            severity: form.severity,
            priority: form.priority,
            pendingLinkCount: pendingLinks.length,
            hasAssignee: Boolean(form.assigneeUserId),
        });
        try {
            // Build metadata from audit-specific fields
            const metadataJson: Record<string, string> = {};
            if (form.findingSource) metadataJson.findingSource = form.findingSource;
            if (form.controlGapType) metadataJson.controlGapType = form.controlGapType;

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const body: any = {
                title: form.title,
                type: form.type,
                severity: form.severity,
                priority: form.priority,
                description: form.description || undefined,
                dueAt: form.dueAt || undefined,
                assigneeUserId: form.assigneeUserId || undefined,
                controlId: form.controlId || undefined,
                metadataJson: Object.keys(metadataJson).length > 0 ? metadataJson : undefined,
            };
            const res = await fetch(apiUrl('/tasks'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                const msg = typeof data.error === 'string' ? data.error : data.message || 'Failed to create task';
                throw new Error(msg);
            }
            const task = await res.json();

            // Create pending links
            for (const link of pendingLinks) {
                await fetch(apiUrl(`/tasks/${task.id}/links`), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ entityType: link.entityType, entityId: link.entityId, relation: 'RELATES_TO' }),
                }).catch(() => { });
            }

            telemetry.trackSuccess({ taskId: task.id });
            router.push(tenantHref(`/tasks/${task.id}`));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            telemetry.trackError(e);
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="max-w-2xl mx-auto space-y-6 animate-fadeIn">
            <div>
                <Link href={tenantHref('/tasks')} className="text-content-muted text-xs hover:text-content-emphasis transition">← Tasks</Link>
                <h1 className="text-2xl font-bold mt-1" id="new-task-heading">New Task</h1>
                <p className="text-content-muted text-sm">Create a new task to track.</p>
            </div>

            {error && (
                <div
                    role="alert"
                    className="p-3 rounded-lg border border-border-error bg-bg-error text-content-error text-sm"
                    id="task-error"
                >
                    {error}
                </div>
            )}

            <form onSubmit={handleSubmit} className="glass-card p-6 space-y-5" noValidate>
                <FormField label="Title" required>
                    <Input
                        id="task-title-input"
                        type="text"
                        placeholder="Brief summary of the task"
                        value={form.title}
                        onChange={e => update('title', e.target.value)}
                        required
                    />
                </FormField>
                <FormField label="Description">
                    <Textarea
                        id="task-description-input"
                        rows={3}
                        placeholder="Detailed description (optional)"
                        value={form.description}
                        onChange={e => update('description', e.target.value)}
                    />
                </FormField>
                <div className="grid grid-cols-3 gap-4">
                    <FormField label="Type" required>
                        <Combobox
                            id="task-type-select"
                            name="type"
                            options={TYPE_OPTIONS}
                            selected={TYPE_OPTIONS.find(o => o.value === form.type) ?? null}
                            setSelected={(o) => update('type', o?.value ?? '')}
                            placeholder="Select type…"
                            hideSearch
                            matchTriggerWidth
                            buttonProps={{ className: 'w-full' }}
                            caret
                        />
                    </FormField>
                    <FormField label="Severity">
                        <Combobox
                            id="task-severity-select"
                            name="severity"
                            options={SEVERITY_OPTIONS}
                            selected={SEVERITY_OPTIONS.find(o => o.value === form.severity) ?? null}
                            setSelected={(o) => update('severity', o?.value ?? '')}
                            placeholder="Select severity…"
                            hideSearch
                            matchTriggerWidth
                            buttonProps={{ className: 'w-full' }}
                            caret
                        />
                    </FormField>
                    <FormField label="Priority">
                        <Combobox
                            id="task-priority-select"
                            name="priority"
                            options={PRIORITY_OPTIONS}
                            selected={PRIORITY_OPTIONS.find(o => o.value === form.priority) ?? null}
                            setSelected={(o) => update('priority', o?.value ?? '')}
                            placeholder="Select priority…"
                            hideSearch
                            matchTriggerWidth
                            buttonProps={{ className: 'w-full' }}
                            caret
                        />
                    </FormField>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    {/* Epic 58 — shared DatePicker. `form.dueAt` keeps
                        its YMD-string shape so the POST body matches
                        the pre-migration contract. */}
                    <FormField label="Due Date">
                        <DatePicker
                            id="task-due-input"
                            className="w-full"
                            placeholder="Select date"
                            clearable
                            align="start"
                            value={parseYMD(form.dueAt)}
                            onChange={(next) =>
                                update('dueAt', toYMD(next) ?? '')
                            }
                            disabledDays={{
                                before: startOfUtcDay(new Date()),
                            }}
                            aria-label="Due date"
                        />
                    </FormField>
                    <FormField label="Assignee">
                        <UserCombobox
                            id="task-assignee-input"
                            name="assigneeUserId"
                            tenantSlug={tenantSlug}
                            selectedId={form.assigneeUserId || null}
                            onChange={(userId) =>
                                update('assigneeUserId', userId ?? '')
                            }
                            placeholder="Unassigned"
                            forceDropdown={false}
                        />
                    </FormField>
                </div>

                {/* Control picker */}
                <FormField label="Control ID (optional)">
                    <Input
                        id="task-control-input"
                        type="text"
                        placeholder="Paste control ID to link"
                        value={form.controlId}
                        onChange={e => update('controlId', e.target.value)}
                    />
                </FormField>

                {/* Audit fields — shown for AUDIT_FINDING / CONTROL_GAP */}
                {(form.type === 'AUDIT_FINDING' || form.type === 'CONTROL_GAP') && (
                    <div className="border-t border-border-default pt-4 space-y-4">
                        <h3 className="text-sm font-semibold text-content-default">Audit Details</h3>
                        <div className="grid grid-cols-2 gap-4">
                            <FormField label="Finding Source">
                                <Combobox
                                    id="finding-source-select"
                                    name="findingSource"
                                    options={FINDING_OPTIONS}
                                    selected={FINDING_OPTIONS.find(o => o.value === form.findingSource) ?? null}
                                    setSelected={(o) => update('findingSource', o?.value ?? '')}
                                    placeholder="— Select source —"
                                    hideSearch
                                    matchTriggerWidth
                                    buttonProps={{ className: 'w-full' }}
                                    caret
                                />
                            </FormField>
                            {form.type === 'CONTROL_GAP' && (
                                <FormField label="Control Gap Type">
                                    <Combobox
                                        id="gap-type-select"
                                        name="controlGapType"
                                        options={GAP_TYPE_OPTIONS}
                                        selected={GAP_TYPE_OPTIONS.find(o => o.value === form.controlGapType) ?? null}
                                        setSelected={(o) => update('controlGapType', o?.value ?? '')}
                                        placeholder="— Select type —"
                                        hideSearch
                                        matchTriggerWidth
                                        buttonProps={{ className: 'w-full' }}
                                        caret
                                    />
                                </FormField>
                            )}
                        </div>
                    </div>
                )}

                {/* Links section */}
                <div className="border-t border-border-default pt-4 space-y-3">
                    <h3 className="text-sm font-semibold text-content-default">Links</h3>
                    {validationMessage && (
                        <FormError
                            id="link-validation-hint"
                            className="bg-bg-warning/10 border border-border-warning/40 text-content-warning rounded px-3 py-2 mt-0"
                        >
                            {validationMessage}
                        </FormError>
                    )}
                    <div className="flex gap-2 items-end">
                        <FormField label="Entity Type" className="flex-1">
                            <Combobox
                                id="link-entity-type"
                                name="linkEntityType"
                                options={LINK_ENTITY_OPTIONS}
                                selected={LINK_ENTITY_OPTIONS.find(o => o.value === linkEntityType) ?? null}
                                setSelected={(o) => setLinkEntityType(o?.value ?? 'CONTROL')}
                                placeholder="Select entity…"
                                hideSearch
                                matchTriggerWidth
                                buttonProps={{ className: 'w-full' }}
                                caret
                            />
                        </FormField>
                        <FormField label="Entity ID" className="flex-1">
                            <Input
                                id="link-entity-id"
                                type="text"
                                className="text-sm"
                                placeholder="Paste ID"
                                value={linkEntityId}
                                onChange={e => setLinkEntityId(e.target.value)}
                            />
                        </FormField>
                        <Button type="button" variant="secondary" onClick={addPendingLink} id="add-link-btn">+ Add</Button>
                    </div>
                    {pendingLinks.length > 0 && (
                        <div className="space-y-1" id="pending-links-list">
                            {pendingLinks.map((l, i) => (
                                <div key={i} className="flex items-center gap-2 text-sm text-content-default bg-bg-default/50 rounded px-3 py-1.5">
                                    <span className="badge badge-info text-xs">{l.entityType}</span>
                                    <span className="font-mono text-xs flex-1">{l.entityId}</span>
                                    <Tooltip content="Remove linked item">
                                        <button type="button" className="text-content-error text-xs hover:text-content-error" onClick={() => removePendingLink(i)} aria-label="Remove link">×</button>
                                    </Tooltip>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="flex gap-3 pt-2">
                    <Button type="submit" variant="primary" disabled={saving} id="create-task-btn">
                        {saving ? 'Creating...' : 'Create Task'}
                    </Button>
                    <Link href={tenantHref('/tasks')} className={buttonVariants({ variant: 'secondary' })}>Cancel</Link>
                </div>
            </form>
        </div>
    );
}
