/**
 * КАИС OpenData client — PURE HTTP, no DB.
 *
 * КАИС (Кадастрално-административна информационна система, kais.cadastre.bg) is
 * the Bulgarian cadastre agency's (АГКК) public OpenData portal. It publishes,
 * per settlement (ЕКАТТЕ), a shapefile ZIP of the cadastral map. This client
 * fetches ONLY the land-parcels archive ("поземлени имоти.zip" — geometry +
 * cadastral identifier + land-use). It NEVER fetches the ownership registers
 * ("собственост*.zip"), which carry personal data (see PRIVACY below).
 *
 * ## Wire protocol (verified live from the production VM, 2026-07-13)
 *
 * The portal is a Kendo UI FileManager backed by an anti-forgery-protected
 * directory API. The verified flow:
 *   1. `GET /bg/OpenData` (HTML) → capture the anti-forgery COOKIE (Set-Cookie)
 *      AND scrape the hidden `__RequestVerificationToken` field. Both are
 *      required together on every POST.
 *   2. `POST /bg/OpenData/Read` — form body `target=<parentPath>` +
 *      `__RequestVerificationToken=<tok>`, header `RequestVerificationToken:
 *      <tok>`, the cookie. `target=""` returns the 28 oblasti. The drill-down
 *      key is **`target`** (a plain `path=` field is ignored — the open item
 *      the earlier discovery left). Response: a JSON array of
 *      `{ Name, Path, Extension, IsDirectory, HasDirectories, Size,
 *        ModifiedUtc, … }`. Path separator is `/`. Tree depth:
 *      oblast → община → settlement `"гр./с. <name> (<ЕКАТТЕ>)"` → files.
 *   3. `GET /bg/OpenData/Download?path=<url-encoded Path>` → the ZIP bytes.
 *
 * Contract (mirrors the SoilGrids client): a per-request AbortController
 * timeout, a throw on any non-2xx, and a `baseUrl` / `fetchImpl` override so
 * unit tests inject a fake transport and never touch the network.
 *
 * ## PRIVACY
 * Only "поземлени имоти.zip" is downloaded. The ownership archives
 * ("собственост ПИ / сгради / СОС.zip") are personal data — a CC-licensed
 * OpenData portal is NOT a GDPR waiver — and are never requested or persisted.
 *
 * @module lib/cadastre/opendata-client
 */

const DEFAULT_TIMEOUT_MS = 20_000;
/** Land-parcels file name (Name field, sans extension) — the ONLY file we pull. */
const LAND_PARCELS_NAME = 'поземлени имоти';
/** Ownership-register name prefix — NEVER fetched (personal data). */
const OWNERSHIP_NAME_PREFIX = 'собственост';
/** Hard cap on a downloaded archive (a settlement land-parcels ZIP is ~1–8 MB). */
const DEFAULT_MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
/** Runaway guard on the directory walk (Read calls) when resolving an ЕКАТТЕ. */
const DEFAULT_MAX_WALK_NODES = 6000;

/** One row of a КАИС directory listing. */
export interface KaisEntry {
    Name: string;
    Path: string;
    Extension: string;
    IsDirectory: boolean;
    HasDirectories: boolean;
    Size: number;
    ModifiedUtc?: string;
    Modified?: string;
}

export interface CadastreOpenDataOptions {
    /** Base URL (CADASTRE_OPENDATA_INDEX_URL). Required — feature is env-gated. */
    baseUrl: string;
    /** Per-request timeout (ms). */
    timeoutMs?: number;
    /** Max bytes for a downloaded archive (defence against a huge response). */
    maxArchiveBytes?: number;
    /** Max Read calls during an ЕКАТТЕ walk (runaway guard). */
    maxWalkNodes?: number;
    /** Injected transport for tests. Defaults to global `fetch`. */
    fetchImpl?: typeof fetch;
}

export class CadastreOpenDataError extends Error {
    constructor(message: string, readonly code: 'http' | 'not_found' | 'too_large' | 'walk_budget' | 'protocol') {
        super(message);
        this.name = 'CadastreOpenDataError';
    }
}

