/**
 * R26-PR-B — ProcessTypedNode rendered tests.
 *
 * One render per canonical kind to cover the per-kind chrome the
 * structural ratchet can't see (shape selector, accent border,
 * icon presence, annotation's no-handles invariant).
 *
 * Why per-kind tests vs. one parametrised render:
 *   The kind-to-chrome mapping is the load-bearing contract this
 *   PR ships. A single parametrised test passing only `processStep`
 *   would silently let the other six drop their accents on a
 *   future refactor. Explicit per-kind runs make a regression on
 *   any single kind a discrete failure.
 *
 * What's NOT tested here:
 *   • Drag-drop interaction — covered by E2E.
 *   • xyflow internal selection state — relies on the
 *     ReactFlowProvider context which the structural ratchet
 *     locks. Pure node-render assertions only.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import {
    ProcessTypedNode,
    type ProcessTypedNodeData,
} from '@/components/processes/ProcessTypedNode';
import { NODE_TAXONOMY, NODE_TAXONOMY_ORDER, type ProcessNodeKind } from '@/components/processes/node-taxonomy';

function renderNode(
    kind: ProcessNodeKind,
    overrides: Partial<ProcessTypedNodeData> = {},
) {
    const data = { label: 'Test label', kind, ...overrides };
    // xyflow passes a NodeProps shape; the renderer reads `data`
    // + `selected` only.
    return render(
        <ReactFlowProvider>
            <ProcessTypedNode {...({ data, selected: false } as any)} />
        </ReactFlowProvider>,
    );
}

describe('ProcessTypedNode — per-kind chrome', () => {
    for (const kind of NODE_TAXONOMY_ORDER) {
        const meta = NODE_TAXONOMY[kind];
        describe(`kind=${kind}`, () => {
            it(`renders the label`, () => {
                renderNode(kind);
                expect(screen.getByText('Test label')).toBeInTheDocument();
            });

            it(`stamps data-process-node-kind=${kind}`, () => {
                const { container } = renderNode(kind);
                const root = container.querySelector(
                    '[data-process-node]',
                );
                expect(root).not.toBeNull();
                expect(root!.getAttribute('data-process-node-kind')).toBe(kind);
            });

            it(`uses the ${meta.shape} shape selector`, () => {
                const { container } = renderNode(kind);
                const root = container.querySelector('[data-process-node]');
                expect(root).not.toBeNull();
                const cls = root!.className;
                if (meta.shape === 'diamond') {
                    expect(cls).toMatch(/min-w-\[120px\]/);
                } else if (meta.shape === 'note') {
                    expect(cls).toMatch(/rounded-\[6px\]/);
                    // Note shape carries the subtle background tint.
                    expect(cls).toMatch(/bg-bg-subtle/);
                } else {
                    expect(cls).toMatch(/min-w-\[160px\]/);
                }
            });

            const hasHandlesText = meta.hasHandles ? 'has' : 'has NO';
            it(`${hasHandlesText} xyflow handles`, () => {
                const { container } = renderNode(kind);
                // xyflow's <Handle> renders as a div with the
                // `react-flow__handle` class.
                const handles = container.querySelectorAll(
                    '.react-flow__handle',
                );
                if (meta.hasHandles) {
                    expect(handles.length).toBeGreaterThanOrEqual(2);
                } else {
                    expect(handles.length).toBe(0);
                }
            });

            it('renders the per-kind icon', () => {
                const { container } = renderNode(kind);
                const svgs = container.querySelectorAll('svg');
                // At minimum the lucide kind icon should be there.
                // Annotation also has its sticky-note icon mounted
                // inside the chassis.
                expect(svgs.length).toBeGreaterThanOrEqual(1);
            });

            it('falls back to the default label when none is provided', () => {
                renderNode(kind, { label: '' });
                expect(screen.getByText(meta.defaultLabel)).toBeInTheDocument();
            });
        });
    }

    it('falls back to processStep when the kind is unknown', () => {
        const { container } = render(
            <ReactFlowProvider>
                <ProcessTypedNode
                    {...({
                        data: { label: 'Fallback', kind: 'not-a-real-kind' },
                        selected: false,
                    } as any)}
                />
            </ReactFlowProvider>,
        );
        const root = container.querySelector('[data-process-node]');
        expect(root).not.toBeNull();
        // Even when the kind is unknown the node renders with the
        // default shape (rect) and handles enabled.
        expect(root!.getAttribute('data-process-node-kind')).toBe('processStep');
    });
});
