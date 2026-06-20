/**
 * Unit tests for the on-device ONNX vision backend. Mocks
 * `onnxruntime-node` + `sharp` + `fs` so no model file and no native
 * inference are touched: proves preprocessing shape/normalisation,
 * logits → label/confidence mapping, and `available()` = false when no
 * model file is present.
 */
import { softmax, logitsToIdentification, OnnxVisionProvider } from '@/app-layer/ai/vision/onnx-provider';
import { PLANTVILLAGE_LABELS } from '@/app-layer/ai/vision/labels';

jest.mock('@/env', () => ({ env: { VISION_MODEL_PATH: undefined, VISION_LABELS_PATH: undefined } }));

describe('softmax', () => {
    it('produces a normalised distribution summing to 1', () => {
        const p = softmax([1, 2, 3]);
        const sum = p.reduce((a, b) => a + b, 0);
        expect(sum).toBeCloseTo(1, 6);
        expect(p[2]).toBeGreaterThan(p[1]);
        expect(p[1]).toBeGreaterThan(p[0]);
    });

    it('is numerically stable for large logits', () => {
        const p = softmax([1000, 1001, 1002]);
        expect(p.every((x) => Number.isFinite(x))).toBe(true);
        expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    });
});

describe('logitsToIdentification', () => {
    it('argmaxes to the top label with a softmax confidence', () => {
        const logits = new Array(PLANTVILLAGE_LABELS.length).fill(0);
        logits[20] = 10; // 'Potato — Early blight'
        const r = logitsToIdentification(logits, PLANTVILLAGE_LABELS, 'cropnet-v1+abcd1234');
        expect(r.identifiedPest).toBe('Potato — Early blight');
        expect(r.confidence).toBeGreaterThan(0.9);
        expect(r.backend).toBe('onnx');
        expect(r.modelVersion).toBe('cropnet-v1+abcd1234');
        expect(r.recommendation.length).toBeGreaterThan(0);
    });

    it('maps a healthy class to the "healthy" sentinel + a no-action note', () => {
        const logits = new Array(PLANTVILLAGE_LABELS.length).fill(0);
        logits[3] = 10; // 'Apple — healthy'
        const r = logitsToIdentification(logits, PLANTVILLAGE_LABELS, 'cropnet-v1');
        expect(r.identifiedPest).toBe('healthy');
        expect(r.recommendation).toMatch(/no pest or disease/i);
    });
});

describe('OnnxVisionProvider.available', () => {
    it('returns false when no model path is configured', async () => {
        const provider = new OnnxVisionProvider();
        expect(await provider.available()).toBe(false);
    });
});

describe('OnnxVisionProvider.preprocess', () => {
    it('produces an NCHW Float32Array (1×3×224×224) with ImageNet normalisation', async () => {
        // Mock sharp: a 2×2-pixel-equivalent flat raw buffer; the
        // provider resizes to 224×224, so we return the full-size buffer.
        const pixels = 224 * 224;
        const raw = Buffer.alloc(pixels * 3, 128); // mid-grey, interleaved RGB
        const sharpInstance = {
            resize: jest.fn().mockReturnThis(),
            removeAlpha: jest.fn().mockReturnThis(),
            raw: jest.fn().mockReturnThis(),
            toBuffer: jest.fn().mockResolvedValue({ data: raw, info: {} }),
        };
        jest.doMock('sharp', () => ({ __esModule: true, default: jest.fn(() => sharpInstance) }));

        const provider = new OnnxVisionProvider();
        const out = await provider.preprocess({ bytes: Buffer.from([1, 2, 3]), mimeType: 'image/png' });

        expect(out).toBeInstanceOf(Float32Array);
        expect(out.length).toBe(3 * pixels);
        // 128/255 normalised against the red-channel ImageNet mean/std.
        const expected = (128 / 255 - 0.485) / 0.229;
        expect(out[0]).toBeCloseTo(expected, 4);
        expect(sharpInstance.resize).toHaveBeenCalledWith(224, 224, expect.objectContaining({ fit: 'fill' }));
    });
});
