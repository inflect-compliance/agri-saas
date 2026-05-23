import { NextRequest, NextResponse } from 'next/server';
import { ZodSchema } from 'zod';
import { badRequest } from '@/lib/errors/types';

/**
 * Higher-order function to wrap route handlers with JSON body validation.
 * Enforces Zod schema validation and strips unknown fields (schema should use .strip()).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withValidatedBody<T, Context = any>(
    schema: ZodSchema<T>,
    handler: (req: NextRequest, ctx: Context, body: T) => Promise<NextResponse | Response> | NextResponse | Response
) {
    return async (req: NextRequest, ctx: Context) => {
        let raw: unknown;
        try {
            raw = await req.json();
        } catch {
            throw badRequest('Invalid JSON payload');
        }

        // Using parse() throws a ZodError if invalid, which the API wrapper catches automatically
        const data = schema.parse(raw);

        // Pass the validated and stripped body to the handler
        return handler(req, ctx, data);
    };
}

/**
 * Higher-order function to wrap route handlers with multipart/form-data validation.
 * Note: schema should define file fields appropriately (often customized per route).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withValidatedForm<T, Context = any>(
    schema: ZodSchema<T>,
    handler: (req: NextRequest, ctx: Context, formData: T) => Promise<NextResponse | Response> | NextResponse | Response
) {
    return async (req: NextRequest, ctx: Context) => {
        let formData: FormData;
        try {
            formData = await req.formData();
        } catch {
            throw badRequest('Invalid form data payload');
        }

        // Convert FormData to a standard object for Zod validation
        const fdObject: Record<string, unknown> = {};
        formData.forEach((value, key) => {
            // Support multiple values for the same key (arrays)
            if (fdObject[key]) {
                if (Array.isArray(fdObject[key])) {
                    (fdObject[key] as unknown[]).push(value);
                } else {
                    fdObject[key] = [fdObject[key], value];
                }
            } else {
                fdObject[key] = value;
            }
        });

        const data = schema.parse(fdObject);

        // Pass the validated data (including files as File objects) to the handler
        return handler(req, ctx, data);
    };
}

/**
 * Optional: query parameter validation wrapper.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withValidatedQuery<T, Context = any>(
    schema: ZodSchema<T>,
    handler: (req: NextRequest, ctx: Context, query: T) => Promise<NextResponse | Response> | NextResponse | Response
) {
    return async (req: NextRequest, ctx: Context) => {
        const queryParams = Object.fromEntries(req.nextUrl.searchParams.entries());
        const data = schema.parse(queryParams);
        return handler(req, ctx, data);
    };
}
