'use client';

/**
 * Epic 51 — theme toggle button.
 *
 * Cycles dark → light → sunlight → dark. "sunlight" is the high-contrast
 * outdoor palette for bright field light. The icon shows the theme you'll get
 * NEXT (the long-standing "show what you'll switch to" affordance), and the
 * accessible label names both the current theme and the next.
 */

import { Moon, Sun, SunMedium } from 'lucide-react';
import { Tooltip } from '@/components/ui/tooltip';
import { useTheme, type Theme } from './ThemeProvider';

export interface ThemeToggleProps {
    className?: string;
    /** Optional id for test/automation hooks. */
    id?: string;
}

const NEXT_THEME: Record<Theme, Theme> = {
    dark: 'light',
    light: 'sunlight',
    sunlight: 'dark',
};

const THEME_NAME: Record<Theme, string> = {
    dark: 'dark',
    light: 'light',
    sunlight: 'sunlight',
};

// The icon represents the NEXT theme (what a click switches to).
const NEXT_ICON: Record<Theme, typeof Sun> = {
    dark: Sun, // dark → light
    light: SunMedium, // light → sunlight
    sunlight: Moon, // sunlight → dark
};

export function ThemeToggle({ className, id = 'theme-toggle' }: ThemeToggleProps) {
    const { theme, toggle } = useTheme();
    const next = NEXT_THEME[theme];
    const label = `${THEME_NAME[theme]} theme — switch to ${THEME_NAME[next]}`;
    const Icon = NEXT_ICON[theme];

    return (
        <Tooltip content={label}>
            <button
                type="button"
                onClick={toggle}
                aria-label={label}
                id={id}
                data-testid="theme-toggle"
                data-theme-current={theme}
                className={`icon-btn icon-btn-sm ${className ?? ''}`.trim()}
            >
                <Icon className="size-4" aria-hidden="true" />
            </button>
        </Tooltip>
    );
}
