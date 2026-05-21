/**
 * Unit tests for `verifyRedisEvictionPolicy` (src/lib/redis.ts) — the
 * runtime half of the roadmap-2 P2 remediation. A best-effort startup
 * check that detects a BullMQ-unsafe Redis `maxmemory-policy`.
 */
jest.mock('@/lib/observability/logger', () => ({
    logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    },
}));

import { verifyRedisEvictionPolicy } from '@/lib/redis';
import { logger } from '@/lib/observability/logger';
import type Redis from 'ioredis';

/** Minimal fake ioredis client — only `.call` is exercised. */
function fakeRedis(callResult: unknown): Redis {
    return { call: jest.fn().mockResolvedValue(callResult) } as unknown as Redis;
}
function throwingRedis(): Redis {
    return {
        call: jest.fn().mockRejectedValue(new Error('ERR unknown command CONFIG')),
    } as unknown as Redis;
}

const mockWarn = logger.warn as jest.Mock;
const mockError = logger.error as jest.Mock;
const mockInfo = logger.info as jest.Mock;

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

/** `process.env.NODE_ENV` is typed read-only — set it via a cast. */
function setNodeEnv(value: string | undefined): void {
    (process.env as Record<string, string | undefined>).NODE_ENV = value;
}

beforeEach(() => {
    mockWarn.mockClear();
    mockError.mockClear();
    mockInfo.mockClear();
});

afterEach(() => {
    setNodeEnv(ORIGINAL_NODE_ENV);
});

describe('verifyRedisEvictionPolicy', () => {
    it('returns the policy and stays quiet when Redis reports noeviction', async () => {
        const policy = await verifyRedisEvictionPolicy(
            fakeRedis(['maxmemory-policy', 'noeviction']),
        );
        expect(policy).toBe('noeviction');
        expect(mockWarn).not.toHaveBeenCalled();
        expect(mockError).not.toHaveBeenCalled();
    });

    it('detects an evicting policy and returns it', async () => {
        const policy = await verifyRedisEvictionPolicy(
            fakeRedis(['maxmemory-policy', 'allkeys-lru']),
        );
        expect(policy).toBe('allkeys-lru');
    });

    it.each(['allkeys-lru', 'allkeys-lfu', 'volatile-lru', 'volatile-ttl'])(
        'warns (non-production) when the policy is the evicting %s',
        async (policy) => {
            setNodeEnv('test');
            await verifyRedisEvictionPolicy(fakeRedis(['maxmemory-policy', policy]));
            expect(mockWarn).toHaveBeenCalledTimes(1);
            expect(mockError).not.toHaveBeenCalled();
        },
    );

    it('logs an ERROR in production when the policy evicts', async () => {
        setNodeEnv('production');
        await verifyRedisEvictionPolicy(
            fakeRedis(['maxmemory-policy', 'allkeys-lru']),
        );
        expect(mockError).toHaveBeenCalledTimes(1);
        expect(mockWarn).not.toHaveBeenCalled();
    });

    it('returns null when no Redis client is available', async () => {
        expect(await verifyRedisEvictionPolicy(null)).toBeNull();
    });

    it('returns null and does not throw when CONFIG GET is unavailable', async () => {
        // Managed Redis (ElastiCache) disables/renames CONFIG — the
        // check must degrade quietly, not warn or error.
        await expect(
            verifyRedisEvictionPolicy(throwingRedis()),
        ).resolves.toBeNull();
        expect(mockWarn).not.toHaveBeenCalled();
        expect(mockError).not.toHaveBeenCalled();
    });
});
