/**
 * Supplier catalogue (#12) — the write seam behind the global promotions feed.
 *
 * Two invariants matter here and neither is obvious from the schema:
 *
 *   1. **Sanitisation.** `notes` / `contactName` are encrypted at rest, which
 *      protects confidentiality but does nothing for the renderers that
 *      decrypt and display them. Both create and update must route through the
 *      one seam, or the paths drift (the way the journal's two creation paths
 *      drifted until one had no audit event).
 *   2. **The dedup key travels with the name.** `nameKey` is what stops one
 *      supplier forking into several through typing variance; a rename that
 *      updates `name` without `nameKey` silently breaks that.
 */
export {};

const mockCompany = {
    create: jest.fn(),
    update: jest.fn(),
    findUnique: jest.fn(),
};
const mockLogEvent = jest.fn();

jest.mock('@/app-layer/events/audit', () => ({ logEvent: (...a: unknown[]) => mockLogEvent(...a) }));

import {
    createCompany,
    updateCompany,
    findOrCreateCompany,
} from '@/app-layer/usecases/company';
import { companyNameKey } from '@/app-layer/usecases/promotions';
import { makeRequestContext } from '../helpers/make-context';

const ctx = makeRequestContext('ADMIN', {
    userId: 'support-1',
    tenantId: 'platform-t',
    tenantSlug: 'agrent-platform',
});
// The write runs inside the caller's tenant transaction; `db` is that tx client.
const db = { company: mockCompany } as never;

beforeEach(() => {
    jest.clearAllMocks();
    const echo = async (args: { data: Record<string, unknown> }) => ({ id: 'c-1', ...args.data });
    mockCompany.create.mockImplementation(echo);
    mockCompany.update.mockImplementation(echo);
    mockCompany.findUnique.mockResolvedValue(null);
});

describe('companyNameKey', () => {
    it('collapses the variance that forks one supplier into several', () => {
        for (const variant of ['Syngenta', 'syngenta', '  Syngenta  ', 'SYNGENTA']) {
            expect(companyNameKey(variant)).toBe('syngenta');
        }
    });

    it('collapses internal whitespace but keeps genuinely different names apart', () => {
        expect(companyNameKey('Syngenta   BG')).toBe('syngenta bg');
        expect(companyNameKey('Syngenta BG')).toBe('syngenta bg');
        expect(companyNameKey('Syngenta')).not.toBe(companyNameKey('Syngenta BG'));
    });
});

describe('createCompany', () => {
    it('strips markup from support notes before they are persisted', async () => {
        await createCompany(db, ctx, {
                name: 'Agropolychim',
                notes: 'Called <script>alert(1)</script> on Tuesday',
                contactName: '<b>Ivan</b> Petrov',
            },
        );

        const { data } = mockCompany.create.mock.calls[0][0];
        expect(data.notes).not.toContain('<script>');
        expect(data.notes).toContain('Tuesday');
        expect(data.contactName).not.toContain('<b>');
        expect(data.contactName).toContain('Ivan');
    });

    it('derives the dedup key from the name', async () => {
        await createCompany(db, ctx, { name: '  Syngenta  ' });
        const { data } = mockCompany.create.mock.calls[0][0];
        expect(data.name).toBe('Syngenta');
        expect(data.nameKey).toBe('syngenta');
    });

    it('rejects a blank name rather than creating an unnameable supplier', async () => {
        await expect(createCompany(db, ctx, { name: '   ' })).rejects.toThrow(/name is required/i);
        expect(mockCompany.create).not.toHaveBeenCalled();
    });

    it('turns the unique violation into an actionable conflict', async () => {
        const { Prisma } = jest.requireActual('@prisma/client');
        mockCompany.create.mockRejectedValue(
            new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
        );

        await expect(createCompany(db, ctx, { name: 'Syngenta' })).rejects.toThrow(
            /already exists/i,
        );
    });
});

describe('updateCompany', () => {
    beforeEach(() => mockCompany.findUnique.mockResolvedValue({ id: 'c-1' }));

    it('404s on a missing supplier', async () => {
        mockCompany.findUnique.mockResolvedValue(null);
        await expect(updateCompany(db, ctx, 'nope', { name: 'X' })).rejects.toThrow(/not found/i);
        expect(mockCompany.update).not.toHaveBeenCalled();
    });

    it('moves the dedup key with the name on a rename', async () => {
        await updateCompany(db, ctx, 'c-1', { name: 'Syngenta Bulgaria' });
        const { data } = mockCompany.update.mock.calls[0][0];
        expect(data.name).toBe('Syngenta Bulgaria');
        expect(data.nameKey).toBe('syngenta bulgaria');
    });

    it('leaves the dedup key alone when the name is not part of the update', async () => {
        await updateCompany(db, ctx, 'c-1', { notes: 'Renewed for 2027' });
        const { data } = mockCompany.update.mock.calls[0][0];
        expect(data).not.toHaveProperty('nameKey');
        expect(data).not.toHaveProperty('name');
    });

    it('sanitises on the update path too, not just create', async () => {
        await updateCompany(db, ctx, 'c-1', { notes: '<img src=x onerror=alert(1)>ok' });
        const { data } = mockCompany.update.mock.calls[0][0];
        expect(data.notes).not.toContain('onerror');
        expect(data.notes).toContain('ok');
    });

    it('preserves the three-state contract: null clears, undefined leaves alone', async () => {
        await updateCompany(db, ctx, 'c-1', { notes: null, contactEmail: undefined });
        const { data } = mockCompany.update.mock.calls[0][0];
        expect(data.notes).toBeNull();
        expect(data).not.toHaveProperty('contactEmail');
    });
});

describe('findOrCreateCompany', () => {
    it('reuses an existing supplier despite different spelling', async () => {
        mockCompany.findUnique.mockResolvedValue({ id: 'c-existing', name: 'Syngenta' });

        const company = await findOrCreateCompany(db, ctx, '  SYNGENTA ');

        expect(company.id).toBe('c-existing');
        expect(mockCompany.findUnique).toHaveBeenCalledWith({ where: { nameKey: 'syngenta' } });
        expect(mockCompany.create).not.toHaveBeenCalled();
    });

    it('creates when the supplier is genuinely new', async () => {
        mockCompany.findUnique.mockResolvedValue(null);
        await findOrCreateCompany(db, ctx, 'Brand New Co');
        expect(mockCompany.create).toHaveBeenCalledTimes(1);
    });
});
