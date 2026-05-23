/**
 * Rendered tests for useZodForm — the shared form+validation hook
 * that bridges server-side Zod schemas to client-side UI state.
 *
 *   - Parses values against the schema continuously.
 *   - Hides errors for untouched fields until the user blurs or the
 *     caller invokes validate().
 *   - Reflects server-side errors via the `serverErrors` override.
 *   - `canSubmit` is false when any field has an error.
 */

import { act, renderHook } from '@testing-library/react';
import { z } from 'zod';
import { useZodForm } from '@/lib/forms/use-zod-form';

const Schema = z.object({
    name: z.string().min(3, 'Name must be 3+ chars'),
    email: z.string().email('Must be a valid email'),
    age: z.number().int().positive('Age must be positive').optional(),
});

type Values = z.input<typeof Schema>;
const defaults: Values = { name: '', email: '' };

describe('useZodForm', () => {
    it('starts with the supplied defaults', () => {
        const { result } = renderHook(() =>
            useZodForm({ schema: Schema, defaults }),
        );
        expect(result.current.values).toEqual(defaults);
    });

    it('hides errors for untouched fields', () => {
        const { result } = renderHook(() =>
            useZodForm({ schema: Schema, defaults }),
        );
        // Errors are populated internally but `fieldError` is gated by touched.
        expect(result.current.fieldError('name')).toBeUndefined();
        expect(result.current.fieldError('email')).toBeUndefined();
    });

    it('surfaces errors once a field is touched', () => {
        const { result } = renderHook(() =>
            useZodForm({ schema: Schema, defaults }),
        );
        act(() => {
            result.current.touchField('name');
        });
        expect(result.current.fieldError('name')).toBe('Name must be 3+ chars');
    });

    it('clears the error when the value becomes valid', () => {
        const { result } = renderHook(() =>
            useZodForm({ schema: Schema, defaults }),
        );
        act(() => {
            result.current.touchField('name');
            result.current.setField('name', 'Alice');
        });
        expect(result.current.fieldError('name')).toBeUndefined();
    });

    it('canSubmit reflects the presence of any error, touched or not', () => {
        const { result } = renderHook(() =>
            useZodForm({ schema: Schema, defaults }),
        );
        // Defaults are invalid — name is empty, email is empty.
        expect(result.current.canSubmit).toBe(false);
        act(() => {
            result.current.setField('name', 'Alice');
            result.current.setField('email', 'alice@acme.com');
        });
        expect(result.current.canSubmit).toBe(true);
    });

    it('validate() returns parse result and touches every field', () => {
        const { result } = renderHook(() =>
            useZodForm({ schema: Schema, defaults }),
        );
        let outcome!: ReturnType<typeof result.current.validate>;
        act(() => {
            outcome = result.current.validate();
        });
        expect(outcome.success).toBe(false);
        if (!outcome.success) {
            expect(outcome.errors.name).toBeDefined();
            expect(outcome.errors.email).toBeDefined();
        }
        // Touched flags set, so subsequent reads show errors.
        expect(result.current.fieldError('name')).toBeDefined();
        expect(result.current.fieldError('email')).toBeDefined();
    });

    it('validate() returns success with parsed data when fully valid', () => {
        const { result } = renderHook(() =>
            useZodForm({ schema: Schema, defaults }),
        );
        act(() => {
            result.current.setField('name', 'Alice');
            result.current.setField('email', 'alice@acme.com');
        });
        let outcome!: ReturnType<typeof result.current.validate>;
        act(() => {
            outcome = result.current.validate();
        });
        expect(outcome.success).toBe(true);
        if (outcome.success) {
            expect(outcome.data.email).toBe('alice@acme.com');
        }
    });

    it('server errors override client errors and display regardless of touched', () => {
        type ServerErrs = Partial<Record<keyof Values, string>> | undefined;
        const { result, rerender } = renderHook(
            ({ serverErrors }: { serverErrors: ServerErrs }) =>
                useZodForm({ schema: Schema, defaults, serverErrors }),
            { initialProps: { serverErrors: undefined as ServerErrs } },
        );
        act(() => {
            result.current.setField('name', 'Alice');
            result.current.setField('email', 'alice@acme.com');
        });
        expect(result.current.canSubmit).toBe(true);

        rerender({ serverErrors: { email: 'Email already registered' } });
        expect(result.current.fieldError('email')).toBe(
            'Email already registered',
        );
        expect(result.current.canSubmit).toBe(false);
    });

    it('reset() restores defaults and clears touched / errors', () => {
        const { result } = renderHook(() =>
            useZodForm({ schema: Schema, defaults }),
        );
        act(() => {
            result.current.setField('name', 'Alice');
            result.current.touchField('name');
        });
        act(() => {
            result.current.reset();
        });
        expect(result.current.values).toEqual(defaults);
        expect(result.current.fieldError('name')).toBeUndefined();
    });

    it('isFieldInvalid mirrors fieldError presence', () => {
        const { result } = renderHook(() =>
            useZodForm({ schema: Schema, defaults }),
        );
        act(() => {
            result.current.touchField('email');
        });
        expect(result.current.isFieldInvalid('email')).toBe(true);
        act(() => {
            result.current.setField('email', 'ok@acme.com');
        });
        expect(result.current.isFieldInvalid('email')).toBe(false);
    });
});
