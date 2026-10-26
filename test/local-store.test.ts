import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalStore, type Evidence } from "../src/local-store.js";
const files: string[] = [];
const stores: LocalStore[] = [];
function store(file?: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ws-local-"));
  files.push(dir);
  const db = new LocalStore(file ?? path.join(dir, "memory.sqlite"));
  stores.push(db);
  return db;
}
const a = { world: "operator", session_key: "session-a", owner_private: false };
const b = { world: "family", session_key: "session-b", owner_private: false };
function note(
  db: LocalStore,
  text = "decision",
  eid = "note",
  scope = a,
  extra = {},
) {
  return db.execute(
    "record",
    { text, external_id: eid, ...extra },
    scope,
  ) as any;
}
afterEach(() => {
  for (const db of stores.splice(0)) db.close();
  for (const dir of files.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
});
describe("standalone evidence store", () => {
  it("persists, isolates contacts and exact conversations, and allows only scoped owner recall", () => {
    const db = store();
    const first = note(db, "PostgreSQL decision");
    note(db, "private family", "note", b);
    note(db, "other thread", "thread", { ...a, session_key: "session-c" });
    expect(
      (db.execute("get", { source_ids: [first.source_id] }, b) as any).sources,
    ).toEqual([]);
    expect((db.execute("describe", {}, a) as any).sources).toBe(1);
    expect(
      (db.execute("describe", {}, { ...a, owner_private: true }) as any)
        .sources,
    ).toBe(2);
    expect(
      (db.execute("search", { query: "PostgreSQL" }, a) as any).hits,
    ).toHaveLength(1);
    expect(() =>
      db.execute(
        "describe",
        {},
        { world: "", session_key: "", owner_private: false },
      ),
    ).toThrow(/Unbound/);
  });
  it("corrects append-only and rolls back failed revisions", () => {
    const db = store();
    const first = note(db, "old decision");
    const corrected = note(db, "new decision", "correction", a, {
      supersedes: first.source_id,
    });
    expect(
      (db.execute("search", { query: "old" }, a) as any).hits,
    ).toHaveLength(0);
    expect(
      (db.execute("get", { source_ids: [first.source_id] }, a) as any)
        .sources[0],
    ).toMatchObject({ text: "old decision", active: false });
    expect(
      (db.execute("get", { source_ids: [corrected.source_id] }, a) as any)
        .sources[0].metadata.supersedes,
    ).toEqual({
      world: a.world,
      session_key: a.session_key,
      external_id: "note",
    });
    expect(() =>
      note(db, "leak", "bad", b, { supersedes: corrected.source_id }),
    ).toThrow(/outside/);
    expect(() =>
      note(
        db,
        "cross-thread",
        "bad",
        { ...a, session_key: "session-c", owner_private: true },
        { supersedes: corrected.source_id },
      ),
    ).toThrow(/outside/);
    expect((db.execute("describe", {}, a) as any).sources).toBe(1);
  });
  it("replays identical IDs without changing evidence and rejects conflicting text", () => {
    const db = store();
    const first = note(db);
    expect(note(db).source_id).toBe(first.source_id);
    expect(() => note(db, "different")).toThrow(/conflicts/);
    expect(
      (db.execute("get", { source_ids: [first.source_id] }, a) as any)
        .sources[0].text,
    ).toBe("decision");
  });
  it("treats wildcard and SQL-like text literally and searches CJK", () => {
    const db = store();
    note(db, "猫的生日是九月二日");
    expect(
      (db.execute("search", { query: "生日" }, a) as any).hits,
    ).toHaveLength(1);
    for (const query of ["%", "_", "' OR 1=1 --"])
      expect((db.execute("search", { query }, a) as any).hits).toHaveLength(0);
    expect(() => db.execute("search", { query: "x", k: 999 }, a)).toThrow();
    expect(() => db.execute("get", { source_ids: ["1"] }, a)).toThrow();
  });
  it("roundtrips export and imports transactionally with dry-run and replay", () => {
    const db = store();
    note(db, "first");
    const records = db.export();
    expect(db.import(records, true).replayed).toBe(1);
    const target = store();
    expect(target.import(records)).toEqual({
      apply: false,
      inserted: 1,
      replayed: 0,
    });
    expect((target.execute("describe", {}, a) as any).sources).toBe(0);
    target.import(records, true);
    expect(target.import(records, true).replayed).toBe(1);
    expect(() =>
      target.import([{ ...records[0], metadata: { tampered: true } }], true),
    ).toThrow(/conflicts/);
    const conflict = { ...records[0], text: "conflicting" };
    expect(() =>
      target.import([{ ...records[0], external_id: "new" }, conflict], true),
    ).toThrow(/conflicts/);
    expect((target.execute("describe", {}, a) as any).sources).toBe(1);
    expect(() =>
      target.import(
        [{ ...records[0], active: "false" } as unknown as Evidence],
        true,
      ),
    ).toThrow(/Invalid/);
  });
  it("preserves correction links when imported row IDs change", () => {
    const db = store();
    const first = note(db, "old");
    note(db, "new", "correction", a, { supersedes: first.source_id });
    const target = store();
    note(target, "unrelated", "other", b);
    target.import(db.export(), true);
    const hits = (target.execute("search", { query: "new" }, a) as any).hits;
    const row = (target.execute("get", { source_ids: [hits[0].id] }, a) as any)
      .sources[0];
    expect(row.metadata.supersedes).toEqual({
      world: a.world,
      session_key: a.session_key,
      external_id: "note",
    });
    expect(row.id).not.toBe(2);
  });
  it("retains data after reopen and creates private files", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ws-reopen-"));
    files.push(dir);
    const file = path.join(dir, "memory.sqlite");
    const first = new LocalStore(file);
    note(first);
    first.close();
    const reopened = store(file);
    expect((reopened.execute("describe", {}, a) as any).sources).toBe(1);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(reopened.doctor().ok).toBe(true);
  });
});
