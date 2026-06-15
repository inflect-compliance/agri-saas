/**
 * Farm task-type catalog unit tests.
 */
import {
    FARM_TASK_TYPES,
    FARM_TASK_TYPE_KEYS,
    FARM_TASK_CATEGORIES,
    getFarmTaskType,
    isFarmTaskType,
} from '@/lib/agriculture/farm-task-types';

describe('farm-task-types catalog', () => {
    test('every entry has a unique key and a known category', () => {
        const keys = FARM_TASK_TYPES.map((t) => t.key);
        expect(new Set(keys).size).toBe(keys.length); // unique
        for (const t of FARM_TASK_TYPES) {
            expect(FARM_TASK_CATEGORIES).toContain(t.category);
            expect(t.name.length).toBeGreaterThan(0);
        }
    });

    test('the catalog is non-trivial and exposes its keys', () => {
        expect(FARM_TASK_TYPES.length).toBeGreaterThanOrEqual(20);
        expect(FARM_TASK_TYPE_KEYS).toEqual(FARM_TASK_TYPES.map((t) => t.key));
    });

    test('getFarmTaskType resolves a known key and rejects an unknown one', () => {
        expect(getFarmTaskType('IRRIGATION')).toMatchObject({ key: 'IRRIGATION', category: 'IRRIGATION' });
        expect(getFarmTaskType('HARVESTING')?.category).toBe('HARVEST');
        expect(getFarmTaskType('NOT_A_TYPE')).toBeUndefined();
    });

    test('isFarmTaskType is a correct guard', () => {
        expect(isFarmTaskType('SCOUTING')).toBe(true);
        expect(isFarmTaskType('definitely-not')).toBe(false);
    });
});
