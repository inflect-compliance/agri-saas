/**
 * Epic OI-1 — structural ratchet for the Terraform foundation.
 *
 * Locks the shape of `infra/terraform/` so the production-grade
 * conventions (separate state files per env, partial backend config,
 * AWS provider pin, four canonical files at the root, module
 * placeholders) cannot regress silently.
 *
 * If a check here fails, the diff is the design conversation:
 *   - moving the bucket name into `backend.tf` (vs partial config) →
 *     fails the "partial backend" assertion. Don't bypass; if you
 *     want hardcoded backends per env, the move is an intentional
 *     design change and this test should be updated in the same PR.
 *   - downgrading the AWS provider pin → fails the version check.
 *     Mitigated by an explicit version bump in versions.tf and a
 *     paired update here.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');

const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));

describe('Epic OI-1 — Terraform root module canonical files', () => {
    it.each([
        'infra/terraform/main.tf',
        'infra/terraform/variables.tf',
        'infra/terraform/outputs.tf',
        'infra/terraform/versions.tf',
        'infra/terraform/providers.tf',
        'infra/terraform/backend.tf',
    ])('%s exists', (rel) => {
        expect(exists(rel)).toBe(true);
    });

    it('versions.tf pins terraform >= 1.6 and aws provider >= 5.0', () => {
        const src = read('infra/terraform/versions.tf');
        expect(src).toMatch(/required_version\s*=\s*">=\s*1\.6/);
        // Lock the AWS provider source + a >= 5.0 lower bound. The
        // upper bound is left flexible so a minor bump doesn't trip
        // the test, but the major-version floor is load-bearing.
        expect(src).toMatch(/source\s*=\s*"hashicorp\/aws"/);
        expect(src).toMatch(/version\s*=\s*">=\s*5\.0/);
    });

    it('providers.tf wires aws provider with default_tags', () => {
        const src = read('infra/terraform/providers.tf');
        expect(src).toMatch(/provider\s+"aws"/);
        expect(src).toMatch(/default_tags\s*\{/);
    });

    it('backend.tf uses S3 with PARTIAL config (env-scoped at init)', () => {
        const src = read('infra/terraform/backend.tf');
        expect(src).toMatch(/backend\s+"s3"\s*\{\s*\}/);
        // No hardcoded bucket / key / dynamodb_table at the file level.
        // Partial config means these come from environments/<env>/backend.hcl.
        for (const key of ['bucket', 'key', 'dynamodb_table']) {
            const lines = src
                .split('\n')
                .filter((l) => !l.trim().startsWith('#'))
                .join('\n');
            expect(lines).not.toMatch(new RegExp(`^\\s*${key}\\s*=\\s*"`, 'm'));
        }
    });
});

describe('Epic OI-1 — per-environment state separation', () => {
    it.each(['staging', 'production'])(
        'environments/%s/backend.hcl + environments/%s/terraform.tfvars exist',
        (env) => {
            expect(exists(`infra/terraform/environments/${env}/backend.hcl`)).toBe(true);
            expect(exists(`infra/terraform/environments/${env}/terraform.tfvars`)).toBe(true);
        },
    );

    it.each(['staging', 'production'])(
        '%s backend config carries bucket + key + region + dynamodb_table + encrypt',
        (env) => {
            const src = read(`infra/terraform/environments/${env}/backend.hcl`);
            expect(src).toMatch(/^bucket\s*=\s*"/m);
            expect(src).toMatch(/^key\s*=\s*"/m);
            expect(src).toMatch(/^region\s*=\s*"/m);
            expect(src).toMatch(/^dynamodb_table\s*=\s*"/m);
            expect(src).toMatch(/^encrypt\s*=\s*true/m);
        },
    );

    it('staging and production point at DIFFERENT state buckets', () => {
        const stagingBucket = read('infra/terraform/environments/staging/backend.hcl').match(
            /^bucket\s*=\s*"([^"]+)"/m,
        )?.[1];
        const prodBucket = read('infra/terraform/environments/production/backend.hcl').match(
            /^bucket\s*=\s*"([^"]+)"/m,
        )?.[1];
        expect(stagingBucket).toBeTruthy();
        expect(prodBucket).toBeTruthy();
        // Blast-radius isolation: a compromised staging credential must
        // not have any IAM-grantable path to production state.
        expect(stagingBucket).not.toEqual(prodBucket);
    });

    it('staging and production point at DIFFERENT state object keys', () => {
        const stagingKey = read('infra/terraform/environments/staging/backend.hcl').match(
            /^key\s*=\s*"([^"]+)"/m,
        )?.[1];
        const prodKey = read('infra/terraform/environments/production/backend.hcl').match(
            /^key\s*=\s*"([^"]+)"/m,
        )?.[1];
        expect(stagingKey).toBeTruthy();
        expect(prodKey).toBeTruthy();
        expect(stagingKey).not.toEqual(prodKey);
    });
});

describe('Epic OI-1 — bootstrap stack', () => {
    it.each([
        'infra/terraform/bootstrap/versions.tf',
        'infra/terraform/bootstrap/main.tf',
        'infra/terraform/bootstrap/variables.tf',
        'infra/terraform/bootstrap/outputs.tf',
        'infra/terraform/bootstrap/README.md',
    ])('%s exists', (rel) => {
        expect(exists(rel)).toBe(true);
    });

    it('bootstrap creates per-env S3 state buckets and a DynamoDB lock table', () => {
        const src = read('infra/terraform/bootstrap/main.tf');
        expect(src).toMatch(/resource\s+"aws_s3_bucket"\s+"tfstate"/);
        expect(src).toMatch(/for_each\s*=\s*toset\(var\.environments\)/);
        expect(src).toMatch(/resource\s+"aws_dynamodb_table"\s+"tfstate_lock"/);
        expect(src).toMatch(/hash_key\s*=\s*"LockID"/);
    });

    it('bootstrap state buckets have versioning + SSE + public-access block', () => {
        const src = read('infra/terraform/bootstrap/main.tf');
        expect(src).toMatch(/aws_s3_bucket_versioning/);
        expect(src).toMatch(/aws_s3_bucket_server_side_encryption_configuration/);
        expect(src).toMatch(/aws_s3_bucket_public_access_block/);
        expect(src).toMatch(/block_public_acls\s*=\s*true/);
    });

    it('bootstrap uses LOCAL state (no backend block)', () => {
        // Bootstrap creates the resources that ARE the remote state.
        // Migrating its own state to S3 would be a self-referential init.
        const src = read('infra/terraform/bootstrap/versions.tf');
        expect(src).not.toMatch(/backend\s+"/);
    });
});

describe('Epic OI-1 — child module placeholders', () => {
    const MODULES = ['vpc', 'database', 'redis', 'storage', 'secrets'];

    it.each(MODULES)('modules/%s has the canonical 3-file contract', (mod) => {
        for (const file of ['main.tf', 'variables.tf', 'outputs.tf']) {
            expect(exists(`infra/terraform/modules/${mod}/${file}`)).toBe(true);
        }
    });

    it.each(MODULES)('modules/%s declares a `tags` input', (mod) => {
        const src = read(`infra/terraform/modules/${mod}/variables.tf`);
        expect(src).toMatch(/variable\s+"tags"/);
    });

    it.each(MODULES)('modules/%s declares a `name_prefix` input', (mod) => {
        const src = read(`infra/terraform/modules/${mod}/variables.tf`);
        expect(src).toMatch(/variable\s+"name_prefix"/);
    });
});

describe('Epic OI-1 — root module composition', () => {
    it('main.tf computes a name_prefix and merges base_tags + additional_tags into common_tags', () => {
        const src = read('infra/terraform/main.tf');
        expect(src).toMatch(/locals\s*\{/);
        expect(src).toMatch(/name_prefix\s*=\s*"\$\{var\.project\}-\$\{var\.environment\}"/);
        expect(src).toMatch(/merge\(local\.base_tags,\s*var\.additional_tags\)/);
    });

    it('variables.tf validates environment is one of staging|production', () => {
        const src = read('infra/terraform/variables.tf');
        expect(src).toMatch(/contains\(\["staging",\s*"production"\],\s*var\.environment\)/);
    });

    it('outputs.tf exposes name_prefix + common_tags + environment', () => {
        const src = read('infra/terraform/outputs.tf');
        for (const out of ['name_prefix', 'common_tags', 'environment']) {
            expect(src).toMatch(new RegExp(`output\\s+"${out}"`));
        }
    });
});

describe('Epic OI-1 — secrets hygiene', () => {
    it('committed environments/*/terraform.tfvars carry no secret-shaped fields', () => {
        // Quick keyword check — the committed tfvars are documented as
        // non-sensitive only; secrets travel via TF_VAR_* env or AWS SSM.
        // We only scan NON-COMMENT lines so the file's own header
        // explanation (which can mention "password" descriptively)
        // doesn't trip the guard.
        const SECRET_TOKENS = [
            /password\s*=/i,
            /secret\s*=/i,
            /api[_-]?key\s*=/i,
            /access[_-]?key\s*=/i,
            /token\s*=/i,
        ];
        for (const env of ['staging', 'production']) {
            const src = read(`infra/terraform/environments/${env}/terraform.tfvars`)
                .split('\n')
                .filter((line) => !line.trim().startsWith('#'))
                .join('\n');
            for (const re of SECRET_TOKENS) {
                expect(src).not.toMatch(re);
            }
        }
    });

    it('infra/terraform/.gitignore excludes runtime, state, and plan artefacts', () => {
        const src = read('infra/terraform/.gitignore');
        expect(src).toMatch(/\.terraform\//);
        expect(src).toMatch(/\*\.tfstate/);
        expect(src).toMatch(/\*\.tfplan/);
        expect(src).toMatch(/\*\.secret\.tfvars/);
    });
});
