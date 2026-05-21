/**
 * Epic OI-2 — structural ratchet for the Helm-based deploy workflow.
 *
 * The workflow at `.github/workflows/deploy.yml` uses
 * `helm upgrade --install` against EKS (OI-2, replacing the SSH +
 * docker-compose path). The 2026-05-21 staging-smoke-gate change
 * then split the single deploy job into a staging→production
 * promotion and extracted the shared helm logic into the
 * `.github/actions/helm-deploy` composite action.
 *
 * This ratchet locks the load-bearing invariants:
 *
 *   - Helm is the deploy primitive (no SSH/scp/compose calls)
 *   - AWS auth via OIDC, cluster access via `aws eks update-kubeconfig`
 *   - Both deploy stages bind to a GitHub Environment (staging /
 *     production — the latter is the manual-approval gate)
 *   - `helm upgrade --install` uses --atomic + --wait + --timeout
 *   - Smoke tests are wired AFTER each deploy
 *   - Helm chart path matches the chart from OI-2
 *
 * The staging→production GATE itself (deploy-production needs
 * smoke-staging) is locked separately by `deploy-staging-gate.test.ts`.
 *
 * If one of these breaks, the diff is the design conversation.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

const ROOT = path.resolve(__dirname, '../..');
const WORKFLOW = path.join(ROOT, '.github/workflows/deploy.yml');
const HELM_ACTION = path.join(ROOT, '.github/actions/helm-deploy/action.yml');

interface WorkflowJob {
    name?: string;
    if?: string;
    needs?: string | string[];
    environment?: string;
    'runs-on'?: string;
    permissions?: Record<string, string>;
    steps?: Array<Record<string, unknown>>;
    'timeout-minutes'?: number;
}

function loadWorkflow(): { jobs: Record<string, WorkflowJob> } {
    return yaml.load(fs.readFileSync(WORKFLOW, 'utf-8')) as {
        jobs: Record<string, WorkflowJob>;
    };
}

/** Raw text of the deploy workflow. */
const text = () => fs.readFileSync(WORKFLOW, 'utf-8');
/** Raw text of the shared helm-deploy composite action. */
const actionText = () => fs.readFileSync(HELM_ACTION, 'utf-8');

function needsOf(job: WorkflowJob): string[] {
    if (!job?.needs) return [];
    return Array.isArray(job.needs) ? job.needs : [job.needs];
}

describe('OI-2 — deploy workflow file shape', () => {
    it('exists and parses as YAML', () => {
        expect(fs.existsSync(WORKFLOW)).toBe(true);
        expect(() => loadWorkflow()).not.toThrow();
    });

    it('has the six expected jobs (gate, build-image, deploy/smoke ×2)', () => {
        const wf = loadWorkflow();
        expect(Object.keys(wf.jobs).sort()).toEqual([
            'build-image',
            'deploy-production',
            'deploy-staging',
            'gate',
            'smoke-production',
            'smoke-staging',
        ]);
    });

    it('the workflow_dispatch trigger exposes environment + ref + image_tag inputs', () => {
        const src = text();
        expect(src).toMatch(/workflow_dispatch:[\s\S]*?inputs:[\s\S]*?environment:/);
        expect(src).toMatch(/options:[\s\S]*?staging[\s\S]*?production/);
        expect(src).toMatch(/ref:\s*\n\s*description:/);
        expect(src).toMatch(/image_tag:\s*\n\s*description:/);
    });

    it('global deploy concurrency group with cancel-in-progress = false', () => {
        const src = text();
        // A `production` run touches the staging environment too, so
        // the concurrency group is global (`deploy`) — two deploys
        // must never race over the staging release.
        expect(src).toMatch(/group:\s*deploy\s*$/m);
        expect(src).toMatch(/cancel-in-progress:\s*false/);
    });
});