/** Resolved settlement land-parcels archive. */
export interface FetchedArchive {
    ekatte: string;
    /** The ZIP bytes ("поземлени имоти.zip"). */
    buffer: Buffer;
    /** The КАИС tree Path the archive resolved from (provenance). */
    sourcePath: string;
    /** The entry's ModifiedUtc (freshness stamp), ISO string. */
    sourceDate: string;
    sizeBytes: number;
}

interface Session {
    cookie: string;
    token: string;
}

export class CadastreOpenDataClient {
    private readonly baseUrl: string;
    private readonly timeoutMs: number;
    private readonly maxArchiveBytes: number;
    private readonly maxWalkNodes: number;
    private readonly fetchImpl: typeof fetch;

    constructor(opts: CadastreOpenDataOptions) {
        if (!opts.baseUrl) throw new CadastreOpenDataError('baseUrl is required', 'protocol');
        this.baseUrl = opts.baseUrl.replace(/\/$/, '');
        this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        this.maxArchiveBytes = opts.maxArchiveBytes ?? DEFAULT_MAX_ARCHIVE_BYTES;
        this.maxWalkNodes = opts.maxWalkNodes ?? DEFAULT_MAX_WALK_NODES;
        this.fetchImpl = opts.fetchImpl ?? fetch;
    }

