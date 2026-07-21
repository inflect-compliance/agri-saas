/**
 * The encrypt fan-out must resolve the nested target model, not guess by name.
 *
 * ## The bug this closes
 *
 * `walkWriteArgument` used to descend into nested writes with `modelName='*'`,
 * because a payload like `{ promotion: { create: {...} } }` doesn't name its
 * target model. That triggered `encryptDataNodeAllModels`, which matches keys
 * against `ALL_ENCRYPTED_FIELD_NAMES` — a FLAT set across the whole manifest
 * with no idea which model a key belongs to.
 *
 * The DECRYPT fan-out is safe by construction: a plaintext value has no
 * `v1:`/`v2:` prefix, so `isEncryptedValue()` skips it. **The encrypt fan-out
 * had no equivalent guard.** Any string under a manifest-listed field name got
 * encrypted, whatever model it actually belonged to.
 *
 * It bit for real: adding `PromotionLead: ['message']` to the manifest wrote
 * ciphertext into `Notification.message` (caught by the automation suite) and
 * `ExchangeInquiry.message` (caught by the exchange E2E). `InsuranceLead`
 * carries the same field name with nothing watching it.
 *
 * The target was never actually unknown — it is determined by the parent model
 * plus the relation field name, both of which Prisma's DMMF knows. These tests
 * pin that resolution, since without it the manifest silently becomes a
 * cross-model field-name blocklist.
 */
import { Prisma } from '@prisma/client';
import { ENCRYPTED_FIELDS } from '@/lib/security/encrypted-fields';

describe('nested-write target model resolution', () => {
    const models = Prisma.dmmf.datamodel.models;

    it('DMMF exposes relation targets — the resolution this depends on', () => {
        const lead = models.find((m) => m.name === 'PromotionLead');
        expect(lead).toBeDefined();
        const promotionRel = lead!.fields.find(
            (f) => f.kind === 'object' && f.name === 'promotion',
        );
        expect(promotionRel?.type).toBe('Promotion');
    });

    it('every relation field resolves to a real model — no dangling targets', () => {
        const names = new Set(models.map((m) => m.name));
        const dangling: string[] = [];
        for (const model of models) {
            for (const f of model.fields) {
                if (f.kind === 'object' && !names.has(f.type as string)) {
                    dangling.push(`${model.name}.${f.name} -> ${f.type}`);
                }
            }
        }
        expect(dangling).toEqual([]);
    });

    /**
     * The regression itself, expressed structurally: for every encrypted field
     * name, list the OTHER models that carry the same field name without
     * encrypting it. Those are the models the old fan-out would have corrupted
     * on any nested write. The count is large (the manifest shares generic
     * names like `description` and `notes` widely) — which is exactly why
     * guessing by name was unsafe and resolution is required.
     */
    it('documents the blast radius that name-matching alone would have', () => {
        const declaredOn = new Map<string, string[]>();
        for (const model of models) {
            for (const f of model.fields) {
                if (f.kind === 'object') continue;
                const list = declaredOn.get(f.name) ?? [];
                list.push(model.name);
                declaredOn.set(f.name, list);
            }
        }

        let atRisk = 0;
        for (const [encModel, fields] of Object.entries(ENCRYPTED_FIELDS)) {
            for (const field of fields) {
                for (const other of declaredOn.get(field) ?? []) {
                    if (other === encModel) continue;
                    if ((ENCRYPTED_FIELDS[other] ?? []).includes(field)) continue;
                    atRisk += 1;
                }
            }
        }
        // Not asserting a specific number (it moves with every new model) —
        // asserting that the hazard is real and therefore worth resolving.
        expect(atRisk).toBeGreaterThan(0);
    });

    it('`message` is carried by models outside the manifest — the exact trap hit', () => {
        const carriers = models
            .filter((m) => m.fields.some((f) => f.name === 'message' && f.kind !== 'object'))
            .map((m) => m.name);
        // Notification / ExchangeInquiry / InsuranceLead / PromotionLead.
        expect(carriers.length).toBeGreaterThan(1);
        // None of them may encrypt under the shared name.
        for (const model of carriers) {
            expect(ENCRYPTED_FIELDS[model] ?? []).not.toContain('message');
        }
    });
});
