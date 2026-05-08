/**
 * Pure file-type → icon mapping. Extracted from the React component
 * so node-only unit tests can import it without pulling in TSX.
 *
 * Heuristic order: extension first (cheapest, most reliable), then
 * MIME-type prefix (handles e.g. `image/avif` we didn't enumerate),
 * then the application/* family. Falls through to a generic `File`
 * icon for unknown types.
 */

import {
    File as FileIcon,
    FileArchive,
    FileImage,
    FileJson,
    FileSpreadsheet,
    FileText,
    FileType,
    Link2,
    type LucideIcon,
} from 'lucide-react';

export interface FileTypeMatch {
    /** Lucide icon component for the file kind. */
    Icon: LucideIcon;
    /** Tailwind text-color class for the icon. */
    colorClass: string;
    /** Short label, e.g. "PDF", "CSV", "Image". Useful for a11y / tooltip. */
    label: string;
}

/**
 * Resolve a file-type icon from filename + optional MIME type. Either
 * argument may be null/undefined; passing both narrows the answer.
 *
 * `domainKind` is a domain hint — when the row is a non-file evidence
 * kind (LINK / TEXT / NOTE) we want a different icon family.
 */
export function resolveFileTypeIcon(
    fileName: string | null | undefined,
    mime?: string | null,
    domainKind?: string | null,
): FileTypeMatch {
    if (domainKind && domainKind !== 'FILE') {
        if (domainKind === 'LINK' || domainKind === 'URL') {
            return { Icon: Link2, colorClass: 'text-violet-400', label: 'Link' };
        }
        if (domainKind === 'TEXT' || domainKind === 'NOTE') {
            return {
                Icon: FileText,
                colorClass: 'text-content-muted',
                label: 'Text',
            };
        }
    }

    const ext = (fileName ?? '').split('.').pop()?.toLowerCase() ?? '';
    const m = (mime ?? '').toLowerCase();

    if (
        ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'heic', 'avif'].includes(ext) ||
        m.startsWith('image/')
    ) {
        return { Icon: FileImage, colorClass: 'text-content-success', label: 'Image' };
    }
    if (ext === 'pdf' || m === 'application/pdf') {
        return { Icon: FileType, colorClass: 'text-content-error', label: 'PDF' };
    }
    if (ext === 'csv' || m === 'text/csv') {
        return {
            Icon: FileSpreadsheet,
            colorClass: 'text-content-success',
            label: 'CSV',
        };
    }
    if (
        ['xls', 'xlsx', 'ods'].includes(ext) ||
        m.includes('spreadsheet') ||
        m === 'application/vnd.ms-excel'
    ) {
        return {
            Icon: FileSpreadsheet,
            colorClass: 'text-content-success',
            label: 'Spreadsheet',
        };
    }
    if (
        ['doc', 'docx', 'odt', 'rtf'].includes(ext) ||
        m.includes('wordprocessing') ||
        m === 'application/msword'
    ) {
        return { Icon: FileText, colorClass: 'text-content-info', label: 'Document' };
    }
    if (ext === 'json' || m === 'application/json') {
        return { Icon: FileJson, colorClass: 'text-content-warning', label: 'JSON' };
    }
    if (
        ['zip', 'tar', 'gz', '7z', 'rar'].includes(ext) ||
        m === 'application/zip' ||
        m === 'application/x-zip-compressed'
    ) {
        return {
            Icon: FileArchive,
            colorClass: 'text-content-warning',
            label: 'Archive',
        };
    }
    if (['txt', 'md', 'log'].includes(ext) || m.startsWith('text/')) {
        return { Icon: FileText, colorClass: 'text-content-muted', label: 'Text' };
    }

    return { Icon: FileIcon, colorClass: 'text-content-muted', label: 'File' };
}
