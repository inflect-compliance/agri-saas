/**
 * Unit tests for the Claude vision backend. Mocks `@anthropic-ai/sdk`
 * (no network) and `@/env` (API-key gate). Proves: `available()`
 * reflects the key, the forced-tool result is parsed + validated, the
 * image rides as a base64 block, and an invalid/absent tool result
 * throws.
 */
const createMock = jest.fn();

jest.mock('@anthropic-ai/sdk', () => {
    return {
        __esModule: true,
        default: jest.fn().mockImplementation(() => ({
            messages: { create: createMock },
        })),
    };
});

const envMock: { ANTHROPIC_API_KEY?: string; ANTHROPIC_BASE_URL?: string } = {};
jest.mock('@/env', () => ({ env: envMock }));

import { ClaudeVisionProvider } from '@/app-layer/ai/vision/claude-vision-provider';

beforeEach(() => {
    jest.clearAllMocks();
    envMock.ANTHROPIC_API_KEY = 'sk-test';
    envMock.ANTHROPIC_BASE_URL = undefined;
});

describe('ClaudeVisionProvider.available', () => {
    it('is true with a key, false without', async () => {
        const p = new ClaudeVisionProvider();
        expect(await p.available()).toBe(true);
        envMock.ANTHROPIC_API_KEY = undefined;
        expect(await p.available()).toBe(false);
    });
});

describe('ClaudeVisionProvider.identify', () => {
    it('parses a valid forced-tool result and sends the image as a base64 block', async () => {
        createMock.mockResolvedValue({
            stop_reason: 'tool_use',
            content: [
                {
                    type: 'tool_use',
                    name: 'report_identification',
                    input: {
                        identifiedPest: 'Tomato — Late blight',
                        confidence: 0.82,
                        recommendation: 'Likely late blight; isolate and confirm with an agronomist.',
                    },
                },
            ],
        });

        const p = new ClaudeVisionProvider('claude-sonnet-4-6');
        const result = await p.identify({ bytes: Buffer.from('hello'), mimeType: 'image/png' });

        expect(result.identifiedPest).toBe('Tomato — Late blight');
        expect(result.confidence).toBe(0.82);
        expect(result.backend).toBe('claude');
        expect(result.modelVersion).toBe('claude-sonnet-4-6');

        const call = createMock.mock.calls[0][0];
        expect(call.tool_choice).toEqual({ type: 'tool', name: 'report_identification' });
        const imageBlock = call.messages[0].content.find((b: { type: string }) => b.type === 'image');
        expect(imageBlock.source.type).toBe('base64');
        expect(imageBlock.source.media_type).toBe('image/png');
        expect(imageBlock.source.data).toBe(Buffer.from('hello').toString('base64'));
    });

    it('throws when the model returns no valid tool output', async () => {
        createMock.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'hi' }] });
        const p = new ClaudeVisionProvider();
        await expect(p.identify({ bytes: Buffer.from('x'), mimeType: 'image/jpeg' })).rejects.toThrow(
            /no valid tool output/i,
        );
    });

    it('throws when no API key is set', async () => {
        envMock.ANTHROPIC_API_KEY = undefined;
        const p = new ClaudeVisionProvider();
        await expect(p.identify({ bytes: Buffer.from('x'), mimeType: 'image/jpeg' })).rejects.toThrow(
            /ANTHROPIC_API_KEY/,
        );
    });

    it('coerces an unsupported media type to image/jpeg', async () => {
        createMock.mockResolvedValue({
            stop_reason: 'tool_use',
            content: [
                {
                    type: 'tool_use',
                    name: 'report_identification',
                    input: { identifiedPest: 'unknown', confidence: 0.1, recommendation: 'Verify with an agronomist.' },
                },
            ],
        });
        const p = new ClaudeVisionProvider();
        await p.identify({ bytes: Buffer.from('x'), mimeType: 'image/bmp' });
        const call = createMock.mock.calls[0][0];
        const imageBlock = call.messages[0].content.find((b: { type: string }) => b.type === 'image');
        expect(imageBlock.source.media_type).toBe('image/jpeg');
    });
});
