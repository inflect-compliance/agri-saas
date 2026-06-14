/**
 * Epic OI-3 — alerting + receivers + external uptime ratchet.
 *
 * Locks:
 *   - The 6 OI-3-required alert names exist (or their critical-tier
 *     equivalents do for the spec's threshold)
 *   - Each alert has severity, service, runbook annotation, dashboard hint
 *   - receivers.yml has both PagerDuty (critical) + Slack (warning) tiers
 *   - The default route fans non-matching alerts to a visible receiver
 *     (so a misrouted alert never goes silent)
 *   - inhibit_rules collapse warning + critical of same alertname
 *   - external-uptime.yml targets /api/livez (NOT /api/readyz)
 *   - Production has a critical→pagerduty path; staging has a
 *     warning→slack path (severity escalation matches env importance)
 */
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

interface AlertRule {
    alert: string;
    expr: string;
    for?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
}

interface RuleGroup {
    name: string;
    interval?: string;
    rules: AlertRule[];
}

interface RulesFile {
    groups: RuleGroup[];
}

function loadRules(): RulesFile {
    return yaml.load(read('infra/alerts/rules.yml')) as RulesFile;
}

function findAlert(name: string): AlertRule | undefined {
    const rules = loadRules();
    for (const group of rules.groups) {
        for (const rule of group.rules) {
            if (rule.alert === name) return rule;
        }
    }
    return undefined;
}

describe('OI-3 — alert rules cover the 6 spec-required conditions', () => {
    it('rules.yml parses as YAML and is a valid Prometheus rules file shape', () => {
        const rules = loadRules();
        expect(Array.isArray(rules.groups)).toBe(true);
        expect(rules.groups.length).toBeGreaterThan(0);
        for (const group of rules.groups) {
            expect(typeof group.name).toBe('string');
            expect(Array.isArray(group.rules)).toBe(true);
        }
    });

    it('P95 latency > 2s — covered by ApiP95LatencyCritical (existing)', () => {
        const alert = findAlert('ApiP95LatencyCritical');
        expect(alert).toBeDefined();
        expect(alert!.labels?.severity).toBe('critical');
        // Threshold should be ≥ 2000ms
        expect(alert!.expr).toMatch(/>\s*2000/);
    });

    it('error rate > 1% — covered by ApiErrorRateWarning (existing)', () => {
        const alert = findAlert('ApiErrorRateWarning');
        expect(alert).toBeDefined();
        expect(alert!.labels?.severity).toBe('warning');
        expect(alert!.expr).toMatch(/>\s*0\.01/);
    });

    it('DB connection pool exhausted — DatabaseConnectionPoolExhausted (new)', () => {
        const alert = findAlert('DatabaseConnectionPoolExhausted');
        expect(alert).toBeDefined();
        expect(alert!.labels?.severity).toBe('critical');
        // Watches Prisma errors as the pool-exhaustion signal
        expect(alert!.expr).toMatch(/repo_method_errors/);
        expect(alert!.expr).toMatch(/PrismaClient/);
    });

    it('Redis memory > 80% — RedisMemoryHighWarning (new)', () => {
        const alert = findAlert('RedisMemoryHighWarning');
        expect(alert).toBeDefined();
        expect(alert!.labels?.severity).toBe('warning');
        expect(alert!.expr).toMatch(/aws_elasticache_database_memory_usage_percentage_average/);
        expect(alert!.expr).toMatch(/>\s*80/);
    });

    it('BullMQ queue > 1000 — QueueDepthBacklogCritical (new)', () => {
        const alert = findAlert('QueueDepthBacklogCritical');
        expect(alert).toBeDefined();
        expect(alert!.labels?.severity).toBe('critical');
        expect(alert!.expr).toMatch(/job_queue_depth/);
        expect(alert!.expr).toMatch(/>\s*1000/);
    });

    it('Certificate expiry < 14d — CertificateExpiryWarning (new)', () => {
        const alert = findAlert('CertificateExpiryWarning');
        expect(alert).toBeDefined();
        expect(alert!.labels?.severity).toBe('warning');
        expect(alert!.expr).toMatch(/probe_ssl_earliest_cert_expiry/);
        expect(alert!.expr).toMatch(/<\s*14/);
    });
});

