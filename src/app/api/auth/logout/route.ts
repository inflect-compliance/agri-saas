import { withValidatedBody } from '@/lib/validation/route';
import { EmptyBodySchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const POST = withApiErrorHandling(withValidatedBody(EmptyBodySchema, async () => {
    const response = jsonResponse({ success: true });
    response.cookies.set('token', '', { maxAge: 0, path: '/' });
    return response;
}));
