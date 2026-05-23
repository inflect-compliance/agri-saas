/**
 * Epic OI-1 (part 5) — structural ratchet for the secrets module
 * and the runtime-secret-resolution surface.
 *
 * Locks:
 *   - DATA_ENCRYPTION_KEY is generated via random_id with byte_length=32
 *     (32 bytes of crypto-secure entropy → 64-char hex)
 *   - All four generated secrets (DATA_ENCRYPTION_KEY, AUTH_SECRET,
 *     JWT_SECRET, AV_WEBHOOK_SECRET) use random_id (not random_password)
 *     for crypto-grade material
 *   - OAuth placeholder secrets use lifecycle.ignore_changes on
 *     secret_string so operator's value isn't drift-reverted
 *   - IAM policy uses GetSecretValue + DescribeSecret on SPECIFIC ARNs
 *     (no `*` wildcard)
 *   - additional_secret_arns variable exists so DB + Redis secrets
 *     can be aggregated into the runtime read policy
 *   - Root composition wires module.database.secret_arn AND
 *     module.redis.auth_secret_arn into module.secrets
 *   - Root outputs surface secret_names + access policy
 *   - bootstrap-env-from-secrets.sh exists and references the
 *     correct secret-name pattern
 *   - deploy/.env.prod.example no longer carries plaintext secret
 *     placeholders for the 5 migrated secrets
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));

const SECRETS_MAIN = 'infra/terraform/modules/secrets/main.tf';
const SECRETS_VARS = 'infra/terraform/modules/secrets/variables.tf';
const SECRETS_OUT = 'infra/terraform/modules/secrets/outputs.tf';
const ROOT_MAIN = 'infra/terraform/main.tf';
const ROOT_OUT = 'infra/terraform/outputs.tf';
const BOOTSTRAP_SCRIPT = 'scripts/bootstrap-env-from-secrets.sh';
const ENV_PROD_EXAMPLE = 'deploy/.env.prod.example';

describe('OI-1 part 5 — secrets module file shape', () => {
    it.each([
        SECRETS_MAIN,
        SECRETS_VARS,
        SECRETS_OUT,
    ])('%s exists', (rel) => {
        expect(exists(rel)).toBe(true);
    });
});

describe('OI-1 part 5 — generated secrets are crypto-grade', () => {
    it.each([
        'data_encryption_key',
        'auth_secret',
        'jwt_secret',
        'av_webhook_secret',
    ])('random_id "%s" uses byte_length = 32', (name) => {
        const src = read(SECRETS_MAIN);
        const block = src.match(
            new RegExp(`resource\\s+"random_id"\\s+"${name}"\\s*\\{[\\s\\S]*?\\n\\}`),
        );
        expect(block).toBeTruthy();
        expect(block![0]).toMatch(/byte_length\s*=\s*32/);
    });

    it('does NOT use random_password for crypto material (lower entropy guarantee)', () => {
        const src = read(SECRETS_MAIN);
        // random_password would only be acceptable if length >= 32 with
        // an explicit charset that gives full byte entropy. Easier to
        // require random_id and forbid random_password in this module.
        expect(src).not.toMatch(/resource\s+"random_password"/);
    });

    it('exposes the generated value via .hex (matches app expectation of 64-char hex)', () => {
        const src = read(SECRETS_MAIN);
        for (const name of [
            'data_encryption_key',
            'auth_secret',
            'jwt_secret',
            'av_webhook_secret',
        ]) {
            expect(src).toMatch(new RegExp(`random_id\\.${name}\\.hex`));
        }
    });
});

describe('OI-1 part 5 — operator-supplied secrets', () => {
    it.each([
        'google_client_secret',
        'microsoft_client_secret',
    ])('"%s" version uses lifecycle.ignore_changes on secret_string', (name) => {
        const src = read(SECRETS_MAIN);
        const block = src.match(
            new RegExp(
                `resource\\s+"aws_secretsmanager_secret_version"\\s+"${name}"\\s*\\{[\\s\\S]*?\\n\\}`,
            ),
        );
        expect(block).toBeTruthy();
        expect(block![0]).toMatch(/lifecycle\s*\{[\s\S]*?ignore_changes\s*=\s*\[secret_string\]/);
    });

    it('placeholder values clearly mark themselves so a deploy with them fails fast', () => {
        const src = read(SECRETS_MAIN);
        // Both OAuth secret versions ship with a sentinel string the
        // bootstrap script can detect and refuse to deploy with.
        expect(src).toMatch(/PLACEHOLDER_set_via_aws_secretsmanager_put-secret-value/);
    });
});

describe('OI-1 part 5 — IAM policy surface', () => {
    it('uses GetSecretValue + DescribeSecret only (no admin actions)', () => {
        const src = read(SECRETS_MAIN);
        const policyDoc = src.match(
            /data\s+"aws_iam_policy_document"\s+"runtime_secrets_read"\s*\{[\s\S]*?\n\}/,
        );
        expect(policyDoc).toBeTruthy();
        const block = policyDoc![0];

        // Allowed actions are exactly these two. No put/update/rotate.
        expect(block).toMatch(/"secretsmanager:GetSecretValue"/);
        expect(block).toMatch(/"secretsmanager:DescribeSecret"/);
        expect(block).not.toMatch(/"secretsmanager:PutSecretValue"/);
        expect(block).not.toMatch(/"secretsmanager:UpdateSecret"/);
        expect(block).not.toMatch(/"secretsmanager:DeleteSecret"/);
        expect(block).not.toMatch(/"secretsmanager:RotateSecret"/);
        expect(block).not.toMatch(/"secretsmanager:\*"/);
    });

    it('resources are specific ARNs, NOT a `*` wildcard', () => {
        const src = read(SECRETS_MAIN);
        const policyDoc = src.match(
            /data\s+"aws_iam_policy_document"\s+"runtime_secrets_read"\s*\{[\s\S]*?\n\}/,
        );
        expect(policyDoc).toBeTruthy();
        const block = policyDoc![0];
        // Resources field reads from local.all_secret_arns (which is a
        // concat of module ARNs + additional_secret_arns) — never `*`.
        expect(block).toMatch(/resources\s*=\s*local\.all_secret_arns/);
        expect(block).not.toMatch(/resources\s*=\s*\["?\*"?\]/);
    });

    it('aggregates module-internal + additional secret ARNs', () => {
        const src = read(SECRETS_MAIN);
        // local.all_secret_arns = concat(local.module_secret_arns, var.additional_secret_arns)
        expect(src).toMatch(
            /all_secret_arns\s*=\s*concat\(local\.module_secret_arns,\s*var\.additional_secret_arns\)/,
        );
    });

    it('module_secret_arns lists exactly the 6 secrets created here', () => {
        const src = read(SECRETS_MAIN);
        const local = src.match(/module_secret_arns\s*=\s*\[[\s\S]*?\]/);
        expect(local).toBeTruthy();
        const block = local![0];
        for (const name of [
            'data_encryption_key',
            'auth_secret',
            'jwt_secret',
            'av_webhook_secret',
            'google_client_secret',
            'microsoft_client_secret',
        ]) {
            expect(block).toMatch(
                new RegExp(`aws_secretsmanager_secret\\.${name}\\.arn`),
            );
        }
    });

    it('exposes additional_secret_arns variable for DB + Redis secrets to chain in', () => {
        const src = read(SECRETS_VARS);
        expect(src).toMatch(/variable\s+"additional_secret_arns"/);
    });
});

describe('OI-1 part 5 — outputs', () => {
    it('exposes secret_names map (env-var name → AWS secret name)', () => {
        const src = read(SECRETS_OUT);
        expect(src).toMatch(/output\s+"secret_names"/);
        for (const name of [
            'DATA_ENCRYPTION_KEY',
            'AUTH_SECRET',
            'JWT_SECRET',
            'AV_WEBHOOK_SECRET',
            'GOOGLE_CLIENT_SECRET',
            'MICROSOFT_CLIENT_SECRET',
        ]) {
            expect(src).toContain(name);
        }
    });

    it('exposes runtime_secrets_read_policy_arn', () => {
        const src = read(SECRETS_OUT);
        expect(src).toMatch(/output\s+"runtime_secrets_read_policy_arn"/);
    });

    it('exposes all_runtime_secret_arns for blast-radius auditing', () => {
        const src = read(SECRETS_OUT);
        expect(src).toMatch(/output\s+"all_runtime_secret_arns"/);
    });
});

describe('OI-1 part 5 — root composition wiring', () => {
    it('main.tf instantiates module "secrets"', () => {
        const src = read(ROOT_MAIN);
        expect(src).toMatch(/module\s+"secrets"\s*\{/);
    });

    it('passes DB master-creds ARN AND Redis AUTH ARN as additional_secret_arns', () => {
        const src = read(ROOT_MAIN);
        const secretsBlock = src.match(/module\s+"secrets"\s*\{[\s\S]*?\n\}/);
        expect(secretsBlock).toBeTruthy();
        const block = secretsBlock![0];
        expect(block).toMatch(/additional_secret_arns\s*=\s*\[/);
        expect(block).toMatch(/module\.database\.secret_arn/);
        expect(block).toMatch(/module\.redis\.auth_secret_arn/);
    });

    it('outputs.tf surfaces runtime_secret_names and runtime_secrets_read_policy_arn', () => {
        const src = read(ROOT_OUT);
        expect(src).toMatch(/output\s+"runtime_secret_names"/);
        expect(src).toMatch(/output\s+"runtime_secrets_read_policy_arn"/);
    });
});

describe('OI-1 part 5 — bootstrap script + de-emphasized plaintext model', () => {
    it('scripts/bootstrap-env-from-secrets.sh exists and is executable', () => {
        expect(exists(BOOTSTRAP_SCRIPT)).toBe(true);
        const stat = fs.statSync(path.join(ROOT, BOOTSTRAP_SCRIPT));
        // Owner-execute bit set

        expect((stat.mode & 0o100) !== 0).toBe(true);
    });

    it('bootstrap script fetches all 6 module-internal secrets + RDS + Redis', () => {
        const src = read(BOOTSTRAP_SCRIPT);
        // Generated secrets fetched by suffix
        for (const suffix of [
            'data-encryption-key',
            'auth-secret',
            'jwt-secret',
            'av-webhook-secret',
            'google-client-secret',
            'microsoft-client-secret',
        ]) {
            expect(src).toMatch(
                new RegExp(`fetch_secret\\s+"\\$\\{ENV_PREFIX\\}-${suffix}"`),
            );
        }
        // Chained secrets fetched by full name
        expect(src).toMatch(/fetch_secret\s+"\$RDS_SECRET_NAME"/);
        expect(src).toMatch(/fetch_secret\s+"\$REDIS_SECRET_NAME"/);
    });

    it('bootstrap script refuses to deploy when an OAuth placeholder is unfilled', () => {
        const src = read(BOOTSTRAP_SCRIPT);
        expect(src).toMatch(/PLACEHOLDER_set_via_aws_secretsmanager/);
        // Final defence-in-depth grep
        expect(src).toMatch(/grep -q PLACEHOLDER/);
    });

    it('writes .env.runtime with mode 0600 atomically', () => {
        const src = read(BOOTSTRAP_SCRIPT);
        expect(src).toMatch(/install -m 0600/);
    });

    it('deploy/.env.prod.example no longer carries plaintext secret PLACEHOLDERs for migrated secrets', () => {
        const src = read(ENV_PROD_EXAMPLE);
        // Lines that previously assigned each secret to a plaintext
        // placeholder must now be absent. Only NON-COMMENT lines
        // matter — the deprecation header explains the model.
        const nonComment = src
            .split('\n')
            .filter((l) => !l.trim().startsWith('#'))
            .join('\n');

        for (const removed of [
            /^DATA_ENCRYPTION_KEY=/m,
            /^AUTH_SECRET=/m,
            /^JWT_SECRET=/m,
            /^AV_WEBHOOK_SECRET=/m,
            /^GOOGLE_CLIENT_SECRET=/m,
            /^MICROSOFT_CLIENT_SECRET=/m,
            // Old DATABASE_URL embedded the password literal
            /^DATABASE_URL=postgresql:\/\/postgres:REPLACE_ME/m,
        ]) {
            expect(nonComment).not.toMatch(removed);
        }
    });

    it('deploy/.env.prod.example carries the deprecation banner pointing at Secrets Manager', () => {
        const src = read(ENV_PROD_EXAMPLE);
        expect(src).toMatch(/DEPRECATED/);
        expect(src).toMatch(/AWS Secrets Manager/);
        expect(src).toMatch(/bootstrap-env-from-secrets\.sh/);
    });
});

describe('OI-1 part 5 — comprehensive infrastructure doc', () => {
    it('docs/infrastructure.md exists with the expected sections', () => {
        const file = 'docs/infrastructure.md';
        expect(exists(file)).toBe(true);
        const src = read(file);
        // Sections required by the OI-1 spec
        for (const heading of [
            '## Architecture overview',
            '## Module inventory',
            '## Environment model',
            '## Secret management',
            '## Cost estimate',
        ]) {
            expect(src).toContain(heading);
        }
    });

    it('infrastructure doc enumerates every module in the inventory', () => {
        const src = read('docs/infrastructure.md');
        for (const mod of ['vpc', 'database', 'redis', 'storage', 'secrets']) {
            expect(src).toMatch(new RegExp(`\\| \`${mod}\` \\|`));
        }
    });
});