describe('OI-2 — Helm is the deploy primitive (no SSH/compose)', () => {
    it('contains NO appleboy/ssh-action references', () => {
        expect(text()).not.toMatch(/appleboy\/ssh-action/);
        expect(actionText()).not.toMatch(/appleboy\/ssh-action/);
    });

    it('contains NO `docker compose` deploy commands in run steps', () => {
        for (const src of [text(), actionText()]) {
            const codeOnly = src
                .split('\n')
                .filter((line) => !line.trim().startsWith('#'))
                .join('\n');
            expect(codeOnly).not.toMatch(/docker\s+compose\s+(?:up|down|restart|pull)/);
            expect(codeOnly).not.toMatch(/docker-compose\.\w+\.yml/);
        }
    });

    it('contains NO references to the legacy DEPLOY_HOST / DEPLOY_USER / DEPLOY_SSH_KEY secrets', () => {
        const src = text();
        for (const legacy of [
            'DEPLOY_HOST',
            'DEPLOY_USER',
            'DEPLOY_SSH_KEY',
            'DEPLOY_PATH',
        ]) {
            expect(src).not.toMatch(new RegExp(`secrets\\.${legacy}\\b|secrets\\['${legacy}'\\]`));
        }
    });

    it('uses `helm upgrade --install` as the deploy command (in the composite action)', () => {
        expect(actionText()).toMatch(/helm upgrade --install/);
    });
});

