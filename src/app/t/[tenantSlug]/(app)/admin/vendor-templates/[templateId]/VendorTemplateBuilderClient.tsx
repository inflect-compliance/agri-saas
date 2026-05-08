'use client';
/* TODO(swr-migration): this file has fetch-on-mount + setState
 * patterns flagged by react-hooks/set-state-in-effect. Each call site
 * carries an inline disable directive; collectively they should
 * migrate to useTenantSWR (Epic 69 shape) so the rule can lift. */

/**
 * Epic G-3 — Vendor questionnaire builder UI.
 *
 * Single client component. Sections and questions render as cards
 * with a drag-grip; native HTML5 drag-and-drop (matching
 * FrameworkBuilder, no new lib dep) reorders within or across
 * sections. State changes are local-optimistic; the explicit
 * "Save order" button calls `POST /reorder`.
 *
 * Add-section / add-question forms call the per-resource POST
 * routes which are gated by the publish-guard at the usecase
 * layer; if the template is published the builder shows a
 * "clone first" banner and disables the forms.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
    useTenantApiUrl,
    useTenantHref,
    useTenantContext,
} from '@/lib/tenant-context-provider';
import { Button } from '@/components/ui/button';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { SkeletonDetailPage } from '@/components/ui/skeleton';

interface Question {
    id: string;
    sectionId: string;
    sortOrder: number;
    prompt: string;
    answerType:
        | 'YES_NO'
        | 'SINGLE_SELECT'
        | 'MULTI_SELECT'
        | 'TEXT'
        | 'NUMBER'
        | 'SCALE'
        | 'FILE_UPLOAD';
    required: boolean;
    weight: number;
}
interface Section {
    id: string;
    sortOrder: number;
    title: string;
    description: string | null;
    questions: Question[];
}
interface TemplateTree {
    id: string;
    key: string;
    version: number;
    name: string;
    description: string | null;
    isPublished: boolean;
    sections: Array<{
        id: string;
        sortOrder: number;
        title: string;
        description: string | null;
    }>;
    questions: Array<Omit<Question, 'sectionId'> & { sectionId: string }>;
}

const ANSWER_TYPES: Question['answerType'][] = [
    'YES_NO',
    'SINGLE_SELECT',
    'MULTI_SELECT',
    'TEXT',
    'NUMBER',
    'SCALE',
    'FILE_UPLOAD',
];
const ANSWER_TYPE_OPTIONS: ComboboxOption[] = ANSWER_TYPES.map((t) => ({
    value: t,
    label: t,
}));

export function VendorTemplateBuilderClient({
    templateId,
}: {
    templateId: string;
}) {
    const apiUrl = useTenantApiUrl();
    const tenantHref = useTenantHref();
    const router = useRouter();
    const { permissions } = useTenantContext();

    const [tree, setTree] = useState<TemplateTree | null>(null);
    const [sections, setSections] = useState<Section[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [dirty, setDirty] = useState(false);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(
                apiUrl(`/vendor-assessment-templates/${templateId}`),
            );
            if (!res.ok) {
                setError(`Failed to load template (${res.status})`);
                return;
            }
            const t = (await res.json()) as TemplateTree;
            setTree(t);
            // Build section[] with embedded questions for the
            // editor's local model.
            const grouped: Section[] = t.sections.map((s) => ({
                id: s.id,
                sortOrder: s.sortOrder,
                title: s.title,
                description: s.description,
                questions: t.questions
                    .filter((q) => q.sectionId === s.id)
                    .sort((a, b) => a.sortOrder - b.sortOrder)
                    .map((q) => ({
                        id: q.id,
                        sectionId: q.sectionId,
                        sortOrder: q.sortOrder,
                        prompt: q.prompt,
                        answerType: q.answerType,
                        required: q.required,
                        weight: q.weight,
                    })),
            }));
            setSections(grouped);
            setDirty(false);
        } finally {
            setLoading(false);
        }
    }, [apiUrl, templateId]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        refresh();
    }, [refresh]);

    const editable = useMemo(
        () => permissions.canWrite && tree && !tree.isPublished,
        [permissions.canWrite, tree],
    );

    // ─── Reorder via native HTML5 DnD ───
    const [dragging, setDragging] = useState<{
        kind: 'section' | 'question';
        sectionId: string;
        questionId?: string;
    } | null>(null);

    function handleSectionDrop(targetSectionId: string) {
        if (!dragging) return;
        if (dragging.kind === 'section' && dragging.sectionId !== targetSectionId) {
            setSections((prev) => {
                const fromIdx = prev.findIndex((s) => s.id === dragging.sectionId);
                const toIdx = prev.findIndex((s) => s.id === targetSectionId);
                if (fromIdx < 0 || toIdx < 0) return prev;
                const next = [...prev];
                const [moved] = next.splice(fromIdx, 1);
                next.splice(toIdx, 0, moved);
                return next.map((s, i) => ({ ...s, sortOrder: i }));
            });
            setDirty(true);
        }
        setDragging(null);
    }

    function handleQuestionDrop(
        targetSectionId: string,
        targetQuestionId: string | null,
    ) {
        if (!dragging || dragging.kind !== 'question') {
            setDragging(null);
            return;
        }
        const fromSectionId = dragging.sectionId;
        const movedQuestionId = dragging.questionId!;
        setSections((prev) => {
            const next = prev.map((s) => ({
                ...s,
                questions: [...s.questions],
            }));
            const fromSec = next.find((s) => s.id === fromSectionId);
            const toSec = next.find((s) => s.id === targetSectionId);
            if (!fromSec || !toSec) return prev;
            const fromIdx = fromSec.questions.findIndex(
                (q) => q.id === movedQuestionId,
            );
            if (fromIdx < 0) return prev;
            const [moved] = fromSec.questions.splice(fromIdx, 1);
            moved.sectionId = targetSectionId;
            const toIdx =
                targetQuestionId === null
                    ? toSec.questions.length
                    : toSec.questions.findIndex(
                          (q) => q.id === targetQuestionId,
                      );
            toSec.questions.splice(toIdx >= 0 ? toIdx : 0, 0, moved);
            // Rewrite sortOrder.
            for (const s of next) {
                s.questions.forEach((q, i) => (q.sortOrder = i));
            }
            return next;
        });
        setDirty(true);
        setDragging(null);
    }

    async function saveOrder() {
        if (!editable || !dirty) return;
        setSaving(true);
        setError(null);
        try {
            const body = {
                sections: sections.map((s) => ({
                    id: s.id,
                    sortOrder: s.sortOrder,
                    questions: s.questions.map((q) => ({
                        id: q.id,
                        sectionId: q.sectionId,
                        sortOrder: q.sortOrder,
                    })),
                })),
            };
            const res = await fetch(
                apiUrl(`/vendor-assessment-templates/${templateId}/reorder`),
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                },
            );
            if (!res.ok) {
                const b = await res.json().catch(() => ({}));
                setError(b.error ?? `Save failed (${res.status})`);
                return;
            }
            setDirty(false);
            await refresh();
        } finally {
            setSaving(false);
        }
    }

    async function addSection(title: string) {
        if (!editable) return;
        const res = await fetch(
            apiUrl(`/vendor-assessment-templates/${templateId}/sections`),
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title }),
            },
        );
        if (res.ok) await refresh();
        else setError(`Add section failed (${res.status})`);
    }

    async function addQuestionToSection(
        sectionId: string,
        prompt: string,
        answerType: Question['answerType'],
        required: boolean,
        weight: number,
    ) {
        if (!editable) return;
        const res = await fetch(
            apiUrl(
                `/vendor-assessment-templates/${templateId}/sections/${sectionId}/questions`,
            ),
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt,
                    answerType,
                    required,
                    weight,
                }),
            },
        );
        if (res.ok) await refresh();
        else {
            const b = await res.json().catch(() => ({}));
            setError(b.error ?? `Add question failed (${res.status})`);
        }
    }

    async function clonePublished() {
        if (!tree) return;
        const res = await fetch(
            apiUrl(`/vendor-assessment-templates/${templateId}/clone`),
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: 'SAME_KEY_NEW_VERSION' }),
            },
        );
        if (res.ok) {
            const cloned = (await res.json()) as { id: string };
            router.push(tenantHref(`/admin/vendor-templates/${cloned.id}`));
        } else {
            setError(`Clone failed (${res.status})`);
        }
    }

    if (loading) return <SkeletonDetailPage />;
    if (!tree)
        return (
            <div className="p-12 text-center text-content-error">
                {error ?? 'Template not found.'}
            </div>
        );

    return (
        <div
            className="space-y-6 animate-fadeIn"
            data-testid="vendor-template-builder"
        >
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <Link
                        href={tenantHref('/admin/vendor-templates')}
                        className="text-content-muted text-xs hover:text-content-emphasis transition"
                    >
                        ← All templates
                    </Link>
                    <h1 className="text-2xl font-bold mt-1">{tree.name}</h1>
                    <div className="flex items-center gap-2 mt-1 text-xs text-content-subtle">
                        <span>{tree.key}</span>
                        <span>·</span>
                        <span>v{tree.version}</span>
                        <span>·</span>
                        <span
                            className={`badge badge-xs ${tree.isPublished ? 'badge-success' : 'badge-warning'}`}
                        >
                            {tree.isPublished ? 'Published' : 'Draft'}
                        </span>
                    </div>
                </div>
                {dirty && editable && (
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={saveOrder}
                        disabled={saving}
                        loading={saving}
                        id="save-order-btn"
                    >
                        {saving ? 'Saving…' : 'Save order'}
                    </Button>
                )}
            </div>

            {tree.isPublished && (
                <div
                    className="glass-card p-4 border border-border-warning"
                    role="alert"
                    data-testid="published-banner"
                >
                    <p className="text-sm text-content-emphasis">
                        This template is published.
                    </p>
                    <p className="text-xs text-content-muted mt-1">
                        Edits to a published template would invalidate any
                        live assessments pinned to its version. Clone it to a
                        new draft revision to continue editing.
                    </p>
                    {permissions.canWrite && (
                        <Button
                            variant="primary"
                            size="sm"
                            className="mt-3"
                            onClick={clonePublished}
                            id="clone-template-btn"
                        >
                            Clone to new draft
                        </Button>
                    )}
                </div>
            )}

            {error && (
                <p
                    className="text-xs text-content-error"
                    role="alert"
                    data-testid="builder-error"
                >
                    {error}
                </p>
            )}

            {/* Sections */}
            <div className="space-y-4">
                {sections.map((s) => (
                    <SectionCard
                        key={s.id}
                        section={s}
                        editable={!!editable}
                        onDragStart={() =>
                            setDragging({
                                kind: 'section',
                                sectionId: s.id,
                            })
                        }
                        onDrop={() => handleSectionDrop(s.id)}
                        onQuestionDragStart={(qid) =>
                            setDragging({
                                kind: 'question',
                                sectionId: s.id,
                                questionId: qid,
                            })
                        }
                        onQuestionDrop={(targetQid) =>
                            handleQuestionDrop(s.id, targetQid)
                        }
                        onAddQuestion={(prompt, type, required, weight) =>
                            addQuestionToSection(
                                s.id,
                                prompt,
                                type,
                                required,
                                weight,
                            )
                        }
                    />
                ))}
            </div>

            {editable && <AddSectionForm onSubmit={(t) => addSection(t)} />}
        </div>
    );
}

