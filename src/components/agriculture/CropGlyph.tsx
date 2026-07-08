import type { SVGProps, ReactNode } from 'react';
import { CROP_VALUES } from '@/lib/agriculture/crop-options';

/**
 * Tiny inline-SVG crop glyphs for the Location map overlay + legend (#1).
 *
 * Inline SVG (not lucide) is deliberate: MapCanvas is outside the no-lucide
 * allowlist and the Nucleo set has no crop glyphs, so a lucide/Nucleo import
 * isn't viable. Glyphs are keyed by the CROP_OPTIONS `value` strings; an
 * unknown / free-text cropType falls back to a generic sprout so imported
 * parcels with an off-catalogue crop still get a marker.
 *
 * Every glyph inherits `currentColor` + sizing from the caller (className).
 */
type GlyphProps = SVGProps<SVGSVGElement> & { crop: string | null | undefined };

function Svg({ children, ...props }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            {...props}
        >
            {children}
        </svg>
    );
}

/** Whether a (free-text) cropType maps to a known catalogue glyph. */
export function isKnownCrop(crop: string | null | undefined): boolean {
    return !!crop && CROP_VALUES.has(crop);
}

export function CropGlyph({ crop, ...props }: GlyphProps) {
    switch (crop) {
        case 'Wheat':
            // Wheat head — stem + three paired grains.
            return (
                <Svg {...props}>
                    <path d="M12 21V10" />
                    <path d="M12 10l3-2M12 10l-3-2M12 14l3-2M12 14l-3-2M12 18l3-2M12 18l-3-2" />
                </Svg>
            );
        case 'Barley':
            // Barley — stem with long straight awns fanning upward.
            return (
                <Svg {...props}>
                    <path d="M12 21V11" />
                    <path d="M12 11l4-5M12 11l-4-5M12 11V4M12 15l3-3M12 15l-3-3" />
                </Svg>
            );
        case 'Maize':
            // Maize — an upright cob with a side leaf.
            return (
                <Svg {...props}>
                    <path d="M12 21c-2.5 0-4-2.2-4-6s1.5-8 4-8 4 4.2 4 8-1.5 6-4 6z" />
                    <path d="M8 12c-2 0-3.5-1-4.5-2.5" />
                </Svg>
            );
        case 'Sunflower':
            // Sunflower — centre disc + radiating petals + stem.
            return (
                <Svg {...props}>
                    <circle cx="12" cy="9" r="2.6" />
                    <path d="M12 3v2M12 13v2M6 9h2M16 9h2M8 5l1.4 1.4M14.6 11.6L16 13M16 5l-1.4 1.4M9.4 11.6L8 13" />
                    <path d="M12 15v6" />
                </Svg>
            );
        case 'Canola':
            // Canola — a four-blossom cluster on a stem.
            return (
                <Svg {...props}>
                    <circle cx="9" cy="7" r="1.6" />
                    <circle cx="15" cy="7" r="1.6" />
                    <circle cx="12" cy="10.5" r="1.6" />
                    <path d="M12 12v9" />
                </Svg>
            );
        case 'Peas':
            // Peas — a curved pod with three peas.
            return (
                <Svg {...props}>
                    <path d="M7 5c6 1 10 6 10 14" />
                    <circle cx="10.5" cy="9" r="1.1" fill="currentColor" stroke="none" />
                    <circle cx="12.5" cy="12.5" r="1.1" fill="currentColor" stroke="none" />
                    <circle cx="14" cy="16" r="1.1" fill="currentColor" stroke="none" />
                </Svg>
            );
        default:
            // Generic sprout — stem with two leaves (unknown / off-catalogue).
            return (
                <Svg {...props}>
                    <path d="M12 21v-9" />
                    <path d="M12 12c0-3 2-5 5-5 0 3-2 5-5 5z" />
                    <path d="M12 15c0-2.5-1.8-4.5-4.5-4.5 0 2.5 1.8 4.5 4.5 4.5z" />
                </Svg>
            );
    }
}
