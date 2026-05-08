/** @type {import('tailwindcss').Config} */
module.exports = {
    content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
    theme: {
        extend: {
            colors: {
                // ── Existing brand palette (unchanged) ──
                brand: {
                    50: '#eef2ff',
                    100: '#e0e7ff',
                    200: '#c7d2fe',
                    300: '#a5b4fc',
                    400: '#818cf8',
                    500: '#6366f1',
                    600: '#4f46e5',
                    700: '#4338ca',
                    800: '#3730a3',
                    900: '#312e81',
                    950: '#1e1b4b',
                },

                // ── Semantic surface tokens ──
                bg: {
                    default: 'var(--bg-default)',
                    muted: 'var(--bg-muted)',
                    subtle: 'var(--bg-subtle)',
                    elevated: 'var(--bg-elevated)',
                    page: 'var(--bg-page)',
                    inverted: 'var(--bg-inverted)',
                    overlay: 'var(--bg-overlay)',
                    success: 'var(--bg-success)',
                    'success-emphasis': 'var(--bg-success-emphasis)',
                    warning: 'var(--bg-warning)',
                    'warning-emphasis': 'var(--bg-warning-emphasis)',
                    error: 'var(--bg-error)',
                    'error-emphasis': 'var(--bg-error-emphasis)',
                    info: 'var(--bg-info)',
                    'info-emphasis': 'var(--bg-info-emphasis)',
                    attention: 'var(--bg-attention)',
                },

                // ── Semantic content/text tokens ──
                content: {
                    emphasis: 'var(--content-emphasis)',
                    default: 'var(--content-default)',
                    muted: 'var(--content-muted)',
                    subtle: 'var(--content-subtle)',
                    inverted: 'var(--content-inverted)',
                    success: 'var(--content-success)',
                    warning: 'var(--content-warning)',
                    error: 'var(--content-error)',
                    info: 'var(--content-info)',
                    attention: 'var(--content-attention)',
                },

                // ── Semantic border tokens ──
                border: {
                    default: 'var(--border-default)',
                    subtle: 'var(--border-subtle)',
                    emphasis: 'var(--border-emphasis)',
                    success: 'var(--border-success)',
                    warning: 'var(--border-warning)',
                    error: 'var(--border-error)',
                    info: 'var(--border-info)',
                },

                // ── Inverted surface (used directly as bg-inverted) ──
                inverted: 'var(--bg-inverted)',

                // ── shadcn / Radix compatibility ──
                primary: 'var(--primary)',
                ring: 'var(--ring)',
                background: 'var(--ring-offset-background)',
            },

            ringOffsetColor: {
                background: 'var(--ring-offset-background)',
            },

            borderRadius: {
                sm: 'var(--radius-sm)',
                DEFAULT: 'var(--radius)',
                lg: 'var(--radius-lg)',
                xl: 'var(--radius-xl)',
            },

            boxShadow: {
                sm: 'var(--shadow-sm)',
                DEFAULT: 'var(--shadow)',
                lg: 'var(--shadow-lg)',
            },

            // ── Animations required by Dub-ported components ──
            keyframes: {
                'slide-up-fade': {
                    '0%': { opacity: '0', transform: 'translateY(6px)' },
                    '100%': { opacity: '1', transform: 'translateY(0)' },
                },
                'slide-down-fade': {
                    '0%': { opacity: '0', transform: 'translateY(-6px)' },
                    '100%': { opacity: '1', transform: 'translateY(0)' },
                },
                'scale-in': {
                    '0%': { opacity: '0', transform: 'scale(0.95)' },
                    '100%': { opacity: '1', transform: 'scale(1)' },
                },
                'fade-in': {
                    '0%': { opacity: '0' },
                    '100%': { opacity: '1' },
                },
                'table-pinned-shadow': {
                    '0%': { filter: 'drop-shadow(rgba(0, 0, 0, 0.1) -2px 10px 6px)' },
                    '100%': { filter: 'drop-shadow(rgba(0, 0, 0, 0) -2px 10px 6px)' },
                },
                // Epic 64 — shimmer wave for ShimmerDots. Each dot in
                // the grid stamps an `animation-delay` derived from its
                // (row, col) coordinates so a diagonal wave reads
                // across the surface. Deliberately gentle (opacity
                // 0.25 → 1 → 0.25) to feel polished rather than noisy.
                'shimmer-pulse': {
                    '0%, 100%': { opacity: '0.25' },
                    '50%': { opacity: '1' },
                },
            },
            animation: {
                'slide-up-fade': 'slide-up-fade 0.2s ease-out',
                'slide-down-fade': 'slide-down-fade 0.2s ease-out',
                'scale-in': 'scale-in 0.15s ease-out',
                'fade-in': 'fade-in 0.15s ease-out',
                'table-pinned-shadow': 'table-pinned-shadow cubic-bezier(0, 0, 1, 0)',
                'shimmer-pulse': 'shimmer-pulse 1.6s ease-in-out infinite',
            },
        },
    },
    plugins: [
        function ({ addUtilities }) {
            addUtilities({
                '.scrollbar-hide': {
                    '-ms-overflow-style': 'none',
                    'scrollbar-width': 'none',
                    '&::-webkit-scrollbar': { display: 'none' },
                },
            });
        },
    ],
};