describe('OI-2 — deploy job invariants', () => {
    it('both deploy stages bind to a GitHub Environment (production = required-reviewer gate)', () => {
        const wf = loadWorkflow();
        expect(wf.jobs['deploy-staging']?.environment).toBe('staging');
        expect(wf.jobs['deploy-production']?.environment).toBe('production');
    });

    it('deploy stages use OIDC (id-token: write) and assume secrets.AWS_ROLE_TO_ASSUME', () => {
        const wf = loadWorkflow();
        expect(wf.jobs['deploy-staging'].permissions?.['id-token']).toBe('write');
        expect(wf.jobs['deploy-production'].permissions?.['id-token']).toBe('write');
        expect(text()).toMatch(/aws-role:\s*\$\{\{\s*secrets\.AWS_ROLE_TO_ASSUME\s*\}\}/);
    });

    it('the helm-deploy action uses configure-aws-credentials@v6 + azure/setup-helm@v4', () => {
        const src = actionText();
        expect(src).toMatch(/aws-actions\/configure-aws-credentials@v6/);
        expect(src).toMatch(/azure\/setup-helm@v4/);
    });

    it('updates kubeconfig via `aws eks update-kubeconfig`', () => {
        expect(actionText()).toMatch(/aws eks update-kubeconfig/);
    });

    it('passes the per-env values file to helm upgrade', () => {
        // `--values <chart>/values-<environment>.yaml` — the per-env
        // values files MUST be the source of env-specific config.
        expect(actionText()).toMatch(
            /--values\s+"\$\{\{\s*inputs\.chart-path\s*\}\}\/values-\$\{\{\s*inputs\.environment\s*\}\}\.yaml"/,
        );
    });

    it('helm upgrade is --atomic + --wait + --timeout', () => {
        const src = actionText();
        expect(src).toMatch(/--atomic/);
        expect(src).toMatch(/--wait/);
        expect(src).toMatch(/--timeout/);
    });

    it('helm upgrade pins the image tag passed from the workflow', () => {
        // The action sets image.tag from its input; deploy.yml feeds
        // that input from the gate job's resolved tag.
        expect(actionText()).toMatch(/--set image\.tag="\$\{\{\s*inputs\.image-tag\s*\}\}"/);
        expect(text()).toMatch(/image-tag:\s*\$\{\{\s*needs\.gate\.outputs\.image-tag\s*\}\}/);
    });

    it('does a `helm lint` + `--dry-run` BEFORE the real helm upgrade', () => {
        const src = actionText();
        expect(src).toMatch(/helm lint\s+"\$\{\{\s*inputs\.chart-path/);
        expect(src).toMatch(/--dry-run/);
    });

    it('keeps Helm history (history-max) so `helm rollback` has revisions to roll back to', () => {
        expect(actionText()).toMatch(/--history-max/);
    });

    it('emits a rollout summary including helm history + pods + the rollback command hint', () => {
        const src = actionText();
        expect(src).toMatch(/helm history/);
        expect(src).toMatch(/helm rollback/);
        expect(src).toMatch(/kubectl[\s\S]*?get pods/);
    });
});

describe('OI-2 — smoke tests preserved after each deploy', () => {
    it('staging + production smoke jobs run AFTER their deploy', () => {
        const wf = loadWorkflow();
        expect(needsOf(wf.jobs['smoke-staging'])).toContain('deploy-staging');
        expect(needsOf(wf.jobs['smoke-production'])).toContain('deploy-production');
    });

    it('smoke jobs call scripts/smoke-prod.mjs', () => {
        expect(text()).toMatch(/node\s+scripts\/smoke-prod\.mjs/);
    });

    it('smoke jobs bind to their matching GitHub Environment', () => {
        const wf = loadWorkflow();
        expect(wf.jobs['smoke-staging']?.environment).toBe('staging');
        expect(wf.jobs['smoke-production']?.environment).toBe('production');
    });

    it('SMOKE_URL comes from the env-scoped GitHub variable, not hardcoded', () => {
        const src = text();
        expect(src).toMatch(/SMOKE_URL:\s*\$\{\{\s*vars\.SMOKE_URL\s*\}\}/);
        const codeOnly = src
            .split('\n')
            .filter((l) => !l.trim().startsWith('#'))
            .join('\n');
        expect(codeOnly).not.toMatch(/SMOKE_URL:\s*https:\/\//);
    });

    it('preserves the smoke retries / timeout knobs', () => {
        const src = text();
        expect(src).toMatch(/SMOKE_RETRIES:\s*"\d+"/);
        expect(src).toMatch(/SMOKE_RETRY_DELAY:\s*"\d+"/);
        expect(src).toMatch(/SMOKE_TIMEOUT_MS:\s*"\d+"/);
    });
});

describe('OI-2 — chart path + naming convention', () => {
    it('CHART_PATH points at infra/helm/inflect (the OI-2 chart)', () => {
        expect(text()).toMatch(/CHART_PATH:\s*infra\/helm\/inflect/);
    });

    it('release name + namespace follow the inflect-<env> convention (matches values files)', () => {
        const src = text();
        // deploy-staging / deploy-production pass inflect-<env> as the
        // release name + namespace to the helm-deploy action.
        expect(src).toMatch(/release-name:\s*inflect-staging/);
        expect(src).toMatch(/namespace:\s*inflect-staging/);
        expect(src).toMatch(/release-name:\s*inflect-production/);
        expect(src).toMatch(/namespace:\s*inflect-production/);
    });
});

describe('OI-2 — docs/deployment.md has the OI-2 sections', () => {
    const DOC = path.join(ROOT, 'docs/deployment.md');
    const doc = () => fs.readFileSync(DOC, 'utf-8');

    it.each([
        '## Kubernetes (Helm)',
        '### Deploying',
        '### Rollback via `helm rollback`',
        '### Scaling',
        '### Secret rotation',
    ])('contains the section: %s', (heading) => {
        expect(doc()).toContain(heading);
    });

    it('rollback section enumerates the safety semantics (re-runs vs not, expand-and-contract)', () => {
        const src = doc();
        expect(src).toMatch(/expand[\s-]and[\s-]contract/i);
        expect(src).toMatch(/migration Job is one-way|hooks?\s+are\s+\*?\*?NOT\*?\*?\s+re-run/i);
    });

    it('secret-rotation section explicitly notes the rollout-restart requirement', () => {
        expect(doc()).toMatch(/rollout restart/);
    });

    it('scaling section covers BOTH HPA-managed app and manually-scaled worker', () => {
        const src = doc();
        expect(src).toMatch(/autoscaling\.minReplicas/);
        expect(src).toMatch(/worker\.replicaCount/);
    });
});