describe('OI-3 — alert quality (every alert is actionable)', () => {
    const ALL_NEW_ALERTS = [
        'DatabaseConnectionPoolExhausted',
        'RedisMemoryHighWarning',
        'RedisMemoryHighCritical',
        'QueueDepthBacklogCritical',
        'CertificateExpiryWarning',
        'CertificateExpiryCritical',
    ];

    it.each(ALL_NEW_ALERTS)('%s carries severity, service, summary, description, dashboard', (name) => {
        const alert = findAlert(name);
        expect(alert).toBeDefined();
        expect(alert!.labels?.severity).toBeDefined();
        expect(alert!.labels?.service).toBe('inflect-compliance');
        expect(alert!.annotations?.summary).toBeDefined();
        expect(alert!.annotations?.description).toBeDefined();
        // Dashboard hint links the operator to the right place
        expect(alert!.annotations?.dashboard).toBeDefined();
    });

    it.each(ALL_NEW_ALERTS)('%s description includes a Runbook section', (name) => {
        const alert = findAlert(name);
        expect(alert!.annotations?.description).toMatch(/Runbook:/);
    });
});

describe('OI-3 — receivers.yml routing', () => {
    interface Route {
        receiver?: string;
        matchers?: string[];
        group_wait?: string;
        repeat_interval?: string;
        routes?: Route[];
    }
    interface InhibitRule {
        source_matchers: string[];
        target_matchers: string[];
        equal: string[];
    }
    interface ReceiversFile {
        global: Record<string, unknown>;
        route: Route;
        receivers: { name: string; pagerduty_configs?: unknown[]; slack_configs?: unknown[] }[];
        inhibit_rules: InhibitRule[];
    }

    function loadReceivers(): ReceiversFile {
        return yaml.load(read('infra/alerts/receivers.yml')) as ReceiversFile;
    }

    it('parses as YAML and has the expected top-level shape', () => {
        const r = loadReceivers();
        expect(r.global).toBeDefined();
        expect(r.route).toBeDefined();
        expect(Array.isArray(r.receivers)).toBe(true);
        expect(Array.isArray(r.inhibit_rules)).toBe(true);
    });

    it('declares both pagerduty-critical and slack-warnings receivers', () => {
        const r = loadReceivers();
        const names = r.receivers.map((rec) => rec.name);
        expect(names).toContain('pagerduty-critical');
        expect(names).toContain('slack-warnings');
    });

    it('pagerduty-critical actually wires pagerduty_configs', () => {
        const r = loadReceivers();
        const pd = r.receivers.find((rec) => rec.name === 'pagerduty-critical');
        expect(pd).toBeDefined();
        expect(Array.isArray(pd!.pagerduty_configs)).toBe(true);
        expect(pd!.pagerduty_configs!.length).toBeGreaterThan(0);
    });

    it('slack-warnings actually wires slack_configs', () => {
        const r = loadReceivers();
        const slack = r.receivers.find((rec) => rec.name === 'slack-warnings');
        expect(slack).toBeDefined();
        expect(Array.isArray(slack!.slack_configs)).toBe(true);
        expect(slack!.slack_configs!.length).toBeGreaterThan(0);
    });

    it('critical severity routes to pagerduty-critical', () => {
        const r = loadReceivers();
        const criticalRoute = r.route.routes!.find((rt) =>
            (rt.matchers ?? []).some((m) => m.includes('severity') && m.includes('critical')),
        );
        expect(criticalRoute).toBeDefined();
        expect(criticalRoute!.receiver).toBe('pagerduty-critical');
    });

    it('warning severity routes to slack-warnings', () => {
        const r = loadReceivers();
        const warningRoute = r.route.routes!.find((rt) =>
            (rt.matchers ?? []).some((m) => m.includes('severity') && m.includes('warning')),
        );
        expect(warningRoute).toBeDefined();
        expect(warningRoute!.receiver).toBe('slack-warnings');
    });

    it('default receiver is set so misrouted alerts never go silent', () => {
        const r = loadReceivers();
        // A non-empty default receiver — defense against an alert with
        // an unknown severity tier silently disappearing.
        expect(r.route.receiver).toBeDefined();
        expect(typeof r.route.receiver).toBe('string');
        expect(r.route.receiver!.length).toBeGreaterThan(0);
    });

    it('no plaintext PagerDuty service key or Slack webhook in the file', () => {
        const src = read('infra/alerts/receivers.yml');
        // Both must come from env-var substitution. The literal token
        // `${PAGERDUTY_SERVICE_KEY}` and `${SLACK_WEBHOOK_URL}` are
        // OK — those are env-var references. Check no real-shaped
        // values land here.
        expect(src).toMatch(/\$\{PAGERDUTY_SERVICE_KEY\}/);
        expect(src).toMatch(/\$\{SLACK_WEBHOOK_URL\}/);
        // No PagerDuty Events API v2 32-char hex integration keys
        expect(src).not.toMatch(/\b[0-9a-f]{32}\b/);
        // No Slack webhook URL hostnames with paths
        expect(src).not.toContain('hooks.slack.com/services/');
    });

    it('inhibit_rules collapse warning + critical of same alertname (anti-double-page)', () => {
        const r = loadReceivers();
        const generic = r.inhibit_rules.find(
            (ir) =>
                ir.source_matchers.some((m) => m.includes('severity') && m.includes('critical')) &&
                ir.target_matchers.some((m) => m.includes('severity') && m.includes('warning')) &&
                ir.equal.includes('alertname'),
        );
        expect(generic).toBeDefined();
    });
});

