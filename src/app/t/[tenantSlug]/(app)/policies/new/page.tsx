'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTenantApiUrl, useTenantHref, useTenantContext } from '@/lib/tenant-context-provider';
import { Button } from '@/components/ui/button';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useFormTelemetry } from '@/lib/telemetry/form-telemetry';
import { Heading } from '@/components/ui/typography';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@dub/utils';

const POLICY_CATEGORIES: ComboboxOption[] = [
    'Information Security',
    'Access Control',
    'HR',
    'Physical',
    'Compliance',
    'Operations',
    'Risk Management',
    'Business Continuity',
    'Supplier',
    'Other',
].map((c) => ({ value: c, label: c }));

export default function NewPolicyPage() {
    const apiUrl = useTenantApiUrl();
    const tenantHref = useTenantHref();
    const router = useRouter();
    const searchParams = useSearchParams();
    const tenant = useTenantContext();

    const isTemplateMode = searchParams?.get('template') === '1';

    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [category, setCategory] = useState('');
    const [content, setContent] = useState('');
    const [templateId, setTemplateId] = useState('');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [templates, setTemplates] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // Fetch templates if in template mode
    useEffect(() => {
        if (isTemplateMode) {
            fetch(apiUrl('/policies/templates'))
                .then(r => r.json())
                .then(setTemplates)
                .catch(() => { });
        }
    }, [isTemplateMode, apiUrl]);

    // When selecting a template, prefill title
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const selectTemplate = (tpl: any) => {
        setTemplateId(tpl.id);
        if (!title) setTitle(tpl.title);
        setCategory(tpl.category || '');
    };

    const telemetry = useFormTelemetry('NewPolicyPage');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!title.trim()) return;
        setLoading(true);
        setError('');
        telemetry.trackSubmit({
            fromTemplate: Boolean(isTemplateMode && templateId),
            hasCategory: Boolean(category),
            contentLength: content?.length ?? 0,
        });

        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const body: any = { title, description: description || null, category: category || null };
            if (isTemplateMode && templateId) {
                body.templateId = templateId;
            } else {
                body.content = content || null;
            }

            const res = await fetch(apiUrl('/policies'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                const msg = typeof data.error === 'string' ? data.error : data.message || JSON.stringify(data.error) || 'Failed to create policy';
                throw new Error(msg);
            }

            const policy = await res.json();
            telemetry.trackSuccess({ policyId: policy.id });
            router.push(tenantHref(`/policies/${policy.id}`));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (err: any) {
            telemetry.trackError(err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    if (!tenant.permissions.canWrite) {
        return (
            <div className={cn(cardVariants({ density: 'spacious' }), 'text-center text-content-subtle animate-fadeIn')}>
                <p className="text-lg mb-2">Permission Denied</p>
                <p className="text-sm">You do not have permission to create policies.</p>
            </div>
        );
    }

    return (
        <div className="max-w-3xl mx-auto space-y-section animate-fadeIn">
            <div>
                <Heading level={1}>
                    {isTemplateMode ? 'New Policy from Template' : 'New Policy'}
                </Heading>
                <p className="text-content-muted text-sm mt-1">
                    {isTemplateMode
                        ? 'Select a template to start with pre-written content.'
                        : 'Create a blank policy and add content later.'}
                </p>
            </div>

            {error && (
                <div
                    role="alert"
                    className="p-3 rounded-lg border border-border-error bg-bg-error text-content-error text-sm"
                    id="new-policy-error"
                >
                    {error}
                </div>
            )}

            {/* Template picker */}
            {isTemplateMode && (
                <div className={cn(cardVariants({ density: 'compact' }), 'space-y-compact')}>
                    <Heading level={3}>Choose a Template</Heading>
                    {templates.length === 0 ? (
                        <p className="text-sm text-content-subtle">No templates available.</p>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-tight max-h-60 overflow-y-auto">
                            {templates.map(tpl => (
                                <button
                                    key={tpl.id}
                                    type="button"
                                    onClick={() => selectTemplate(tpl)}
                                    className={`text-left p-3 rounded-lg border transition text-sm ${templateId === tpl.id
                                        ? 'border-[var(--brand-default)] bg-[var(--brand-subtle)] text-content-emphasis'
                                        : 'border-border-default bg-bg-default/50 text-content-default hover:bg-bg-muted/50'
                                        }`}
                                >
                                    <p className="font-medium">{tpl.title}</p>
                                    {tpl.category && <p className="text-xs text-content-subtle mt-0.5">{tpl.category}</p>}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Form */}
            <form onSubmit={handleSubmit} className={cn(cardVariants(), 'space-y-default')} noValidate>
                <FormField
                    label="Title"
                    required
                    error={
                        title.length > 0 && !title.trim()
                            ? 'Title cannot be empty.'
                            : undefined
                    }
                >
                    <Input
                        id="policy-title-input"
                        required
                        value={title}
                        onChange={e => setTitle(e.target.value)}
                        placeholder="e.g. Information Security Policy"
                    />
                </FormField>
                <FormField label="Description">
                    <Input
                        value={description}
                        onChange={e => setDescription(e.target.value)}
                        placeholder="Brief description of this policy"
                    />
                </FormField>
                <FormField label="Category">
                    <Combobox
                        id="policy-category-select"
                        name="category"
                        options={POLICY_CATEGORIES}
                        selected={POLICY_CATEGORIES.find(o => o.value === category) ?? null}
                        setSelected={(o) => setCategory(o?.value ?? '')}
                        placeholder="Select category…"
                        searchPlaceholder="Search categories…"
                        matchTriggerWidth
                        buttonProps={{ className: 'w-full' }}
                        caret
                    />
                </FormField>

                {/* Initial content for blank mode only */}
                {!isTemplateMode && (
                    <FormField label="Initial Content (Markdown)">
                        <Textarea
                            id="policy-content-input"
                            className="min-h-[200px] font-mono text-sm"
                            value={content}
                            onChange={e => setContent(e.target.value)}
                            placeholder="# Policy Content&#10;&#10;Write your policy here in Markdown..."
                        />
                    </FormField>
                )}

                <div className="flex gap-tight pt-2">
                    <Button type="submit" variant="primary" disabled={loading} id="create-policy-btn">
                        {loading ? 'Creating...' : '+ Policy'}
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => router.back()}>
                        Cancel
                    </Button>
                </div>
            </form>
        </div>
    );
}
