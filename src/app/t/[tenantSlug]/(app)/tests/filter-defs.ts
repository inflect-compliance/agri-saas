/**
 * Epic 53 — Tests rollup page filter configuration.
 *
 * Client-side filters (the page fetches all plans once and filters in
 * memory): Status, Last Result, Frequency, and a single-option "Due"
 * (overdue) toggle. Keys are read off the filter `state` in
 * `tests/page.tsx` to filter the in-memory plan list.
 */

import type { FilterDefInput } from '@/components/ui/filter/filter-definitions';
import {
    createTypedFilterDefs,
    optionsFromEnum,
} from '@/components/ui/filter/filter-definitions';
import { CircleDot, CheckCircle2, Repeat, Clock } from 'lucide-react';

// TestPlanStatus (compliance schema): ACTIVE / PAUSED / ARCHIVED.
export const TEST_STATUS_LABELS = {
    ACTIVE: 'Active',
    PAUSED: 'Paused',
    ARCHIVED: 'Archived',
} as const;

// Last run result. `NONE` is the synthetic "no runs yet" bucket.
export const TEST_RESULT_LABELS = {
    PASS: 'Pass',
    FAIL: 'Fail',
    INCONCLUSIVE: 'Inconclusive',
    NONE: 'No runs',
} as const;

export const TEST_FREQUENCY_LABELS = {
    AD_HOC: 'Ad Hoc',
    DAILY: 'Daily',
    WEEKLY: 'Weekly',
    MONTHLY: 'Monthly',
    QUARTERLY: 'Quarterly',
    ANNUALLY: 'Annually',
} as const;

// Single computed toggle — `nextDueAt` in the past.
export const TEST_DUE_LABELS = {
    overdue: 'Overdue',
} as const;

const STATIC_DEFS = {
    status: {
        label: 'Status',
        description: 'Test plan lifecycle state.',
        group: 'Attributes',
        icon: CircleDot,
        options: optionsFromEnum(TEST_STATUS_LABELS),
        multiple: true,
        resetBehavior: 'clearable',
    },
    result: {
        label: 'Last Result',
        description: 'Outcome of the most recent run.',
        group: 'Attributes',
        icon: CheckCircle2,
        options: optionsFromEnum(TEST_RESULT_LABELS),
        multiple: true,
        resetBehavior: 'clearable',
    },
    frequency: {
        label: 'Frequency',
        description: 'How often the test is scheduled.',
        group: 'Attributes',
        icon: Repeat,
        options: optionsFromEnum(TEST_FREQUENCY_LABELS),
        multiple: true,
        resetBehavior: 'clearable',
    },
    due: {
        label: 'Due',
        description: 'Overdue test plans (next-due date in the past).',
        group: 'Attributes',
        icon: Clock,
        options: optionsFromEnum(TEST_DUE_LABELS),
        multiple: false,
        resetBehavior: 'clearable',
    },
} satisfies Record<string, FilterDefInput>;

export const testFilterDefs = createTypedFilterDefs()(STATIC_DEFS);
export const TEST_FILTER_KEYS = testFilterDefs.filterKeys;

export function buildTestFilters() {
    return testFilterDefs.filters;
}