describe('OI-3 — external uptime contract', () => {
    interface UptimeMonitor {
        name: string;
        url: string;
        method: string;
        interval_seconds: number;
        expect: { status_code: number; body_contains?: string; ssl_valid?: boolean };
        on_failure: { severity: string; route_to: string };
    }
    interface UptimeFile {
        monitors: UptimeMonitor[];
    }

    function loadUptime(): UptimeFile {
        return yaml.load(read('infra/alerts/external-uptime.yml')) as UptimeFile;
    }

    it('parses as YAML and has at least one monitor', () => {
        const u = loadUptime();
        expect(Array.isArray(u.monitors)).toBe(true);
        expect(u.monitors.length).toBeGreaterThan(0);
    });

    it('every monitor targets /api/livez (NOT /api/readyz)', () => {
        const u = loadUptime();
        for (const m of u.monitors) {
            expect(m.url).toMatch(/\/api\/livez$/);
            expect(m.url).not.toMatch(/\/api\/readyz/);
        }
    });

    it('every monitor expects status 200 + the stable livez body substring', () => {
        const u = loadUptime();
        for (const m of u.monitors) {
            expect(m.expect.status_code).toBe(200);
            // The exact substring matches the livez route's response body
            expect(m.expect.body_contains).toBe('"status":"alive"');
        }
    });

    it('production monitor escalates to pagerduty (critical), staging to slack (warning)', () => {
        const u = loadUptime();
        const prod = u.monitors.find((m) => m.name.includes('production'));
        const stag = u.monitors.find((m) => m.name.includes('staging'));
        expect(prod).toBeDefined();
        expect(stag).toBeDefined();
        expect(prod!.on_failure.severity).toBe('critical');
        expect(prod!.on_failure.route_to).toBe('pagerduty');
        expect(stag!.on_failure.severity).toBe('warning');
        expect(stag!.on_failure.route_to).toBe('slack');
    });

    it('production monitor checks SSL validity (catches expired certs at the user-visible boundary)', () => {
        const u = loadUptime();
        const prod = u.monitors.find((m) => m.name.includes('production'))!;
        expect(prod.expect.ssl_valid).toBe(true);
    });

    it('production monitor probes from multiple regions (avoid single-pop false-positives)', () => {
        const u = loadUptime();
        const prod = u.monitors.find((m) => m.name.includes('production'))! as UptimeMonitor & {
            locations: string[];
        };
        expect(prod.locations.length).toBeGreaterThan(1);
    });
});
