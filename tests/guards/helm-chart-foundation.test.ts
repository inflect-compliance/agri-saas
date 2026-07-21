/**
 * Epic OI-2 — structural ratchet for the Helm chart foundation.
 *
 * Locks the shape of `infra/helm/inflect/` so the OI-2 source-of-truth
 * invariants cannot drift silently:
 *
 *   - Canonical files (Chart.yaml, values.yaml, _helpers.tpl,
 *     deployment.yaml) exist
 *   - Chart.yaml::appVersion stays in lock-step with package.json::version
 *   - Resource defaults match the OI-2 spec (req 1 CPU / 512Mi mem,
 *     lim 2 CPU / 1Gi mem)
 *   - Liveness probe hits /api/livez; readiness hits /api/readyz
 *   - Deployment uses envFrom with BOTH configMapRef AND secretRef
 *   - Selector labels are stable (the immutable-on-Deployment subset)
 *   - The image helper falls back to .Chart.AppVersion when tag is empty
 *
 * If one of these breaks, the diff is the design conversation. Update
 * this test in the same PR that justifies the change.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- this file
 * exclusively reads yaml fixtures via `yaml.load(...) as ...` and walks
 * deeply-nested helm chart values (autoscaling.behavior.scaleDown,
 * ingress.hsts.maxAgeSeconds, networkPolicy.allowHttpsEgress, etc.).
 * Each assertion picks one key out of a 50+-field schema; defining a
 * complete typed `HelmValues` interface would be 200+ lines of
 * single-use type for zero functional gain. The `any` is honest:
 * yaml.load returns `unknown`, and the access paths are correct by
 * test failure rather than by structural type. */
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

const ROOT = path.resolve(__dirname, '../..');
const CHART_DIR = 'infra/helm/inflect';

const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));

describe('OI-2 — Helm chart canonical files', () => {
    it.each([
        `${CHART_DIR}/Chart.yaml`,
        `${CHART_DIR}/values.yaml`,
        `${CHART_DIR}/values-staging.yaml`,
        `${CHART_DIR}/values-production.yaml`,
        `${CHART_DIR}/templates/_helpers.tpl`,
        `${CHART_DIR}/templates/deployment.yaml`,
        `${CHART_DIR}/templates/worker.yaml`,
        `${CHART_DIR}/templates/migration-job.yaml`,
        `${CHART_DIR}/templates/hpa.yaml`,
        `${CHART_DIR}/templates/service.yaml`,
        `${CHART_DIR}/templates/networkpolicy.yaml`,
        `${CHART_DIR}/templates/ingress.yaml`,
        `${CHART_DIR}/.helmignore`,
        `${CHART_DIR}/README.md`,
    ])('%s exists', (rel) => {
        expect(exists(rel)).toBe(true);
    });
});

describe('OI-2 — Chart.yaml metadata', () => {
    it('parses as YAML with the required fields', () => {
        const chart = yaml.load(read(`${CHART_DIR}/Chart.yaml`)) as Record<string, unknown>;
        expect(chart.apiVersion).toBe('v2');
        expect(chart.name).toBe('inflect');
        expect(chart.type).toBe('application');
        expect(typeof chart.version).toBe('string');
        expect(typeof chart.appVersion).toBe('string');
    });

    it('chart version is SemVer', () => {
        const chart = yaml.load(read(`${CHART_DIR}/Chart.yaml`)) as { version: string };
        expect(chart.version).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/);
    });

    it('appVersion matches package.json::version (drift would mean misaligned image tags)', () => {
        const chart = yaml.load(read(`${CHART_DIR}/Chart.yaml`)) as { appVersion: string };
        const pkg = JSON.parse(read('package.json')) as { version: string };
        expect(chart.appVersion).toBe(pkg.version);
    });
});

