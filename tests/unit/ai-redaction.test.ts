/**
 * AI PII redaction for external calls — unit tests.
 */
import {
    redactForExternal,
    rehydrate,
    isExternalBackend,
} from '@/lib/security/ai-redaction';
import type { AiMessage } from '@/app-layer/ai/provider/types';

function msg(content: string): AiMessage {
    return { role: 'user', content };
}

describe('redactForExternal', () => {
    it('replaces email + lat/long with placeholders (no raw values remain)', () => {
        const messages = [
            msg('Contact me at jane.doe@farm.example and my field is at 12.9716, 77.5946.'),
        ];
        const { messages: out, map } = redactForExternal(messages);
        const sent = out[0].content;
        expect(sent).not.toContain('jane.doe@farm.example');
        expect(sent).not.toContain('12.9716, 77.5946');
        expect(sent).toMatch(/\[EMAIL_1\]/);
        expect(sent).toMatch(/\[COORD_1\]/);
        // Map is the reverse lookup.
        expect(Object.values(map)).toContain('jane.doe@farm.example');
    });

    it('redacts phone numbers', () => {
        const { messages: out, map } = redactForExternal([msg('Call +1 (555) 123-4567 today')]);
        expect(out[0].content).not.toContain('555');
        expect(out[0].content).toMatch(/\[PHONE_1\]/);
        expect(Object.keys(map)).toHaveLength(1);
    });

    it('reuses one placeholder for a repeated value', () => {
        const { messages: out, map } = redactForExternal([
            msg('a@b.com and again a@b.com'),
        ]);
        expect(out[0].content).toBe('[EMAIL_1] and again [EMAIL_1]');
        expect(Object.keys(map)).toHaveLength(1);
    });

    it('redacts caller-supplied sensitive terms (longest-first)', () => {
        const { messages: out, map } = redactForExternal(
            [msg('Acme Holdings Ltd signed; Acme is the parent.')],
            { sensitiveTerms: ['Acme', 'Acme Holdings Ltd'] },
        );
        // The longer term wins for its span.
        expect(out[0].content).toContain('[TERM_1]'); // Acme Holdings Ltd
        expect(map['[TERM_1]']).toBe('Acme Holdings Ltd');
    });

    it('returns an empty map when there is no PII', () => {
        const { map } = redactForExternal([msg('how much nitrogen for wheat?')]);
        expect(Object.keys(map)).toHaveLength(0);
    });
});

describe('rehydrate', () => {
    it('restores placeholders in a response', () => {
        const { map } = redactForExternal([msg('email a@b.com here')]);
        const modelResponse = 'I will email [EMAIL_1] for you.';
        expect(rehydrate(modelResponse, map)).toBe('I will email a@b.com for you.');
    });

    it('round-trips: redact then rehydrate returns original', () => {
        const original = 'Reach jane@farm.io at 12.34567, 76.54321 or +1 555 987 6543.';
        const { messages: out, map } = redactForExternal([msg(original)]);
        expect(rehydrate(out[0].content, map)).toBe(original);
    });

    it('is a no-op with an empty map', () => {
        expect(rehydrate('nothing to do', {})).toBe('nothing to do');
    });
});

describe('isExternalBackend', () => {
    it('treats ollama as local and everything else as external', () => {
        expect(isExternalBackend('ollama')).toBe(false);
        expect(isExternalBackend('claude')).toBe(true);
        expect(isExternalBackend('openrouter')).toBe(true);
        expect(isExternalBackend('groq')).toBe(true);
        expect(isExternalBackend('together')).toBe(true);
    });
});
