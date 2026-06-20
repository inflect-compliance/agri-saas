'use client';

import { useMemo } from 'react';
import QRCode from 'qrcode-generator';

/**
 * QrCode — renders a value (typically a deep-link URL) as a scannable QR code
 * (feat/delight-shareables). Pure client SVG built from the module matrix —
 * no canvas, no image format, no network. Always black-on-white regardless of
 * theme: a QR must stay high-contrast to scan, so the colours are intentional
 * literals, not design tokens.
 *
 * `qrcode-generator` is a zero-dependency MIT library; the matrix is computed
 * once per value and drawn as one `<rect>` run per row (kept light).
 */

interface QrCodeProps {
    /** The text/URL to encode. */
    value: string;
    /** Rendered pixel size of the square. */
    size?: number;
    className?: string;
    /** Accessible label (defaults to "QR code"). */
    title?: string;
}

export function QrCode({ value, size = 128, className, title = 'QR code' }: QrCodeProps) {
    const { count, runs } = useMemo(() => {
        const qr = QRCode(0, 'M'); // auto type, medium error-correction
        qr.addData(value);
        qr.make();
        const n = qr.getModuleCount();
        // Coalesce consecutive dark modules in each row into a single rect to
        // keep the SVG node count low.
        const rects: { x: number; y: number; w: number }[] = [];
        for (let row = 0; row < n; row++) {
            let start = -1;
            for (let col = 0; col < n; col++) {
                const dark = qr.isDark(row, col);
                if (dark && start === -1) start = col;
                if ((!dark || col === n - 1) && start !== -1) {
                    const end = dark ? col : col - 1;
                    rects.push({ x: start, y: row, w: end - start + 1 });
                    start = -1;
                }
            }
        }
        return { count: n, runs: rects };
    }, [value]);

    return (
        <svg
            viewBox={`0 0 ${count} ${count}`}
            width={size}
            height={size}
            role="img"
            aria-label={title}
            shapeRendering="crispEdges"
            className={className}
        >
            <rect width={count} height={count} fill="#ffffff" />
            {runs.map((r, i) => (
                <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill="#000000" />
            ))}
        </svg>
    );
}

export default QrCode;
