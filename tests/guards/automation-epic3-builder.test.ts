/**
 * Automation Epic 3 — structural ratchet for the visual rule builder.
 *
 * Locks: the builder is a 3-step Modal composed from the shared form
 * primitives (Combobox / RadioGroup / UserCombobox), it POSTs/PUTs to the
 * rules API, RulesTab wires the "+ Rule" trigger + edit-from-sheet, and the
 * client-bundled event-labels import from the leaf (not the barrel).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p: string) => fs.existsSync(path.join(ROOT, p));

const MODAL = 'src/components/processes/RuleBuilderModal.tsx';
const LABELS = 'src/lib/automation/event-labels.ts';
const RULES_TAB = 'src/app/t/[tenantSlug]/(app)/processes/RulesTab.tsx';

describe('Automation Epic 3 — visual rule builder', () => {
    it('the builder modal + event labels exist', () => {
        expect(exists(MODAL)).toBe(true);
        expect(exists(LABELS)).toBe(true);
    });

    it('the builder is a 3-step Modal from the shared form primitives', () => {
        const src = read(MODAL);
        expect(src).toMatch(/from '@\/components\/ui\/modal'/);
        expect(src).toMatch(/Combobox/);
        expect(src).toMatch(/RadioGroup/);
        expect(src).toMatch(/UserCombobox/);
        // three steps
        expect(src).toMatch(/ruleBuilder\.stepLine/);
        expect(src).toMatch(/step === 1/);
        expect(src).toMatch(/step === 2/);
        expect(src).toMatch(/step === 3/);
    });

    it('the builder creates (POST) and edits (PUT) via the rules API', () => {
        const src = read(MODAL);
        expect(src).toMatch(/editRule \?/);
        expect(src).toMatch(/method: editRule \? 'PUT' : 'POST'/);
        expect(src).toMatch(/CACHE_KEYS\.automation\.rules/);
    });

    it('event-labels imports the events leaf, not the barrel (client bundle safety)', () => {
        const src = read(LABELS);
        expect(src).toMatch(/from '@\/app-layer\/automation\/events'/);
        expect(src).not.toMatch(/from '@\/app-layer\/automation'/);
    });

    it('RulesTab wires the + Rule trigger + edit-from-sheet', () => {
        const src = read(RULES_TAB);
        expect(src).toMatch(/RuleBuilderModal/);
        expect(src).toMatch(/toolbarPrimary/);
        expect(src).toMatch(/onEdit/);
    });
});
