'use client';

/**
 * IconAction — the canonical icon-only page-level action button.
 *
 * The reduction (2026-06-07): in-scope blue/yellow (primary/secondary)
 * **page-level** action buttons drop their text and speak through form +
 * iconography alone. Meaning is preserved, not lost — every IconAction
 * carries:
 *
 *   - a strong, semantic icon (the only visible content),
 *   - the shared `<Tooltip>` (a quiet, ~1s-delayed hover/focus label —
 *     the provider's `delayDuration` default is 1000ms, so it never
 *     appears instantly or noisily), and
 *   - an `aria-label` mirroring the tooltip text, so screen readers and
 *     keyboard users get the same certainty as the pointer.
 *
 * One shared component carries the whole contract so the rollout can't
 * drift into scattered local `size="icon"` + hand-rolled tooltip hacks.
 * The `icon-only-action-discipline` ratchet locks the in-scope call sites
 * to this component.
 *
 * OUT OF SCOPE (use a plain `<Button>` instead): entity-create headers
 * (they keep their noun — `[+] Risk`), modal/dialog confirm buttons,
 * form submits, Cancel, and the entire Admin page.
 *
 *   <IconAction variant="secondary" icon={<Upload />} label="Import"
 *               onClick={…} />
 */
import * as React from 'react';
import { Tooltip } from '@/components/ui/tooltip';
import { Button, type ButtonProps } from '@/components/ui/button';

export interface IconActionProps
    extends Omit<
        ButtonProps,
        'children' | 'text' | 'size' | 'icon' | 'aria-label'
    > {
    /** The action's icon — the button's only visible content. */
    icon: React.ReactNode;
    /**
     * The action label. Shown in the shared ~1s-delayed tooltip AND set as
     * the button's `aria-label` (keyboard/screen-reader certainty after the
     * text is removed). Keep it a short verb phrase ("Import", "Freeze pack").
     */
    label: string;
}

export const IconAction = React.forwardRef<HTMLButtonElement, IconActionProps>(
    function IconAction({ icon, label, variant = 'secondary', ...rest }, ref) {
        return (
            <Tooltip content={label}>
                <Button
                    ref={ref}
                    {...rest}
                    variant={variant}
                    size="icon"
                    icon={icon}
                    aria-label={label}
                />
            </Tooltip>
        );
    },
);
