/**
 * VR-8 — automation evidence-pack aggregator (pure core).
 */
import { summarizeRuleExecutions } from '@/app-layer/usecases/automation-export';

const rule = (id: string, over: Partial<Parameters<typeof summarizeRuleExecutions>[0][number]> = {}) => ({
    id,
    name: `Rule ${id}`,
    triggerEvent: 'RISK_CREATED',
    status: 'ENABLED',
    executionCount: 0,
    lastTriggeredAt: null,
    nextRuleId: null,
    ...over,
});

describe('summarizeRuleExecutions', () => {
    it('computes per-rule success rate + a tenant 30d rollup', () => {
        const rules = [rule('r1', { nextRuleId: 'r2' }), rule('r2')];
        const execs = [
            { ruleId: 'r1', status: 'SUCCEEDED', createdAt: new Date() },
            { ruleId: 'r1', status: 'SUCCEEDED', createdAt: new Date() },
            { ruleId: 'r1', status: 'FAILED', createdAt: new Date() },
            { ruleId: 'r2', status: 'SUCCEEDED', createdAt: new Date() },
        ];
        const out = summarizeRuleExecutions(rules, execs);
        expect(out.executions30d).toEqual({ total: 4, succeeded: 3, failed: 1 });
        const r1 = out.rules.find((r) => r.id === 'r1')!;
        expect(r1.successRate).toBeCloseTo(2 / 3);
        expect(r1.chainedRuleId).toBe('r2');
        expect(out.rules.find((r) => r.id === 'r2')!.successRate).toBe(1);
    });

    it('reports 0 success rate for a rule with no terminal runs', () => {
        const out = summarizeRuleExecutions([rule('r1')], []);
        expect(out.rules[0].successRate).toBe(0);
        expect(out.executions30d.total).toBe(0);
    });

    it('ignores non-terminal (RUNNING/SKIPPED) rows in the success rate', () => {
        const out = summarizeRuleExecutions(
            [rule('r1')],
            [
                { ruleId: 'r1', status: 'RUNNING', createdAt: new Date() },
                { ruleId: 'r1', status: 'SUCCEEDED', createdAt: new Date() },
            ],
        );
        // total counts all rows; successRate only over terminal (1 succeeded / 1 terminal)
        expect(out.executions30d.total).toBe(2);
        expect(out.rules[0].successRate).toBe(1);
    });
});