describe('OI-2 — values.yaml defaults', () => {
    it('parses as YAML', () => {
        expect(() => yaml.load(read(`${CHART_DIR}/values.yaml`))).not.toThrow();
    });

    it('declares image.repository, image.tag (empty default), image.pullPolicy', () => {
        const v = yaml.load(read(`${CHART_DIR}/values.yaml`)) as Record<string, any>;
        expect(v.image).toBeDefined();
        expect(typeof v.image.repository).toBe('string');
        expect(v.image.repository.length).toBeGreaterThan(0);
        // Tag empty → helper falls back to AppVersion. Lock the empty
        // default so a hardcoded tag isn't silently introduced.
        expect(v.image.tag).toBe('');
        expect(v.image.pullPolicy).toBe('IfNotPresent');
    });

    it('container port is 3000 (matches OI-1 vpc app_ingress_port default)', () => {
        const v = yaml.load(read(`${CHART_DIR}/values.yaml`)) as { containerPort: number };
        expect(v.containerPort).toBe(3000);
    });

    it('resources.requests = 1 CPU, 512Mi memory (OI-2 spec)', () => {
        const v = yaml.load(read(`${CHART_DIR}/values.yaml`)) as { resources: any };
        expect(String(v.resources.requests.cpu)).toBe('1');
        expect(v.resources.requests.memory).toBe('512Mi');
    });

    it('resources.limits = 2 CPU, 1Gi memory (OI-2 spec)', () => {
        const v = yaml.load(read(`${CHART_DIR}/values.yaml`)) as { resources: any };
        expect(String(v.resources.limits.cpu)).toBe('2');
        expect(v.resources.limits.memory).toBe('1Gi');
    });

    it('liveness probe path is /api/livez', () => {
        const v = yaml.load(read(`${CHART_DIR}/values.yaml`)) as { livenessProbe: any };
        expect(v.livenessProbe.httpGet.path).toBe('/api/livez');
        expect(v.livenessProbe.httpGet.port).toBe('http');
    });

    it('readiness probe path is /api/readyz', () => {
        const v = yaml.load(read(`${CHART_DIR}/values.yaml`)) as { readinessProbe: any };
        expect(v.readinessProbe.httpGet.path).toBe('/api/readyz');
        expect(v.readinessProbe.httpGet.port).toBe('http');
    });

    it('envFrom declares BOTH configMap AND secret with enabled=true', () => {
        const v = yaml.load(read(`${CHART_DIR}/values.yaml`)) as { envFrom: any };
        expect(v.envFrom.configMap.enabled).toBe(true);
        expect(v.envFrom.secret.enabled).toBe(true);
    });

    it('non-root podSecurityContext is set by default', () => {
        const v = yaml.load(read(`${CHART_DIR}/values.yaml`)) as { podSecurityContext: any };
        expect(v.podSecurityContext.runAsNonRoot).toBe(true);
        expect(typeof v.podSecurityContext.runAsUser).toBe('number');
    });
});

describe('OI-2 — _helpers.tpl exports the expected helpers', () => {
    it.each([
        'inflect.name',
        'inflect.fullname',
        'inflect.chart',
        'inflect.labels',
        'inflect.selectorLabels',
        'inflect.serviceAccountName',
        'inflect.image',
        'inflect.envFromConfigMapName',
        'inflect.envFromSecretName',
    ])('defines "%s"', (helper) => {
        const src = read(`${CHART_DIR}/templates/_helpers.tpl`);
        expect(src).toMatch(new RegExp(`define "${helper.replace('.', '\\.')}"`));
    });

    it('image helper falls back to .Chart.AppVersion when tag is empty', () => {
        const src = read(`${CHART_DIR}/templates/_helpers.tpl`);
        // The fallback shape: default .Chart.AppVersion .Values.image.tag
        expect(src).toMatch(/default\s+\.Chart\.AppVersion\s+\.Values\.image\.tag/);
    });
});

