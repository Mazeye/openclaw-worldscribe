/** Standalone evidence store. No compiler, external service or provider key. */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
const MAX_TEXT = 100000;
export class LocalStore {
    db;
    constructor(file) {
        const dir = path.dirname(file);
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        // Pre-create privately before SQLite can create a world-readable file.
        const fd = fs.openSync(file, "a", 0o600);
        fs.fchmodSync(fd, 0o600);
        fs.closeSync(fd);
        this.db = new DatabaseSync(file);
        this.db.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;");
        const version = Number(this.db.prepare("PRAGMA user_version").get()?.user_version);
        if (version > 1) {
            this.db.close();
            throw new Error("Unsupported memory schema version; use a compatible plugin");
        }
        this.db.exec(`BEGIN IMMEDIATE; CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY, world TEXT NOT NULL, session_key TEXT NOT NULL,
      external_id TEXT NOT NULL, text TEXT NOT NULL, observed_at TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1, metadata TEXT NOT NULL,
      UNIQUE(world,session_key,external_id)
    ); CREATE INDEX IF NOT EXISTS source_scope ON sources(world,session_key,active);
    PRAGMA user_version=1; COMMIT;`);
    }
    close() {
        this.db.close();
    }
    boundary(scope) {
        if (!scope.world || !scope.session_key)
            throw new Error("Unbound memory scope");
        return {
            sql: "world=?" + (scope.owner_private ? "" : " AND session_key=?"),
            args: scope.owner_private
                ? [scope.world]
                : [scope.world, scope.session_key],
        };
    }
    execute(action, data, scope) {
        const { sql, args } = this.boundary(scope);
        if (action === "describe")
            return {
                mode: "local",
                retrieval: "keyword",
                structured_compilation: false,
                sources: this.db
                    .prepare(`SELECT count(*) n FROM sources WHERE ${sql} AND active=1`)
                    .get(...args)?.n,
            };
        if (action === "get") {
            const ids = data.source_ids;
            if (!Array.isArray(ids) ||
                ids.length > 20 ||
                ids.some((id) => !Number.isSafeInteger(id) || id < 1))
                throw new Error("source_ids must contain at most 20 positive integers");
            if (!ids.length)
                return { sources: [] };
            const rows = this.db
                .prepare(`SELECT * FROM sources WHERE ${sql} AND id IN (${ids.map(() => "?").join(",")}) ORDER BY id`)
                .all(...args, ...ids);
            return {
                sources: rows.map((r) => ({
                    ...r,
                    metadata: JSON.parse(String(r.metadata)),
                    active: Boolean(r.active),
                })),
            };
        }
        if (action === "search") {
            if (typeof data.query !== "string" ||
                !data.query.trim() ||
                data.query.length > 500)
                throw new Error("query must have 1-500 characters");
            const k = data.k ?? 5;
            if (!Number.isInteger(k) || Number(k) < 1 || Number(k) > 20)
                throw new Error("k must be 1-20");
            // Bound instr avoids LIKE wildcard injection and works for CJK without a tokenizer.
            const terms = [
                ...new Set([data.query.trim(), ...data.query.trim().split(/\s+/u)]),
            ].slice(0, 20);
            const clauses = terms
                .map(() => "instr(lower(text),lower(?))>0")
                .join(" OR ");
            return {
                mode: "keyword",
                hits: this.db
                    .prepare(`SELECT id,substr(text,1,1600) excerpt,observed_at,external_id FROM sources WHERE ${sql} AND active=1 AND (${clauses}) ORDER BY instr(lower(text),lower(?))>0 DESC,id DESC LIMIT ?`)
                    .all(...args, ...terms, data.query.trim(), Number(k)),
            };
        }
        if (action === "record") {
            const text = data.text, eid = data.external_id;
            if (typeof text !== "string" || !text.trim() || text.length > MAX_TEXT)
                throw new Error("text must have 1-100000 characters");
            if (typeof eid !== "string" || !eid || eid.length > 250)
                throw new Error("external_id must have 1-250 characters");
            this.db.exec("BEGIN IMMEDIATE");
            try {
                const existing = this.db
                    .prepare("SELECT id,text FROM sources WHERE world=? AND session_key=? AND external_id=?")
                    .get(scope.world, scope.session_key, eid);
                if (existing) {
                    if (existing.text !== text)
                        throw new Error("external_id conflicts with existing evidence; use a new ID to correct it");
                    this.db.exec("COMMIT");
                    return {
                        source_id: existing.id,
                        stored: true,
                        replayed: true,
                        compiled: false,
                    };
                }
                let supersedes = null;
                if (data.supersedes !== undefined) {
                    if (!Number.isSafeInteger(data.supersedes) ||
                        Number(data.supersedes) < 1)
                        throw new Error("supersedes must be a source ID");
                    // A correction must remain in the same exact conversation, even with owner-private recall.
                    const prior = this.db
                        .prepare("SELECT id,external_id FROM sources WHERE id=? AND world=? AND session_key=? AND active=1")
                        .get(Number(data.supersedes), scope.world, scope.session_key);
                    if (!prior)
                        throw new Error("Correction source is absent, inactive or outside this conversation");
                    supersedes = {
                        world: scope.world,
                        session_key: scope.session_key,
                        external_id: String(prior.external_id),
                    };
                    this.db
                        .prepare("UPDATE sources SET active=0 WHERE id=?")
                        .run(Number(data.supersedes));
                }
                const metadata = {
                    evidence_type: data.capture === true ? "conversation" : "agent_note",
                    supersedes,
                };
                const result = this.db
                    .prepare("INSERT INTO sources(world,session_key,external_id,text,observed_at,metadata) VALUES(?,?,?,?,?,?)")
                    .run(scope.world, scope.session_key, eid, text, new Date().toISOString(), JSON.stringify(metadata));
                this.db.exec("COMMIT");
                return {
                    source_id: Number(result.lastInsertRowid),
                    stored: true,
                    compiled: false,
                };
            }
            catch (e) {
                this.db.exec("ROLLBACK");
                throw e;
            }
        }
        throw new Error("Unsupported local memory action");
    }
    doctor() {
        const ok = this.db.prepare("PRAGMA quick_check").get()?.quick_check === "ok";
        return {
            ok,
            schemaVersion: 1,
            code: ok ? "STORE_OK" : "STORE_INTEGRITY_FAILED",
        };
    }
    /** Explicit operator-only portability; never exposed as conversation tools. */
    export() {
        return this.db
            .prepare("SELECT * FROM sources ORDER BY id")
            .all()
            .map((r) => ({
            world: String(r.world),
            session_key: String(r.session_key),
            external_id: String(r.external_id),
            text: String(r.text),
            observed_at: String(r.observed_at),
            active: Boolean(r.active),
            metadata: {
                ...JSON.parse(String(r.metadata)),
                origin_source_id: JSON.parse(String(r.metadata)).origin_source_id ?? Number(r.id),
            },
        }));
    }
    import(records, apply = false) {
        for (const r of records) {
            if (!r ||
                ![r.world, r.session_key, r.external_id, r.text, r.observed_at].every((x) => typeof x === "string" && x.length > 0) ||
                typeof r.active !== "boolean" ||
                !r.metadata ||
                typeof r.metadata !== "object" ||
                Array.isArray(r.metadata))
                throw new Error("Invalid import evidence");
            if (r.text.length > MAX_TEXT ||
                r.external_id.length > 250 ||
                Number.isNaN(Date.parse(r.observed_at)))
                throw new Error("Import evidence exceeds source limits");
        }
        const staged = new Map();
        for (const r of records) {
            const key = JSON.stringify([r.world, r.session_key, r.external_id]);
            const prev = staged.get(key);
            if (prev && canonical(prev) !== canonical(r))
                throw new Error("Conflicting duplicate import IDs");
            staged.set(key, r);
        }
        this.db.exec("BEGIN IMMEDIATE");
        let inserted = 0, replayed = 0;
        try {
            for (const r of staged.values()) {
                const existing = this.db
                    .prepare("SELECT * FROM sources WHERE world=? AND session_key=? AND external_id=?")
                    .get(r.world, r.session_key, r.external_id);
                if (existing) {
                    if (existing.text !== r.text ||
                        Boolean(existing.active) !== r.active ||
                        existing.observed_at !== r.observed_at ||
                        canonical(provenanceMetadata(JSON.parse(String(existing.metadata)))) !== canonical(provenanceMetadata(r.metadata)))
                        throw new Error("Import conflicts with existing evidence; no records changed");
                    replayed++;
                    continue;
                }
                inserted++;
                if (apply)
                    this.db
                        .prepare("INSERT INTO sources(world,session_key,external_id,text,observed_at,active,metadata) VALUES(?,?,?,?,?,?,?)")
                        .run(r.world, r.session_key, r.external_id, r.text, r.observed_at, Number(r.active), JSON.stringify(r.metadata));
            }
            this.db.exec(apply ? "COMMIT" : "ROLLBACK");
            return { apply, inserted, replayed };
        }
        catch (e) {
            this.db.exec("ROLLBACK");
            throw e;
        }
    }
}
function canonical(value) {
    if (Array.isArray(value))
        return "[" + value.map(canonical).join(",") + "]";
    if (value && typeof value === "object")
        return ("{" +
            Object.keys(value)
                .sort()
                .map((k) => JSON.stringify(k) +
                ":" +
                canonical(value[k]))
                .join(",") +
            "}");
    return JSON.stringify(value);
}
// Export-only local row IDs are provenance, not evidence identity.
function provenanceMetadata(metadata) {
    const { origin_source_id: _origin, ...evidence } = metadata;
    return evidence;
}