    private async withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            return await fn(controller.signal);
        } finally {
            clearTimeout(timer);
        }
    }

    /**
     * Step 1 — open a session: GET the landing page, capture the anti-forgery
     * cookie + the hidden `__RequestVerificationToken`.
     */
    private async openSession(): Promise<Session> {
        return this.withTimeout(async (signal) => {
            const res = await this.fetchImpl(`${this.baseUrl}/bg/OpenData`, {
                method: 'GET',
                headers: { Accept: 'text/html' },
                signal,
            });
            if (!res.ok) {
                throw new CadastreOpenDataError(`OpenData landing returned ${res.status}`, 'http');
            }
            const cookie = extractCookies(res);
            const html = await res.text();
            const token = extractToken(html);
            if (!token) {
                throw new CadastreOpenDataError('anti-forgery token not found on OpenData landing', 'protocol');
            }
            return { cookie, token };
        });
    }

    /** Step 2 — list a directory: POST /Read with the drill-down `target`. */
    private async read(session: Session, target: string): Promise<KaisEntry[]> {
        return this.withTimeout(async (signal) => {
            const body = new URLSearchParams();
            body.set('target', target);
            body.set('__RequestVerificationToken', session.token);
            const res = await this.fetchImpl(`${this.baseUrl}/bg/OpenData/Read`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    Accept: 'application/json',
                    RequestVerificationToken: session.token,
                    'X-Requested-With': 'XMLHttpRequest',
                    ...(session.cookie ? { Cookie: session.cookie } : {}),
                },
                body: body.toString(),
                signal,
            });
            if (!res.ok) {
                throw new CadastreOpenDataError(`OpenData Read(${target}) returned ${res.status}`, 'http');
            }
            const json = (await res.json()) as unknown;
            if (!Array.isArray(json)) {
                throw new CadastreOpenDataError('OpenData Read did not return an array', 'protocol');
            }
            return json as KaisEntry[];
        });
    }

    /** Step 3 — download a file by its КАИС Path (bytes, capped). */
    private async download(session: Session, path: string): Promise<Buffer> {
        return this.withTimeout(async (signal) => {
            const url = `${this.baseUrl}/bg/OpenData/Download?path=${encodeURIComponent(path)}`;
            const res = await this.fetchImpl(url, {
                method: 'GET',
                headers: {
                    Accept: 'application/zip,application/octet-stream',
                    ...(session.cookie ? { Cookie: session.cookie } : {}),
                },
                signal,
            });
            if (!res.ok) {
                throw new CadastreOpenDataError(`OpenData Download returned ${res.status}`, 'http');
            }
            const len = Number(res.headers.get('content-length') ?? '0');
            if (len && len > this.maxArchiveBytes) {
                throw new CadastreOpenDataError(
                    `archive is ${len} bytes, exceeds cap ${this.maxArchiveBytes}`,
                    'too_large',
                );
            }
            const buf = Buffer.from(await res.arrayBuffer());
            if (buf.byteLength > this.maxArchiveBytes) {
                throw new CadastreOpenDataError(
                    `archive is ${buf.byteLength} bytes, exceeds cap ${this.maxArchiveBytes}`,
                    'too_large',
                );
            }
            return buf;
        });
    }

    /**
     * `fetchIndex()` — the top-level index (28 oblasti). Cheap probe used by the
     * env-gate health check and by tests to assert the session flow works.
     */
    async fetchIndex(): Promise<KaisEntry[]> {
        const session = await this.openSession();
        return this.read(session, '');
    }

    /**
     * `fetchArchive(ekatte)` — resolve a settlement's land-parcels ZIP.
     *
     * Walks the tree oblast → община → settlement, matching the settlement whose
     * folder Name embeds `(<ekatte>)`, then downloads ONLY "поземлени имоти.zip"
     * from it. Early-terminates on the first match. `HasDirectories: false`
     * prunes leaf nodes; a `maxWalkNodes` budget guards against a runaway walk.
     * Throws `CadastreOpenDataError('not_found')` when the ЕКАТТЕ is not present.
     */
    async fetchArchive(ekatte: string): Promise<FetchedArchive> {
        const session = await this.openSession();
        const marker = `(${ekatte})`;
        let nodes = 0;

        const oblasti = await this.read(session, '');
        nodes++;
        for (const oblast of oblasti) {
            if (!oblast.IsDirectory) continue;
            const obshtini = await this.read(session, oblast.Path);
            if (++nodes > this.maxWalkNodes) {
                throw new CadastreOpenDataError(`walk exceeded ${this.maxWalkNodes} nodes`, 'walk_budget');
            }
            for (const obshtina of obshtini) {
                if (!obshtina.IsDirectory) continue;
                const settlements = await this.read(session, obshtina.Path);
                if (++nodes > this.maxWalkNodes) {
                    throw new CadastreOpenDataError(`walk exceeded ${this.maxWalkNodes} nodes`, 'walk_budget');
                }
                const match = settlements.find(
                    (s) => s.IsDirectory && s.Name.includes(marker),
                );
                if (!match) continue;

                // Found the settlement — list its files, pick land-parcels ONLY.
                const files = await this.read(session, match.Path);
                nodes++;
                const landParcels = files.find(
                    (f) =>
                        !f.IsDirectory &&
                        f.Extension.toLowerCase() === '.zip' &&
                        f.Name.trim().toLowerCase() === LAND_PARCELS_NAME,
                );
                if (!landParcels) {
                    // Never fall back to an ownership register.
                    throw new CadastreOpenDataError(
                        `settlement ${ekatte} has no "${LAND_PARCELS_NAME}" archive`,
                        'not_found',
                    );
                }
                // Defence-in-depth: refuse anything that looks like ownership.
                if (landParcels.Name.trim().toLowerCase().startsWith(OWNERSHIP_NAME_PREFIX)) {
                    throw new CadastreOpenDataError('refusing to fetch an ownership register', 'protocol');
                }
                const buffer = await this.download(session, landParcels.Path);
                return {
                    ekatte,
                    buffer,
                    sourcePath: landParcels.Path,
                    sourceDate: landParcels.ModifiedUtc ?? landParcels.Modified ?? new Date().toISOString(),
                    sizeBytes: buffer.byteLength,
                };
            }
        }
        throw new CadastreOpenDataError(`ЕКАТТЕ ${ekatte} not found in the КАИС index`, 'not_found');
    }
}

/** Concatenate Set-Cookie name=value pairs into a Cookie header value. */
function extractCookies(res: Response): string {
    const headers = res.headers as Headers & { getSetCookie?: () => string[] };
    const list = typeof headers.getSetCookie === 'function'
        ? headers.getSetCookie()
        : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie') as string] : []);
    return list
        .map((c) => c.split(';')[0])
        .filter(Boolean)
        .join('; ');
}

/** Scrape the hidden `__RequestVerificationToken` value from the landing HTML. */
function extractToken(html: string): string | null {
    const m = /name="__RequestVerificationToken"[^>]*value="([^"]+)"/.exec(html)
        ?? /value="([^"]+)"[^>]*name="__RequestVerificationToken"/.exec(html);
    return m ? m[1] : null;
}