describe('OI-2 — deployment.yaml shape', () => {
    const deploymentSrc = () => read(`${CHART_DIR}/templates/deployment.yaml`);

    it('declares Deployment apiVersion: apps/v1', () => {
        expect(deploymentSrc()).toMatch(/^apiVersion:\s*apps\/v1/m);
        expect(deploymentSrc()).toMatch(/^kind:\s*Deployment/m);
    });

    it('uses inflect.fullname helper for metadata.name', () => {
        expect(deploymentSrc()).toMatch(/include "inflect\.fullname"/);
    });

    it('selector.matchLabels uses the stable selectorLabels (NOT full labels)', () => {
        const src = deploymentSrc();
        // matchLabels must use the stable selector subset — using full
        // .labels would include version, which is mutable, breaking
        // upgrades on a Deployment (selector is immutable).
        const match = src.match(/matchLabels:\s*\n\s*\{\{-\s*include\s+"inflect\.selectorLabels"/);
        expect(match).toBeTruthy();
    });

    it('container ports name http maps to .Values.containerPort', () => {
        const src = deploymentSrc();
        expect(src).toMatch(/-\s*name:\s*http\s*\n\s*containerPort:\s*\{\{\s*\.Values\.containerPort\s*\}\}/);
    });

    it('envFrom block references BOTH configMapRef AND secretRef', () => {
        const src = deploymentSrc();
        expect(src).toMatch(/configMapRef:[\s\S]*?include "inflect\.envFromConfigMapName"/);
        expect(src).toMatch(/secretRef:[\s\S]*?include "inflect\.envFromSecretName"/);
    });

    it('livenessProbe + readinessProbe come from .Values', () => {
        const src = deploymentSrc();
        expect(src).toMatch(/livenessProbe:\s*\n\s*\{\{-\s*toYaml\s+\.Values\.livenessProbe/);
        expect(src).toMatch(/readinessProbe:\s*\n\s*\{\{-\s*toYaml\s+\.Values\.readinessProbe/);
    });

    it('resources come from .Values', () => {
        const src = deploymentSrc();
        expect(src).toMatch(/resources:\s*\n\s*\{\{-\s*toYaml\s+\.Values\.resources/);
    });

    it('serviceAccountName comes from the helper', () => {
        const src = deploymentSrc();
        expect(src).toMatch(/serviceAccountName:\s*\{\{\s*include "inflect\.serviceAccountName"/);
    });

    it('image reference comes from the helper (uses .Chart.AppVersion fallback)', () => {
        const src = deploymentSrc();
        expect(src).toMatch(/image:\s*\{\{\s*include "inflect\.image"/);
    });

    it('app deployment honors optional command + args overrides', () => {
        const src = deploymentSrc();
        expect(src).toMatch(/with\s+\.Values\.command/);
        expect(src).toMatch(/with\s+\.Values\.args/);
    });

    it('app deployment uses component-aware labels (so app + worker selectors are distinct)', () => {
        const src = deploymentSrc();
        // Lock the dict-form call so a future "simplification" can't
        // collapse back to bare context, which would emit selectors
        // without component and let app/worker pods share a ReplicaSet.
        expect(src).toMatch(/include "inflect\.labels"\s+\(dict "ctx"\s+\.\s+"component"\s+"app"\)/);
        expect(src).toMatch(/include "inflect\.selectorLabels"\s+\(dict "ctx"\s+\.\s+"component"\s+"app"\)/);
    });
});

describe('OI-2 — worker Deployment', () => {
    const workerSrc = () => read(`${CHART_DIR}/templates/worker.yaml`);

    it('declares Deployment apiVersion: apps/v1', () => {
        const src = workerSrc();
        expect(src).toMatch(/^apiVersion:\s*apps\/v1/m);
        expect(src).toMatch(/^kind:\s*Deployment/m);
    });

    it('is gated on .Values.worker.enabled', () => {
        expect(workerSrc()).toMatch(/^\{\{-\s*if\s+\.Values\.worker\.enabled\s*-\}\}/m);
    });

    it('runs the BullMQ worker via `node --import tsx scripts/worker.ts` by default', () => {
        // Ratchet on the values-level default so the chart ships with
        // the right command. Operators can override via --set.
        const v = yaml.load(read(`${CHART_DIR}/values.yaml`)) as any;
        expect(v.worker.command).toEqual(['node', '--import', 'tsx', 'scripts/worker.ts']);
    });

    it('uses the worker-image helper (which inherits app image when overrides empty)', () => {
        expect(workerSrc()).toMatch(/image:\s*\{\{\s*include "inflect\.workerImage"/);
    });

    it('selector + labels carry component=worker (so worker pods never share a ReplicaSet with app pods)', () => {
        const src = workerSrc();
        expect(src).toMatch(/include "inflect\.selectorLabels"\s+\(dict "ctx"\s+\.\s+"component"\s+"worker"\)/);
        expect(src).toMatch(/include "inflect\.labels"\s+\(dict "ctx"\s+\.\s+"component"\s+"worker"\)/);
    });

    it('mounts the same envFrom (configMap + secret) as the app', () => {
        const src = workerSrc();
        expect(src).toMatch(/configMapRef:[\s\S]*?include "inflect\.envFromConfigMapName"/);
        expect(src).toMatch(/secretRef:[\s\S]*?include "inflect\.envFromSecretName"/);
    });

    it('default values: replicas=1, no probes, terminationGracePeriodSeconds=60', () => {
        const v = yaml.load(read(`${CHART_DIR}/values.yaml`)) as any;
        expect(v.worker.replicaCount).toBe(1);
        expect(v.worker.livenessProbe.enabled).toBe(false);
        expect(v.worker.readinessProbe.enabled).toBe(false);
        expect(v.worker.terminationGracePeriodSeconds).toBe(60);
    });

    it('worker resources are explicit (smaller than app — workers are CPU-bound, less memory)', () => {
        const v = yaml.load(read(`${CHART_DIR}/values.yaml`)) as any;
        expect(v.worker.resources.requests).toBeDefined();
        expect(v.worker.resources.limits).toBeDefined();
    });
});

describe('OI-2 — migration Job (Helm pre-install/pre-upgrade hook)', () => {
    const jobSrc = () => read(`${CHART_DIR}/templates/migration-job.yaml`);

    it('declares Job apiVersion: batch/v1', () => {
        const src = jobSrc();
        expect(src).toMatch(/^apiVersion:\s*batch\/v1/m);
        expect(src).toMatch(/^kind:\s*Job/m);
    });

    it('is gated on .Values.migration.enabled', () => {
        expect(jobSrc()).toMatch(/^\{\{-\s*if\s+\.Values\.migration\.enabled\s*-\}\}/m);
    });

    it('carries the helm.sh/hook annotations for pre-install AND pre-upgrade', () => {
        const src = jobSrc();
        // The annotation MUST list both pre-install and pre-upgrade —
        // dropping either would break the migration ordering on that
        // lifecycle event.
        expect(src).toMatch(/"helm\.sh\/hook":\s*pre-install,pre-upgrade/);
        expect(src).toMatch(/"helm\.sh\/hook-weight":\s*\{\{[^}]*hookWeight/);
        expect(src).toMatch(/"helm\.sh\/hook-delete-policy":\s*\{\{[^}]*hookDeletePolicy/);
    });

    it('default hook-delete-policy = before-hook-creation,hook-succeeded (failed Jobs preserved for log inspection)', () => {
        const v = yaml.load(read(`${CHART_DIR}/values.yaml`)) as any;
        expect(v.migration.hookDeletePolicy).toBe(
            'before-hook-creation,hook-succeeded',
        );
    });

    // The chart must invoke the VENDORED CLI, not `npx`. Two reasons, and
    // the second is a hard requirement: the runtime image no longer ships
    // npm at all (stripped in the Dockerfile to remove the bundled-npm CVE
    // surface), so an `npx` command here would fail to execute. The old
    // form also pinned prisma@5.22.0, which rejects the Prisma 7 schema and
    // had already drifted from the entrypoint's 7.8.0.
    it('runs `prisma migrate deploy` via the vendored CLI (matches scripts/entrypoint.sh)', () => {
        const v = yaml.load(read(`${CHART_DIR}/values.yaml`)) as any;
        expect(v.migration.command).toEqual([
            './node_modules/.bin/prisma',
            'migrate',
            'deploy',
            '--schema=./prisma/schema',
        ]);
    });

    it('the chart does NOT invoke npx (npm is absent from the runtime image)', () => {
        const v = yaml.load(read(`${CHART_DIR}/values.yaml`)) as any;
        expect(JSON.stringify(v.migration.command)).not.toContain('npx');
    });

    it('backoffLimit defaults to 0 (failed migration is an intentional stop)', () => {
        const v = yaml.load(read(`${CHART_DIR}/values.yaml`)) as any;
        expect(v.migration.backoffLimit).toBe(0);
    });

    it('uses the migration-image helper (which inherits app image when overrides empty)', () => {
        expect(jobSrc()).toMatch(/image:\s*\{\{\s*include "inflect\.migrationImage"/);
    });

    it('mounts the same envFrom (configMap + secret) as app + worker', () => {
        const src = jobSrc();
        expect(src).toMatch(/configMapRef:[\s\S]*?include "inflect\.envFromConfigMapName"/);
        expect(src).toMatch(/secretRef:[\s\S]*?include "inflect\.envFromSecretName"/);
    });

    it('restartPolicy is Never (Job semantics — failed pods do not restart)', () => {
        expect(jobSrc()).toMatch(/restartPolicy:\s*Never/);
    });
});

describe('OI-2 — image-helper inheritance', () => {
    it('workerImage helper falls back to .Values.image.* when worker overrides empty', () => {
        const src = read(`${CHART_DIR}/templates/_helpers.tpl`);
        const block = src.match(
            /define "inflect\.workerImage"[\s\S]*?\{\{- end \}\}/,
        );
        expect(block).toBeTruthy();
        // Both repository and tag must default to .Values.image.* when
        // worker overrides are empty.
        expect(block![0]).toMatch(/default\s+\.Values\.image\.repository\s+\.Values\.worker\.image\.repository/);
        expect(block![0]).toMatch(/default\s+.*\.Values\.image\.tag.*\.Values\.worker\.image\.tag/);
    });

    it('migrationImage helper falls back to .Values.image.* when migration overrides empty', () => {
        const src = read(`${CHART_DIR}/templates/_helpers.tpl`);
        const block = src.match(
            /define "inflect\.migrationImage"[\s\S]*?\{\{- end \}\}/,
        );
        expect(block).toBeTruthy();
        expect(block![0]).toMatch(/default\s+\.Values\.image\.repository\s+\.Values\.migration\.image\.repository/);
        expect(block![0]).toMatch(/default\s+.*\.Values\.image\.tag.*\.Values\.migration\.image\.tag/);
    });
});

describe('OI-2 — HorizontalPodAutoscaler', () => {
    const hpaSrc = () => read(`${CHART_DIR}/templates/hpa.yaml`);

    it('uses autoscaling/v2 (modern stable API)', () => {
        expect(hpaSrc()).toMatch(/^apiVersion:\s*autoscaling\/v2/m);
    });

    it('is gated on .Values.autoscaling.enabled', () => {
        expect(hpaSrc()).toMatch(/^\{\{-\s*if\s+\.Values\.autoscaling\.enabled\s*-\}\}/m);
    });

    it('targets the app Deployment by name', () => {
        const src = hpaSrc();
        expect(src).toMatch(/scaleTargetRef:[\s\S]*?kind:\s*Deployment[\s\S]*?name:\s*\{\{\s*include "inflect\.fullname"/);
    });

    it('default min=2, max=10, CPU 70% (per OI-2 spec)', () => {
        const v = yaml.load(read(`${CHART_DIR}/values.yaml`)) as any;
        expect(v.autoscaling.enabled).toBe(true);
        expect(v.autoscaling.minReplicas).toBe(2);
        expect(v.autoscaling.maxReplicas).toBe(10);
        expect(v.autoscaling.targetCPUUtilizationPercentage).toBe(70);
    });

    it('emits a Resource:cpu metric ALWAYS (latency-independent)', () => {
        const src = hpaSrc();
        expect(src).toMatch(/-\s*type:\s*Resource[\s\S]*?name:\s*cpu[\s\S]*?averageUtilization:/);
    });

    it('emits a Pods latency metric ONLY when .Values.autoscaling.latency.enabled', () => {
        const src = hpaSrc();
        // The latency block is gated; the gating expression must
        // reference latency.enabled exactly.
        expect(src).toMatch(/\{\{-\s*if\s+\.Values\.autoscaling\.latency\.enabled\s*\}\}/);
        expect(src).toMatch(/-\s*type:\s*Pods[\s\S]*?metric:[\s\S]*?\.Values\.autoscaling\.latency\.metricName/);
    });

    it('latency metric defaults to disabled (works in clusters without Prometheus Adapter)', () => {
        const v = yaml.load(read(`${CHART_DIR}/values.yaml`)) as any;
        expect(v.autoscaling.latency.enabled).toBe(false);
    });

    it('autoscaling.behavior is plumbed through to the HPA', () => {
        const src = hpaSrc();
        expect(src).toMatch(/with\s+\.Values\.autoscaling\.behavior/);
    });
});

describe('OI-2 — app Deployment + HPA cooperation', () => {
    const deploymentSrc = () => read(`${CHART_DIR}/templates/deployment.yaml`);

    it('app Deployment OMITS spec.replicas when HPA is enabled', () => {
        const src = deploymentSrc();
        // The replicas line must be guarded by `if not .Values.autoscaling.enabled`.
        expect(src).toMatch(
            /\{\{-\s*if\s+not\s+\.Values\.autoscaling\.enabled\s*\}\}\s*\n\s*replicas:\s*\{\{\s*\.Values\.replicaCount/,
        );
    });
});

describe('OI-2 — PgBouncer sidecar', () => {
    const deploymentSrc = () => read(`${CHART_DIR}/templates/deployment.yaml`);

    it('sidecar block is gated on .Values.pgbouncer.enabled', () => {
        const src = deploymentSrc();
        expect(src).toMatch(/\{\{-\s*if\s+\.Values\.pgbouncer\.enabled\s*\}\}\s*\n[\s\S]*?-\s*name:\s*pgbouncer/);
    });

    it('sidecar listens on port 5432 by default (so app reaches it via localhost:5432)', () => {
        const v = yaml.load(read(`${CHART_DIR}/values.yaml`)) as any;
        expect(v.pgbouncer.port).toBe(5432);
        // Bind to localhost only — never expose externally
        expect(v.pgbouncer.config.PGBOUNCER_PORT).toBe('5432');
        expect(v.pgbouncer.config.PGBOUNCER_BIND_ADDRESS).toBe('127.0.0.1');
    });

    it('uses transaction pool mode (matches existing PgBouncer config)', () => {
        const v = yaml.load(read(`${CHART_DIR}/values.yaml`)) as any;
        expect(v.pgbouncer.config.PGBOUNCER_POOL_MODE).toBe('transaction');
    });

    it('upstream password is sourced from a Secret via valueFrom (NOT inline value)', () => {
        const src = deploymentSrc();
        // Lock the valueFrom pattern — inlining the password would
        // violate OI-1 secrets hygiene.
        expect(src).toMatch(/-\s*name:\s*POSTGRESQL_PASSWORD\s*\n\s*valueFrom:\s*\n\s*secretKeyRef:[\s\S]*?include "inflect\.pgbouncerSecretName"/);
    });

    it('inflect.pgbouncerSecretName helper exists and defaults to <fullname>-pgbouncer', () => {
        const src = read(`${CHART_DIR}/templates/_helpers.tpl`);
        expect(src).toMatch(/define "inflect\.pgbouncerSecretName"/);
        expect(src).toMatch(/printf\s+"%s-pgbouncer"\s+\(include "inflect\.fullname"/);
    });

    it('TCP probes target the PgBouncer port (no HTTP probe layer on PgBouncer)', () => {
        const v = yaml.load(read(`${CHART_DIR}/values.yaml`)) as any;
        expect(v.pgbouncer.livenessProbe.tcpSocket.port).toBe(5432);
        expect(v.pgbouncer.readinessProbe.tcpSocket.port).toBe(5432);
    });

    it('image is pinned to a specific bitnami/pgbouncer version (not :latest)', () => {
        const v = yaml.load(read(`${CHART_DIR}/values.yaml`)) as any;
        expect(v.pgbouncer.image.repository).toBe('bitnami/pgbouncer');
        expect(v.pgbouncer.image.tag).toMatch(/^\d+\.\d+\.\d+/);
        expect(v.pgbouncer.image.tag).not.toBe('latest');
    });

    it('non-root securityContext (drop ALL caps, no privesc)', () => {
        const v = yaml.load(read(`${CHART_DIR}/values.yaml`)) as any;
        expect(v.pgbouncer.securityContext.runAsNonRoot).toBe(true);
        expect(v.pgbouncer.securityContext.allowPrivilegeEscalation).toBe(false);
        expect(v.pgbouncer.securityContext.capabilities.drop).toContain('ALL');
    });

    it('worker Deployment does NOT carry the PgBouncer sidecar (per OI-2 spec)', () => {
        const src = read(`${CHART_DIR}/templates/worker.yaml`);
        // The worker template must not reference pgbouncer in its
        // containers list. (Values gating doesn't matter here — we
        // assert the template never wires it in.)
        expect(src).not.toMatch(/-\s*name:\s*pgbouncer/);
        expect(src).not.toMatch(/\.Values\.pgbouncer/);
    });
});

describe('OI-2 — Service', () => {
    const svcSrc = () => read(`${CHART_DIR}/templates/service.yaml`);

    it('declares Service apiVersion: v1', () => {
        expect(svcSrc()).toMatch(/^apiVersion:\s*v1/m);
        expect(svcSrc()).toMatch(/^kind:\s*Service/m);
    });

    it('selector matches component=app pods only (not worker)', () => {
        const src = svcSrc();
        expect(src).toMatch(/include "inflect\.selectorLabels"\s+\(dict "ctx"\s+\.\s+"component"\s+"app"\)/);
    });

    it('default values: ClusterIP, port 80, target named port http', () => {
        const v = yaml.load(read(`${CHART_DIR}/values.yaml`)) as any;
        expect(v.service.enabled).toBe(true);
        expect(v.service.type).toBe('ClusterIP');
        expect(v.service.port).toBe(80);
        expect(svcSrc()).toMatch(/targetPort:\s*http/);
    });
});

describe('OI-2 — NetworkPolicy', () => {
    const npSrc = () => read(`${CHART_DIR}/templates/networkpolicy.yaml`);

    it('declares NetworkPolicy networking.k8s.io/v1', () => {
        expect(npSrc()).toMatch(/^apiVersion:\s*networking\.k8s\.io\/v1/m);
        expect(npSrc()).toMatch(/^kind:\s*NetworkPolicy/m);
    });

    it('is gated on .Values.networkPolicy.enabled', () => {
        expect(npSrc()).toMatch(/^\{\{-\s*if\s+\.Values\.networkPolicy\.enabled\s*-\}\}/m);
    });

    it('targets component=app pods only (worker + migration unaffected)', () => {
        expect(npSrc()).toMatch(/include "inflect\.selectorLabels"\s+\(dict "ctx"\s+\.\s+"component"\s+"app"\)/);
    });

    it('declares both Ingress and Egress policy types', () => {
        const src = npSrc();
        expect(src).toMatch(/policyTypes:\s*\n\s*-\s*Ingress\s*\n\s*-\s*Egress/);
    });

    it('egress allows DNS to kube-dns', () => {
        const src = npSrc();
        // The DNS rule references the configured kube-dns namespace + pod label
        expect(src).toMatch(/kubernetes\.io\/metadata\.name:\s*\{\{\s*\.Values\.networkPolicy\.dnsNamespace/);
        expect(src).toMatch(/k8s-app:\s*\{\{\s*\.Values\.networkPolicy\.dnsPodLabel/);
        // DNS allows BOTH UDP and TCP on port 53
        expect(src).toMatch(/protocol:\s*UDP\s*\n\s*port:\s*53/);
        expect(src).toMatch(/protocol:\s*TCP\s*\n\s*port:\s*53/);
    });

    it('egress allows VPC CIDR on database + redis ports', () => {
        const src = npSrc();
        expect(src).toMatch(/cidr:\s*\{\{\s*\.Values\.networkPolicy\.vpcCidrBlock/);
        expect(src).toMatch(/port:\s*\{\{\s*\.Values\.networkPolicy\.databasePort/);
        expect(src).toMatch(/port:\s*\{\{\s*\.Values\.networkPolicy\.redisPort/);
    });

    it('egress allows HTTPS to internet with IMDS exception (when blockImdsEgress)', () => {
        const src = npSrc();
        // The HTTPS allow uses 0.0.0.0/0 with except: 169.254.169.254/32
        expect(src).toMatch(/cidr:\s*0\.0\.0\.0\/0/);
        expect(src).toMatch(/169\.254\.169\.254\/32/);
        // The IMDS except is gated on blockImdsEgress
        expect(src).toMatch(/if\s+\.Values\.networkPolicy\.blockImdsEgress/);
    });

    it('default values match OI-2 spec', () => {
        const v = yaml.load(read(`${CHART_DIR}/values.yaml`)) as any;
        // Disabled by default in chart values; production values flips it on
        expect(v.networkPolicy.enabled).toBe(false);
        expect(v.networkPolicy.databasePort).toBe(5432);
        expect(v.networkPolicy.redisPort).toBe(6379);
        expect(v.networkPolicy.allowHttpsEgress).toBe(true);
        expect(v.networkPolicy.blockImdsEgress).toBe(true);
        expect(v.networkPolicy.vpcCidrBlock).toBe('10.0.0.0/16');
    });
});

describe('OI-2 — Ingress', () => {
    const ingSrc = () => read(`${CHART_DIR}/templates/ingress.yaml`);

    it('declares Ingress networking.k8s.io/v1', () => {
        expect(ingSrc()).toMatch(/^apiVersion:\s*networking\.k8s\.io\/v1/m);
        expect(ingSrc()).toMatch(/^kind:\s*Ingress/m);
    });

    it('is gated on .Values.ingress.enabled', () => {
        expect(ingSrc()).toMatch(/^\{\{-\s*if\s+\.Values\.ingress\.enabled\s*-\}\}/m);
    });

    it('TLS section is wired to .Values.ingress.tls', () => {
        const src = ingSrc();
        expect(src).toMatch(/if\s+\.Values\.ingress\.tls\.enabled/);
        expect(src).toMatch(/secretName:\s*\{\{\s*\.secretName/);
    });

    it('rate limit annotations are emitted when rateLimit.enabled', () => {
        const src = ingSrc();
        expect(src).toMatch(/nginx\.ingress\.kubernetes\.io\/limit-rpm:\s*\{\{\s*\.Values\.ingress\.rateLimit\.requestsPerMinute/);
        expect(src).toMatch(/if\s+\.Values\.ingress\.rateLimit\.enabled/);
    });

    it('HSTS header is emitted via configuration-snippet, with `| int` to avoid scientific notation', () => {
        const src = ingSrc();
        // The integer-cast on maxAgeSeconds is load-bearing — without
        // it, Helm renders large integers as e.g. 3.1536e+07 which
        // browsers reject. Lock the cast.
        expect(src).toMatch(/Strict-Transport-Security:\s*max-age=\{\{[^}]*maxAgeSeconds[^}]*\|\s*int/);
        expect(src).toMatch(/if\s+\.Values\.ingress\.hsts\.includeSubDomains/);
        expect(src).toMatch(/if\s+\.Values\.ingress\.hsts\.preload/);
    });

    it('forces SSL redirect when forceSslRedirect = true', () => {
        const src = ingSrc();
        expect(src).toMatch(/nginx\.ingress\.kubernetes\.io\/ssl-redirect:\s*"true"/);
        expect(src).toMatch(/if\s+\.Values\.ingress\.forceSslRedirect/);
    });

    it('default values: TLS on, force-redirect on, rate-limit + HSTS enabled', () => {
        const v = yaml.load(read(`${CHART_DIR}/values.yaml`)) as any;
        expect(v.ingress.tls.enabled).toBe(true);
        expect(v.ingress.forceSslRedirect).toBe(true);
        expect(v.ingress.rateLimit.enabled).toBe(true);
        expect(v.ingress.hsts.enabled).toBe(true);
        expect(v.ingress.hsts.maxAgeSeconds).toBe(31536000);
    });

    it('extra annotations from values are merged on top of chart defaults', () => {
        const src = ingSrc();
        expect(src).toMatch(/with\s+\.Values\.ingress\.annotations/);
    });
});

describe('OI-2 — per-environment values files', () => {
    it('values-staging: replicaCount=1, autoscaling off, smaller resources, NetworkPolicy off', () => {
        const v = yaml.load(read(`${CHART_DIR}/values-staging.yaml`)) as any;
        expect(v.replicaCount).toBe(1);
        expect(v.autoscaling.enabled).toBe(false);
        expect(v.networkPolicy.enabled).toBe(false);
        expect(v.worker.replicaCount).toBe(1);
        // Resources strictly smaller than the chart default (req 250m vs 1, 256Mi vs 512Mi)
        const cpuVal = (v: string) => parseInt(String(v).replace(/m?$/, ''), 10);
        const stagingCpu = cpuVal(v.resources.requests.cpu);
        expect(stagingCpu).toBeLessThan(1000);
    });

    it('values-staging: HSTS preload disabled (so preload list won\'t pin staging hostname)', () => {
        const v = yaml.load(read(`${CHART_DIR}/values-staging.yaml`)) as any;
        expect(v.ingress.hsts.preload).toBe(false);
    });

    it('values-production: autoscaling on (2-10), NetworkPolicy on, HPA behavior set', () => {
        const v = yaml.load(read(`${CHART_DIR}/values-production.yaml`)) as any;
        expect(v.autoscaling.enabled).toBe(true);
        expect(v.autoscaling.minReplicas).toBe(2);
        expect(v.autoscaling.maxReplicas).toBe(10);
        expect(v.autoscaling.targetCPUUtilizationPercentage).toBe(70);
        expect(v.networkPolicy.enabled).toBe(true);
        expect(v.autoscaling.behavior).toBeDefined();
        expect(v.worker.replicaCount).toBe(2);
    });

    it('values-production: HSTS preload enabled (production hostname)', () => {
        const v = yaml.load(read(`${CHART_DIR}/values-production.yaml`)) as any;
        expect(v.ingress.hsts.preload).toBe(true);
    });

    it('staging and production point at DIFFERENT ingress hostnames', () => {
        const s = yaml.load(read(`${CHART_DIR}/values-staging.yaml`)) as any;
        const p = yaml.load(read(`${CHART_DIR}/values-production.yaml`)) as any;
        const stagingHost = s.ingress.hosts[0].host;
        const prodHost = p.ingress.hosts[0].host;
        expect(stagingHost).toBeTruthy();
        expect(prodHost).toBeTruthy();
        expect(stagingHost).not.toEqual(prodHost);
    });

    it('production has topologySpreadConstraints across AZs', () => {
        const v = yaml.load(read(`${CHART_DIR}/values-production.yaml`)) as any;
        expect(Array.isArray(v.topologySpreadConstraints)).toBe(true);
        expect(v.topologySpreadConstraints.length).toBeGreaterThan(0);
        expect(v.topologySpreadConstraints[0].topologyKey).toBe('topology.kubernetes.io/zone');
    });
});
