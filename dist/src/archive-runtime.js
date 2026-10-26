/** Shared adapter boundary for tools, local CLI and diagnostics. */
import fs from "node:fs";
import { VERSION } from "./version.js";
import path from "node:path";
import { expandHome, pluginStateDir, stateDir } from "./paths.js";
import { resolveConfig, storageMode } from "./config.js";
export class ArchiveRuntime {
    raw;
    mode;
    cfg;
    connectionFile;
    databaseFile;
    store;
    opening;
    failures = 0;
    constructor(raw) {
        this.raw = raw;
        this.mode = storageMode(raw);
        this.cfg = resolveConfig(raw);
        this.connectionFile = expandHome(raw.routesFile ??
            raw.sourceArchiveConnectionFile ??
            path.join(stateDir(), "worldscribe-source", "connection.json"));
        this.databaseFile = expandHome(raw.databaseFile ?? path.join(pluginStateDir(), "memory.sqlite"));
    }
    connection() {
        try {
            const conn = JSON.parse(fs.readFileSync(this.connectionFile, "utf8"));
            if (!Array.isArray(conn.routes) ||
                conn.routes.some((r) => !r ||
                    typeof r.sessionKey !== "string" ||
                    !/^agent:[^:]+:[^:]+:[^:]+:direct:[^:]+$/i.test(r.sessionKey) ||
                    typeof r.world !== "string" ||
                    !r.world ||
                    [r.allowThreads, r.ownerPrivate].some((x) => x !== undefined && typeof x !== "boolean")))
                throw Error();
            if (this.mode === "source-api" &&
                (typeof conn.api_token !== "string" || !conn.api_token.trim()))
                throw Error();
            return conn;
        }
        catch {
            throw new Error("Worldscribe connection unavailable or invalid; configure private routes");
        }
    }
    async local() {
        if (this.mode !== "local")
            throw Error("Command requires storage=local");
        if (this.store)
            return this.store;
        if (!this.opening)
            this.opening = import("./local-store.js")
                .then(({ LocalStore }) => (this.store = new LocalStore(this.databaseFile)))
                .finally(() => {
                this.opening = undefined;
            });
        return this.opening;
    }
    async close() {
        if (this.opening)
            await this.opening.catch(() => { });
        this.store?.close();
        this.store = undefined;
    }
    async call(action, data, scope) {
        try {
            if (this.mode === "local")
                return (await this.local()).execute(action, data, scope);
            const conn = this.connection();
            const r = await fetch(`http://127.0.0.1:${this.cfg.backend.port}/${action}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${conn.api_token}`,
                },
                body: JSON.stringify({ ...data, ...scope }),
                signal: AbortSignal.timeout(this.cfg.tools.requestTimeoutMs),
            });
            if (!r.ok)
                throw new Error(`Worldscribe source service returned HTTP ${r.status}`);
            return await r.json();
        }
        catch (e) {
            this.failures++;
            throw e;
        }
    }
    async doctor() {
        const checks = [];
        try {
            const c = this.connection();
            checks.push({
                code: c.routes.length ? "ROUTES_READY" : "ROUTES_EMPTY",
                ok: c.routes.length > 0,
            });
        }
        catch {
            checks.push({ code: "ROUTES_UNAVAILABLE", ok: false });
        }
        if (this.mode === "local") {
            try {
                const h = (await this.local()).doctor();
                checks.push({ code: h.code, ok: h.ok });
            }
            catch {
                checks.push({ code: "STORE_UNAVAILABLE", ok: false });
            }
        }
        else {
            try {
                const r = await fetch(`http://127.0.0.1:${this.cfg.backend.port}/health`, { signal: AbortSignal.timeout(this.cfg.tools.requestTimeoutMs) });
                const h = (await r.json());
                const ok = r.ok && h.ok === true && h.mode === "source-archive";
                checks.push({
                    code: ok ? "SOURCE_API_READY" : "SOURCE_API_UNAVAILABLE",
                    ok,
                });
            }
            catch {
                checks.push({ code: "SOURCE_API_UNAVAILABLE", ok: false });
            }
        }
        return {
            schemaVersion: 1,
            component: "openclaw-worldscribe",
            version: VERSION,
            ok: checks.every((c) => c.ok),
            storage: this.mode,
            checks,
            requestFailures: this.failures,
            capabilities: {
                retrieval: "keyword",
                structuredCompilation: false,
                automaticCapture: this.cfg.tools.enableWrite && this.raw.sourceArchiveCapture !== false,
            },
            maintenance: {
                repository: this.raw.maintenance?.repository ?? "Mazeye/openclaw-worldscribe",
                allowIssues: this.raw.maintenance?.allowIssues === true,
                allowPRs: this.raw.maintenance?.allowPRs === true,
                allowMerge: false,
                allowPublish: false,
            },
            privacy: {
                includesMemory: false,
                includesCredentials: false,
                includesPaths: false,
                includesSessionIds: false,
            },
        };
    }
}