// ─── Section card ──────────────────────────────────────────────────

function SectionCard({
    section,
    editable,
    onDragStart,
    onDrop,
    onQuestionDragStart,
    onQuestionDrop,
    onAddQuestion,
}: {
    section: Section;
    editable: boolean;
    onDragStart: () => void;
    onDrop: () => void;
    onQuestionDragStart: (questionId: string) => void;
    onQuestionDrop: (targetQuestionId: string | null) => void;
    onAddQuestion: (
        prompt: string,
        answerType: Question['answerType'],
        required: boolean,
        weight: number,
    ) => Promise<void>;
}) {
    return (
        <div
            className="glass-card p-4"
            draggable={editable}
            onDragStart={onDragStart}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            data-testid={`section-${section.id}`}
        >
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    {editable && (
                        <span
                            className="text-content-subtle cursor-grab"
                            aria-label="Drag to reorder section"
                        >
                            ⋮⋮
                        </span>
                    )}
                    <h3 className="text-base font-semibold">
                        {section.title}
                    </h3>
                </div>
                {section.description && (
                    <p className="text-xs text-content-subtle ml-2">
                        {section.description}
                    </p>
                )}
            </div>

            <div className="space-y-2 mb-3">
                {section.questions.map((q) => (
                    <div
                        key={q.id}
                        className="flex items-center gap-3 px-2 py-1.5 rounded hover:bg-bg-default/30"
                        draggable={editable}
                        onDragStart={(e) => {
                            e.stopPropagation();
                            onQuestionDragStart(q.id);
                        }}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                            e.stopPropagation();
                            onQuestionDrop(q.id);
                        }}
                        data-testid={`question-${q.id}`}
                    >
                        {editable && (
                            <span className="text-content-subtle text-xs cursor-grab">
                                ⋮⋮
                            </span>
                        )}
                        <span className="flex-1 text-sm">{q.prompt}</span>
                        <span className="badge badge-xs badge-info">
                            {q.answerType}
                        </span>
                        {q.required && (
                            <span className="badge badge-xs badge-warning">
                                required
                            </span>
                        )}
                        <span className="text-xs text-content-subtle">
                            w={q.weight}
                        </span>
                    </div>
                ))}
                {section.questions.length === 0 && (
                    <div
                        className="text-xs text-content-subtle italic px-2 py-3 border border-dashed border-border-default/40 rounded"
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => onQuestionDrop(null)}
                    >
                        No questions yet — drag here or add one below.
                    </div>
                )}
            </div>

            {editable && <AddQuestionForm onSubmit={onAddQuestion} />}
        </div>
    );
}

