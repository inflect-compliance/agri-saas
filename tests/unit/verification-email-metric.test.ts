/**
 * `recordVerificationEmailDelivery` is wired from
 * `issueEmailVerification` in BOTH outcome branches.
 *
 * Operators need this signal because `issueEmailVerification`
 * deliberately swallows mailer errors (enumeration safety —
 * registration must return 200 regardless of whether the address
 * is registered or whether the mailer accepted the message). The
 * pino warn is invisible to dashboards; the OTel counter is what
 * gets alerted on. If the counter is not actually wired, a silent
 * mailer outage stays silent until `AUTH_REQUIRE_EMAIL_VERIFICATION=1`
 * starts locking real users out.
 *
 * This test proves the wiring without standing up a real Prisma /
 * SMTP — every external dependency is mocked.
 */

const mockRecord = jest.fn();
const mockSendEmail = jest.fn();
const mockRecordIssued = jest.fn();
const mockTx = jest.fn().mockResolvedValue([]);

jest.mock('@/lib/observability/metrics', () => ({
    __esModule: true,
    recordVerificationEmailDelivery: (...args: unknown[]) => mockRecord(...args),
}));
jest.mock('@/lib/observability/logger', () => ({
    __esModule: true,
    logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));
jest.mock('@/lib/mailer', () => ({
    __esModule: true,
    sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}));
jest.mock('@/lib/prisma', () => ({
    __esModule: true,
    default: {
        $transaction: (...args: unknown[]) => mockTx(...args),
        verificationToken: {
            deleteMany: jest.fn(),
            create: jest.fn(),
        },
    },
}));
jest.mock('@/lib/auth/security-events', () => ({
    __esModule: true,
    recordEmailVerificationIssued: (...args: unknown[]) => mockRecordIssued(...args),
    recordEmailVerified: jest.fn(),
}));
jest.mock('@/env', () => ({
    __esModule: true,
    env: { APP_URL: 'https://test.local' },
}));

import { issueEmailVerification } from '@/lib/auth/email-verification';

beforeEach(() => {
    mockRecord.mockClear();
    mockSendEmail.mockReset();
    mockRecordIssued.mockClear();
    mockTx.mockClear().mockResolvedValue([]);
});

describe('issueEmailVerification — OTel delivery metric', () => {
    it('records { outcome: "sent", flow: "register" } when sendEmail resolves', async () => {
        mockSendEmail.mockResolvedValue(undefined);
        await issueEmailVerification('alice@example.com', { userId: 'u-1' });

        expect(mockRecord).toHaveBeenCalledTimes(1);
        expect(mockRecord).toHaveBeenCalledWith({
            outcome: 'sent',
            flow: 'register',
        });
    });

    it('records { outcome: "failed", flow: "register" } when sendEmail throws — and does NOT re-throw', async () => {
        mockSendEmail.mockRejectedValueOnce(new Error('smtp 421'));

        await expect(
            issueEmailVerification('bob@example.com', { userId: 'u-2' }),
        ).resolves.toBeUndefined();

        expect(mockRecord).toHaveBeenCalledTimes(1);
        expect(mockRecord).toHaveBeenCalledWith({
            outcome: 'failed',
            flow: 'register',
        });
    });

    it('threads `flow: "resend"` through to the metric label', async () => {
        mockSendEmail.mockResolvedValue(undefined);
        await issueEmailVerification('carol@example.com', {
            userId: 'u-3',
            flow: 'resend',
        });

        expect(mockRecord).toHaveBeenCalledTimes(1);
        expect(mockRecord).toHaveBeenCalledWith({
            outcome: 'sent',
            flow: 'resend',
        });
    });

    it('failed-resend still records `flow: "resend"` (the bad-mailer-during-resend case)', async () => {
        mockSendEmail.mockRejectedValueOnce(new Error('connection refused'));
        await issueEmailVerification('dave@example.com', {
            userId: 'u-4',
            flow: 'resend',
        });

        expect(mockRecord).toHaveBeenCalledWith({
            outcome: 'failed',
            flow: 'resend',
        });
    });

    it('the metric fires AFTER the audit event (token row is committed first)', async () => {
        // Order-of-effects sanity check: if the OTel record landed
        // before the audit event, a partial failure (audit DB blip)
        // could leave a metric counter incremented for a delivery
        // that never had an audit record. Keep the order
        // audit → metric so the audit row is the source of truth.
        mockSendEmail.mockResolvedValue(undefined);
        const order: string[] = [];
        mockRecordIssued.mockImplementation(async () => {
            order.push('audit');
        });
        mockRecord.mockImplementation(() => {
            order.push('metric');
        });

        await issueEmailVerification('eve@example.com', { userId: 'u-5' });
        expect(order).toEqual(['audit', 'metric']);
    });
});
