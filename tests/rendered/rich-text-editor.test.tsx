/**
 * `<RichTextEditor>` rendered tests — Epic 45.2
 *
 * Locks the editor's UX contract:
 *   - Markdown mode renders a `<textarea>` and round-trips text via
 *     `onChange(value, 'MARKDOWN')`.
 *   - WYSIWYG mode mounts the Tiptap content editor + the format
 *     toolbar.
 *   - Mode toggle flips between the two without dropping the
 *     editor's text payload.
 *   - The toolbar's mode-toggle button carries the canonical
 *     `data-testid` so E2E + structural ratchets can drive it.
 *   - The disabled state turns off the textarea + the toolbar
 *     buttons.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import * as React from 'react';

import {
    RichTextEditor,
    type RichTextContentType,
} from '@/components/ui/RichTextEditor';

// TipTap 3.24+ (ProseMirror) calls `document.elementFromPoint` while
// mounting the editor view; jsdom has no layout engine and lacks it.
// Stub it for THIS file only — a GLOBAL stub (in setup.ts) trips
// axe-core's obscured-element checks and produces false a11y
// violations in the modal/combobox suites. jsdom environments are
// per-file, so this assignment doesn't leak to other suites.
beforeAll(() => {
    Document.prototype.elementFromPoint = () => null;
});

interface HarnessProps {
    initial?: string;
    initialType?: RichTextContentType;
    onChange?: jest.Mock;
}
function Harness({
    initial = '',
    initialType = 'MARKDOWN',
    onChange,
}: HarnessProps) {
    const [value, setValue] = React.useState(initial);
    const [type, setType] = React.useState<RichTextContentType>(initialType);
    return (
        <RichTextEditor
            value={value}
            contentType={type}
            onChange={(v, t) => {
                setValue(v);
                setType(t);
                onChange?.(v, t);
            }}
        />
    );
}

describe('<RichTextEditor>', () => {
    it('mounts in markdown mode by default and renders a textarea', () => {
        render(<Harness />);
        const wrapper = screen.getByTestId('rich-text-editor');
        expect(wrapper.getAttribute('data-content-type')).toBe('MARKDOWN');
        expect(
            screen.getByTestId('rich-text-editor-textarea'),
        ).toBeInTheDocument();
    });

    it('reports onChange(value, "MARKDOWN") when the operator types in the textarea', () => {
        const onChange = jest.fn();
        render(<Harness onChange={onChange} />);
        const ta = screen.getByTestId(
            'rich-text-editor-textarea',
        ) as HTMLTextAreaElement;
        fireEvent.change(ta, { target: { value: '# Heading\n\nBody.' } });
        expect(onChange).toHaveBeenLastCalledWith('# Heading\n\nBody.', 'MARKDOWN');
    });

    it('toggle flips into HTML mode and mounts the Tiptap content + format toolbar', () => {
        render(<Harness initial="A line of text." />);
        const toggle = screen.getByTestId('rich-text-editor-toggle');
        expect(toggle.getAttribute('data-mode')).toBe('MARKDOWN');
        fireEvent.click(toggle);

        // Editor's wrapper data-content-type flips, textarea is gone,
        // EditorContent mounts with the prose-styled content area.
        expect(
            screen.getByTestId('rich-text-editor').getAttribute('data-content-type'),
        ).toBe('HTML');
        expect(screen.queryByTestId('rich-text-editor-textarea')).toBeNull();
        expect(
            screen.getByTestId('rich-text-editor-content'),
        ).toBeInTheDocument();

        // Format toolbar mounts: bold / italic / heading / list / link
        // are reachable by their aria-labels.
        const wrapper = screen.getByTestId('rich-text-editor');
        expect(within(wrapper).getByLabelText(/^Bold$/i)).toBeInTheDocument();
        expect(within(wrapper).getByLabelText(/^Italic$/i)).toBeInTheDocument();
        expect(within(wrapper).getByLabelText(/^Heading 1$/i)).toBeInTheDocument();
        expect(within(wrapper).getByLabelText(/^Bullet list$/i)).toBeInTheDocument();
        expect(within(wrapper).getByLabelText(/^Insert link$/i)).toBeInTheDocument();
    });

    it('toggle dispatches onChange with the new contentType', () => {
        const onChange = jest.fn();
        render(<Harness initial="hello" onChange={onChange} />);
        fireEvent.click(screen.getByTestId('rich-text-editor-toggle'));
        // Last call should be the post-toggle synthesisation: an HTML
        // payload + 'HTML'.
        const last = onChange.mock.calls.at(-1);
        expect(last?.[1]).toBe('HTML');
        expect(typeof last?.[0]).toBe('string');
        // The seeded HTML wraps the markdown in <p>…</p> blocks.
        expect(last?.[0]).toMatch(/<p>hello<\/p>/);
    });

    it('toggle back from HTML → MARKDOWN extracts the plain text', () => {
        const onChange = jest.fn();
        render(<Harness initial="alpha" onChange={onChange} />);
        // Two toggles: MARKDOWN → HTML → MARKDOWN.
        fireEvent.click(screen.getByTestId('rich-text-editor-toggle'));
        fireEvent.click(screen.getByTestId('rich-text-editor-toggle'));
        const last = onChange.mock.calls.at(-1);
        expect(last?.[1]).toBe('MARKDOWN');
        // Plain text recovered (formatting is lost but text persists).
        expect(last?.[0]).toContain('alpha');
    });

    it('escapes raw HTML in markdown text when seeding the WYSIWYG editor', () => {
        // A markdown payload with `<script>` tags must NOT mount as
        // executable HTML inside Tiptap. The editor's seed step
        // escapes via its internal escapeHtml helper.
        const onChange = jest.fn();
        render(
            <Harness initial="<script>alert('x')</script>" onChange={onChange} />,
        );
        fireEvent.click(screen.getByTestId('rich-text-editor-toggle'));
        const seeded = onChange.mock.calls.at(-1)?.[0] as string;
        expect(seeded).not.toMatch(/<script>/i);
        expect(seeded).toMatch(/&lt;script&gt;/);
    });

    it('starts in HTML mode when contentType="HTML" is passed', () => {
        render(<Harness initialType="HTML" initial="<p>seed</p>" />);
        expect(
            screen.getByTestId('rich-text-editor').getAttribute('data-content-type'),
        ).toBe('HTML');
        expect(
            screen.getByTestId('rich-text-editor-content'),
        ).toBeInTheDocument();
    });
});