// ─── Forms ─────────────────────────────────────────────────────────

function AddSectionForm({ onSubmit }: { onSubmit: (title: string) => void }) {
    const [title, setTitle] = useState('');
    return (
        <form
            className="glass-card p-3 flex items-center gap-2"
            onSubmit={(e) => {
                e.preventDefault();
                if (title.trim()) {
                    onSubmit(title.trim());
                    setTitle('');
                }
            }}
            data-testid="add-section-form"
        >
            <input
                className="input flex-1"
                placeholder="New section title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                aria-label="New section title"
            />
            <Button
                variant="secondary"
                size="sm"
                type="submit"
                disabled={!title.trim()}
            >
                + Add section
            </Button>
        </form>
    );
}

function AddQuestionForm({
    onSubmit,
}: {
    onSubmit: (
        prompt: string,
        answerType: Question['answerType'],
        required: boolean,
        weight: number,
    ) => Promise<void>;
}) {
    const [prompt, setPrompt] = useState('');
    const [type, setType] = useState<Question['answerType']>('YES_NO');
    const [required, setRequired] = useState(true);
    const [weight, setWeight] = useState(1);
    const [busy, setBusy] = useState(false);

    return (
        <form
            className="border-t border-border-default/30 pt-3 grid grid-cols-1 md:grid-cols-12 gap-2 items-end"
            onSubmit={async (e) => {
                e.preventDefault();
                if (!prompt.trim()) return;
                setBusy(true);
                try {
                    await onSubmit(prompt.trim(), type, required, weight);
                    setPrompt('');
                    setType('YES_NO');
                    setRequired(true);
                    setWeight(1);
                } finally {
                    setBusy(false);
                }
            }}
            data-testid="add-question-form"
        >
            <div className="md:col-span-5">
                <label className="text-xs text-content-muted block mb-1">
                    Prompt
                </label>
                <input
                    className="input w-full"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Do you encrypt data at rest?"
                />
            </div>
            <div className="md:col-span-3">
                <label className="text-xs text-content-muted block mb-1">
                    Type
                </label>
                <Combobox
                    hideSearch
                    selected={
                        ANSWER_TYPE_OPTIONS.find((o) => o.value === type) ??
                        null
                    }
                    setSelected={(opt) => {
                        if (opt) setType(opt.value as Question['answerType']);
                    }}
                    options={ANSWER_TYPE_OPTIONS}
                    matchTriggerWidth
                />
            </div>
            <div className="md:col-span-1">
                <label className="text-xs text-content-muted block mb-1">
                    Weight
                </label>
                <input
                    className="input w-full"
                    type="text"
                    inputMode="decimal"
                    pattern="[0-9]*\.?[0-9]*"
                    value={weight}
                    onChange={(e) => {
                        const n = Number(e.target.value);
                        setWeight(Number.isFinite(n) ? n : 1);
                    }}
                />
            </div>
            <div className="md:col-span-1 flex items-center pb-2">
                <label className="inline-flex items-center text-xs">
                    <input
                        type="checkbox"
                        checked={required}
                        onChange={(e) => setRequired(e.target.checked)}
                        className="mr-1"
                    />
                    Required
                </label>
            </div>
            <div className="md:col-span-2">
                <Button
                    variant="primary"
                    size="sm"
                    className="w-full"
                    type="submit"
                    disabled={busy || !prompt.trim()}
                    loading={busy}
                >
                    {busy ? 'Adding…' : '+ Add question'}
                </Button>
            </div>
        </form>
    );
}
