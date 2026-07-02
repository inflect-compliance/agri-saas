/**
 * PDFKit Document Factory
 *
 * Creates pre-configured PDFKit documents with consistent margins,
 * metadata, and brand colors.
 */
import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import path from 'node:path';
import type { ReportMeta } from './types';

// ─── Unicode (Cyrillic) fonts ───
//
// PDFKit's built-in Standard-14 'Helvetica' is AFM/latin-only and renders
// tofu for Cyrillic. DejaVu Sans (bundled under ./fonts, Bitstream Vera
// license) has full Cyrillic coverage. Loaded once + cached as Buffers.
const FONT_DIR = path.join(process.cwd(), 'src', 'lib', 'pdf', 'fonts');
let _unicodeFonts: { regular: Buffer; bold: Buffer } | null = null;

function loadUnicodeFonts(): { regular: Buffer; bold: Buffer } {
    if (!_unicodeFonts) {
        _unicodeFonts = {
            regular: fs.readFileSync(path.join(FONT_DIR, 'DejaVuSans.ttf')),
            bold: fs.readFileSync(path.join(FONT_DIR, 'DejaVuSans-Bold.ttf')),
        };
    }
    return _unicodeFonts;
}

// ─── Brand Tokens ───

export const BRAND = {
    navy:       '#0f172a',
    purple:     '#7c3aed',
    slate:      '#64748b',
    slateLight: '#94a3b8',
    white:      '#ffffff',
    lightGray:  '#f1f5f9',
    medGray:    '#e2e8f0',
    red:        '#ef4444',
    amber:      '#f59e0b',
    green:      '#22c55e',
} as const;

// ─── Margins ───

export const MARGINS = {
    top: 60,
    bottom: 50,
    left: 50,
    right: 50,
} as const;

export const PAGE_WIDTH = 595.28;    // A4 portrait width (pt)
export const PAGE_HEIGHT = 841.89;   // A4 portrait height (pt)
export const CONTENT_WIDTH = PAGE_WIDTH - MARGINS.left - MARGINS.right;

/**
 * Create a new PDFKit document with branding defaults.
 */
export function createPdfDocument(meta: ReportMeta): PDFKit.PDFDocument {
    const doc = new PDFDocument({
        size: 'A4',
        margins: { ...MARGINS },
        bufferPages: true,  // enables page counting for footers
        info: {
            Title: meta.reportTitle,
            Author: meta.tenantName,
            Subject: meta.reportSubtitle || meta.reportTitle,
            Creator: 'Agrent',
            Producer: 'PDFKit',
            CreationDate: new Date(meta.generatedAt),
        },
    });

    // Unicode documents (e.g. the Bulgarian БАБХ ДНЕВНИК) re-register the
    // built-in 'Helvetica' / 'Helvetica-Bold' names with DejaVu Sans, so
    // every layout/table/section helper that calls `.font('Helvetica…')`
    // renders Cyrillic transparently — no helper changes, and 'latin'
    // reports keep the untouched built-in AFM face.
    if (meta.fontFamily === 'unicode') {
        const fonts = loadUnicodeFonts();
        doc.registerFont('Helvetica', fonts.regular);
        doc.registerFont('Helvetica-Bold', fonts.bold);
        doc.font('Helvetica');
    }

    return doc;
}
