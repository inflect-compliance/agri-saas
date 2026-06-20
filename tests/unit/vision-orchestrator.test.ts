/**
 * Unit tests for the vision orchestrator fallback logic. Mocks both
 * provider classes + `@/env` (no native addons, no SDK). Proves the
 * `auto` policy: on-device first, fall back to Claude when ONNX is
 * unavailable / throws / low-confidence; and the pinned `onnx` / `claude`
 * policies.
 */
import type { PestIdentification, VisionImage } from '@/app-layer/ai/vision/types';

const onnxAvailable = jest.fn();
const onnxIdentify = jest.fn();
const claudeAvailable = jest.fn();
const claudeIdentify = jest.fn();

jest.mock('@/app-layer/ai/vision/onnx-provider', () => ({
    OnnxVisionProvider: jest.fn().mockImplementation(() => ({
        backend: 'onnx',
        available: onnxAvailable,
        identify: onnxIdentify,
    })),
}));
jest.mock('@/app-layer/ai/vision/claude-vision-provider', () => ({
    ClaudeVisionProvider: jest.fn().mockImplementation(() => ({
        backend: 'claude',
        available: claudeAvailable,
        identify: claudeIdentify,
    })),
}));

const envMock: { VISION_BACKEND: 'auto' | 'onnx' | 'claude' } = { VISION_BACKEND: 'auto' };
jest.mock('@/env', () => ({ env: envMock }));

import { identifyPhoto } from '@/app-layer/ai/vision';

const IMG: VisionImage = { bytes: Buffer.from('x'), mimeType: 'image/png' };
const onnxResult: PestIdentification = {
    identifiedPest: 'Potato — Early blight',
    confidence: 0.9,
    recommendation: 'r',
    modelVersion: 'cropnet-v1',
    backend: 'onnx',
};
const claudeResult: PestIdentification = {
    identifiedPest: 'Tomato — Late blight',
    confidence: 0.8,
    recommendation: 'r',
    modelVersion: 'claude-sonnet-4-6',
    backend: 'claude',
};

beforeEach(() => {
    jest.clearAllMocks();
    envMock.VISION_BACKEND = 'auto';
});

describe('identifyPhoto — auto policy', () => {
    it('uses on-device when available + confident (no Claude call)', async () => {
        onnxAvailable.mockResolvedValue(true);
        onnxIdentify.mockResolvedValue(onnxResult);
        const r = await identifyPhoto(IMG);
        expect(r?.backend).toBe('onnx');
        expect(claudeIdentify).not.toHaveBeenCalled();
    });

    it('falls back to Claude when on-device is unavailable', async () => {
        onnxAvailable.mockResolvedValue(false);
        claudeAvailable.mockResolvedValue(true);
        claudeIdentify.mockResolvedValue(claudeResult);
        const r = await identifyPhoto(IMG);
        expect(r?.backend).toBe('claude');
        expect(onnxIdentify).not.toHaveBeenCalled();
    });

    it('falls back to Claude when on-device confidence is below threshold', async () => {
        onnxAvailable.mockResolvedValue(true);
        onnxIdentify.mockResolvedValue({ ...onnxResult, confidence: 0.3 });
        claudeAvailable.mockResolvedValue(true);
        claudeIdentify.mockResolvedValue(claudeResult);
        const r = await identifyPhoto(IMG);
        expect(r?.backend).toBe('claude');
    });

    it('keeps the low-confidence on-device result when Claude is unavailable', async () => {
        onnxAvailable.mockResolvedValue(true);
        onnxIdentify.mockResolvedValue({ ...onnxResult, confidence: 0.3 });
        claudeAvailable.mockResolvedValue(false);
        const r = await identifyPhoto(IMG);
        expect(r?.backend).toBe('onnx');
        expect(r?.confidence).toBe(0.3);
    });

    it('falls back to Claude when on-device throws', async () => {
        onnxAvailable.mockResolvedValue(true);
        onnxIdentify.mockRejectedValue(new Error('inference boom'));
        claudeAvailable.mockResolvedValue(true);
        claudeIdentify.mockResolvedValue(claudeResult);
        const r = await identifyPhoto(IMG);
        expect(r?.backend).toBe('claude');
    });

    it('returns null when no backend is available', async () => {
        onnxAvailable.mockResolvedValue(false);
        claudeAvailable.mockResolvedValue(false);
        expect(await identifyPhoto(IMG)).toBeNull();
    });
});

describe('identifyPhoto — pinned policies', () => {
    it('onnx pins to the on-device backend (no Claude)', async () => {
        envMock.VISION_BACKEND = 'onnx';
        onnxAvailable.mockResolvedValue(true);
        onnxIdentify.mockResolvedValue({ ...onnxResult, confidence: 0.2 });
        const r = await identifyPhoto(IMG);
        expect(r?.backend).toBe('onnx');
        expect(claudeAvailable).not.toHaveBeenCalled();
    });

    it('claude pins to the cloud backend (no ONNX)', async () => {
        envMock.VISION_BACKEND = 'claude';
        claudeAvailable.mockResolvedValue(true);
        claudeIdentify.mockResolvedValue(claudeResult);
        const r = await identifyPhoto(IMG);
        expect(r?.backend).toBe('claude');
        expect(onnxAvailable).not.toHaveBeenCalled();
    });
});
