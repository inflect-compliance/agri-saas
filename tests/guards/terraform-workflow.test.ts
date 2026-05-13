/**
 * Epic OI-1 (part 4) — structural ratchet for the Terraform CI
 * workflow.
 *
 * Locks the gating model so the OI-1 source-of-truth invariants
 * cannot drift silently in `.github/workflows/terraform.yml`:
 *
 *   - plan runs on PR (visible in PR comment)
 *   - staging auto-applies on push to main
 *   - production requires the GitHub Environment's required-reviewers
 *     gate (we can't assert reviewers exist from here, but we CAN
 *     assert the job uses `environment: production` — the only
 *     mechanism by which GitHub enforces the gate)
 *   - apply jobs use OIDC (id-token: write) and assume an
 *     environment-scoped role secret — no plaintext AWS keys
 *   - path filters scope the workflow to infra/terraform/**
 *   - production apply does NOT auto-run on dispatch=staging,
 *     and staging apply does NOT auto-run on dispatch=production
 *
 * If one of these breaks, the diff is the design conversation.
 * Update this test in the same PR that justifies the change.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

const WORKFLOW = path.resolve(
    __dirname,
    '../../.github/workflows/terraform.yml',
);

interface WorkflowJob {
    name?: string;
    if?: string;
    needs?: string | string[];
    environment?: string;
    'runs-on'?: string;
    permissions?: Record<string, string>;
    concurrency?: { group: string; 'cancel-in-progress'?: boolean };
    strategy?: {
        matrix?: { environment?: string[] } & Record<string, unknown>;
        'fail-fast'?: boolean;
    };
    steps?: Array<Record<string, unknown>>;
    'timeout-minutes'?: number;
}

interface Workflow {
    name: string;
    on: Record<string, unknown>;
    permissions?: Record<string, string>;
    env?: Record<string, string>;
    jobs: Record<string, WorkflowJob>;
}

function loadWorkflow(): Workflow {
    const text = fs.readFileSync(WORKFLOW, 'utf-8');
    return yaml.load(text) as Workflow;
}

describe('OI-1 part 4 — Terraform workflow file shape', () => {
    it('the workflow file exists and parses as YAML', () => {
        expect(fs.existsSync(WORKFLOW)).toBe(true);
        expect(() => loadWorkflow()).not.toThrow();
    });

    it('triggers on pull_request, push to main, and workflow_dispatch', () => {
        const wf = loadWorkflow();
        // js-yaml interprets bare `on:` as the boolean `true` because
        // YAML 1.1 treats `on/off/yes/no` as booleans. The workflow
        // text uses `on:` so the loaded key is the string `true` (key)
        // mapping to the trigger object. We accept either.
        const onKey = (wf as unknown as { on?: unknown; true?: unknown }).on
            ?? (wf as unknown as { true?: unknown }).true;
        const triggers = onKey as Record<string, unknown>;
        expect(triggers).toBeTruthy();
        expect(triggers.pull_request).toBeTruthy();
        expect(triggers.push).toBeTruthy();
        expect(triggers.workflow_dispatch).toBeTruthy();
    });

    it('path-filters PRs and pushes to infra/terraform/**', () => {
        const text = fs.readFileSync(WORKFLOW, 'utf-8');
        // Verified textually — yaml round-trip can reorder keys.
        expect(text).toMatch(/paths:\s*\n\s*-\s*"infra\/terraform\/\*\*"/);
        expect(text).toMatch(/paths:\s*\n\s*-\s*"infra\/terraform\/\*\*"/);
    });

    it('exposes a workflow_dispatch input with staging + production options', () => {
        const text = fs.readFileSync(WORKFLOW, 'utf-8');
        expect(text).toMatch(/workflow_dispatch:[\s\S]*?inputs:[\s\S]*?environment:/);
        expect(text).toMatch(/options:[\s\S]*?staging[\s\S]*?production/);
    });
});

describe('OI-1 part 4 — fmt + validate gate', () => {
    it('has a job that runs terraform fmt -check + validate', () => {
        const wf = loadWorkflow();
        const job = wf.jobs['fmt-validate'];
        expect(job).toBeTruthy();
        const stepText = JSON.stringify(job.steps);
        expect(stepText).toMatch(/terraform fmt -check/);
        expect(stepText).toMatch(/terraform validate/);
        expect(stepText).toMatch(/terraform init -backend=false/);
    });
});

describe('OI-1 part 4 — Plan-on-PR + comment visibility', () => {
    it('plan job runs only on PRs and only for non-fork PRs', () => {
        const wf = loadWorkflow();
        const job = wf.jobs.plan;
        expect(job).toBeTruthy();
        expect(job.if).toMatch(/github\.event_name == 'pull_request'/);
        expect(job.if).toMatch(/head\.repo\.fork == false/);
    });

    it('plan job is matrixed across staging + production', () => {
        const wf = loadWorkflow();
        const job = wf.jobs.plan;
        expect(job.strategy?.matrix?.environment).toEqual(['staging', 'production']);
        // Both must plan even if one fails
        expect(job.strategy?.['fail-fast']).toBe(false);
    });

    it('plan job uses OIDC (id-token: write) and pull-requests: write for the comment', () => {
        const wf = loadWorkflow();
        const job = wf.jobs.plan;
        expect(job.permissions?.['id-token']).toBe('write');
        expect(job.permissions?.['pull-requests']).toBe('write');
    });

    it('plan job is bound to a per-matrix GitHub Environment for OIDC scoping', () => {
        const wf = loadWorkflow();
        const job = wf.jobs.plan;
        expect(job.environment).toMatch(/matrix\.environment/);
    });

    it('plan output is captured into a file the comment step can read', () => {
        const wf = loadWorkflow();
        const stepText = JSON.stringify(wf.jobs.plan.steps);
        expect(stepText).toMatch(/terraform plan[\s\S]*?-out=tfplan/);
        expect(stepText).toMatch(/terraform show -no-color tfplan/);
    });

    it('plan output is posted to the PR via github-script with a sticky marker', () => {
        const text = fs.readFileSync(WORKFLOW, 'utf-8');
        expect(text).toMatch(/actions\/github-script@v7/);
        // Sticky marker per env so two plan comments don't overwrite each other
        expect(text).toMatch(/<!-- terraform-plan:\$\{env\} -->/);
        // Find-and-update or create
        expect(text).toMatch(/issues\.updateComment/);
        expect(text).toMatch(/issues\.createComment/);
    });

    it('plan output is also written to GITHUB_STEP_SUMMARY for run-page visibility', () => {
        const text = fs.readFileSync(WORKFLOW, 'utf-8');
        expect(text).toMatch(/\$GITHUB_STEP_SUMMARY/);
    });
});

describe('OI-1 part 4 — apply gating model', () => {
    it('staging apply runs on push-to-main OR dispatch=staging', () => {
        const wf = loadWorkflow();
        const job = wf.jobs['apply-staging'];
        expect(job).toBeTruthy();
        expect(job.if).toMatch(/github\.event_name == 'push'/);
        expect(job.if).toMatch(/refs\/heads\/main/);
        expect(job.if).toMatch(/inputs\.environment == 'staging'/);
    });

    it('staging apply binds to environment: staging (auto, no required reviewers)', () => {
        const wf = loadWorkflow();
        const job = wf.jobs['apply-staging'];
        expect(job.environment).toBe('staging');
    });

    it('production apply binds to environment: production (the manual-approval gate)', () => {
        const wf = loadWorkflow();
        const job = wf.jobs['apply-production'];
        expect(job).toBeTruthy();
        // The ONLY mechanism by which GitHub enforces a manual gate is
        // an `environment:` reference. Required-reviewers are configured
        // on the environment in repo settings.
        expect(job.environment).toBe('production');
    });

    it('production apply on push waits for staging to succeed first (canary)', () => {
        const wf = loadWorkflow();
        const job = wf.jobs['apply-production'];
        const needs = Array.isArray(job.needs) ? job.needs : [job.needs];
        expect(needs).toContain('apply-staging');
        // The if-expression must require apply-staging.result == 'success' on push
        expect(job.if).toMatch(/needs\.apply-staging\.result == 'success'/);
    });

    it('production apply via workflow_dispatch does NOT require staging first (escape hatch)', () => {
        const wf = loadWorkflow();
        const job = wf.jobs['apply-production'];
        // The if has TWO branches: push (gated on staging) OR dispatch=production
        // (no staging dependency). Locked by checking the dispatch arm.
        expect(job.if).toMatch(/inputs\.environment == 'production'/);
        // And the always() wrapper that prevents the job from being
        // skipped just because apply-staging was skipped on dispatch.
        expect(job.if).toMatch(/always\(\)/);
    });

    it('apply jobs use OIDC and per-env concurrency groups', () => {
        const wf = loadWorkflow();
        for (const j of ['apply-staging', 'apply-production']) {
            const job = wf.jobs[j];
            expect(job.permissions?.['id-token']).toBe('write');
            expect(job.concurrency?.group).toBe(`terraform-${j.replace('apply-', '')}`);
            // Never cancel an in-progress apply
            expect(job.concurrency?.['cancel-in-progress']).toBe(false);
        }
    });
});

describe('OI-1 part 4 — secret hygiene', () => {
    it('uses AWS_ROLE_TO_ASSUME from env-scoped GitHub secret (not plaintext)', () => {
        const text = fs.readFileSync(WORKFLOW, 'utf-8');
        // The role ARN must come from secrets, not be hardcoded
        expect(text).toMatch(/role-to-assume:\s*\$\{\{\s*secrets\.AWS_ROLE_TO_ASSUME\s*\}\}/);
        // No long-lived AWS credential pairs in the workflow file
        expect(text).not.toMatch(/AWS_ACCESS_KEY_ID:\s*\S/);
        expect(text).not.toMatch(/AWS_SECRET_ACCESS_KEY:\s*\S/);
    });

    it('no hardcoded ARN, no inline access keys', () => {
        const text = fs.readFileSync(WORKFLOW, 'utf-8');
        // arn:aws:iam:: is fine in COMMENTS; check it never appears as a value
        const lines = text.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('#')) continue;
            // Disallow inline ARN values (would mean a hardcoded role)
            expect(trimmed).not.toMatch(/role-to-assume:\s*arn:aws:iam::/);
        }
    });

    it('uses configure-aws-credentials@v6 (latest stable)', () => {
        const text = fs.readFileSync(WORKFLOW, 'utf-8');
        expect(text).toMatch(/aws-actions\/configure-aws-credentials@v6/);
    });
});

describe('OI-1 part 4 — environment directory layout', () => {
    it.each(['staging', 'production'])(
        'environments/%s/{backend.hcl,terraform.tfvars,README.md} exist',
        (env) => {
            const root = path.resolve(__dirname, '../..');
            for (const file of ['backend.hcl', 'terraform.tfvars', 'README.md']) {
                expect(
                    fs.existsSync(
                        path.join(root, 'infra/terraform/environments', env, file),
                    ),
                ).toBe(true);
            }
        },
    );

    it('the legacy infra/terraform/envs/ flat layout is gone', () => {
        const root = path.resolve(__dirname, '../..');
        expect(fs.existsSync(path.join(root, 'infra/terraform/envs'))).toBe(false);
    });
});
