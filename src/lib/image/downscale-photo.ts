/**
 * Client-side photo downscaler for the field journal.
 *
 * Rural operators shoot 8–12 MP camera photos (8–12 MB JPEGs) and upload
 * them over flaky LTE. This shrinks the long edge to ~2000 px (plenty for
 * an agronomy record) at JPEG ~0.85 BEFORE the multipart POST — cutting a
 * 10 MB capture to a few hundred KB — while PRESERVING aspect ratio (no
 * crop, unlike the avatar `resizeImage`).
 *
 * Contract:
 *   - non-images (e.g. a PDF attachment) pass through untouched;
 *   - an image already within the long-edge cap passes through untouched
 *     (no needless recompression / quality loss);
 *   - a re-encode that isn't actually smaller is discarded (return original);
 *   - ANY failure fails OPEN — the original File is returned, never thrown —
 *     so a browser without canvas/createImageBitmap still uploads the photo.
 *
 * EXIF orientation is baked in via `createImageBitmap(file, { imageOrientation:
 * 'from-image' })`, so a portrait phone photo is not silently rotated.
 */

export interface DownscalePhotoOptions {
    /** Longest-edge cap in pixels (aspect preserved). Default 2000. */
    maxEdge?: number;
    /** JPEG quality 0..1. Default 0.85. */
    quality?: number;
}

const DEFAULT_MAX_EDGE = 2000;
const DEFAULT_QUALITY = 0.85;

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
    return new Promise((resolve) => {
        canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
    });
}

/** Swap any extension for `.jpg` (the re-encode is always JPEG). */
function toJpegName(name: string): string {
    const base = name.replace(/\.[^./\\]+$/, '');
    return `${base || 'photo'}.jpg`;
}

export async function downscalePhoto(
    file: File,
    opts: DownscalePhotoOptions = {},
): Promise<File> {
    const maxEdge = opts.maxEdge ?? DEFAULT_MAX_EDGE;
    const quality = opts.quality ?? DEFAULT_QUALITY;

    // Only images are downscaled — a PDF or other attachment passes through.
    if (!file.type.startsWith('image/')) return file;

    // Environments without the canvas pipeline (older browsers, SSR, tests
    // that don't stub it) fail open to the original.
    if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
        return file;
    }

    let bitmap: ImageBitmap | null = null;
    try {
        bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
        const { width, height } = bitmap;
        const longEdge = Math.max(width, height);

        // Already small enough — don't recompress (avoids quality loss on a
        // photo that's already cheap to send).
        if (longEdge <= maxEdge) return file;

        const scale = maxEdge / longEdge;
        const targetW = Math.max(1, Math.round(width * scale));
        const targetH = Math.max(1, Math.round(height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) return file;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bitmap, 0, 0, targetW, targetH);

        const blob = await canvasToBlob(canvas, quality);
        // No blob, or the re-encode didn't actually save bytes → keep original.
        if (!blob || blob.size >= file.size) return file;

        return new File([blob], toJpegName(file.name), {
            type: 'image/jpeg',
            lastModified: file.lastModified,
        });
    } catch {
        // Fail open — a downscale hiccup must never block the upload.
        return file;
    } finally {
        bitmap?.close?.();
    }
}
