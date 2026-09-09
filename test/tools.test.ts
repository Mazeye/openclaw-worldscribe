import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WorldscribeClient, type ToolInfo } from "../src/client/mcp.js";
import { resolveConfig } from "../src/config.js";
import { submitDay } from "../src/diary/compile.js";
import { formatHint } from "../src/hooks.js";
import { TOOLS } from "../src/tools/catalog.js";
import { buildSchema, enabledTools, makeTool, type ToolDeps } from "../src/tools/register.js";
import { MockWorldscribe } from "./mock-server.js";

const mock = new MockWorldscribe({ worlds: { diary: { unit_label: "天", units_done: 3, events: 7 }, sgyy: { unit_label: "回", units_done: 120, events: 2800 } } });
let client: WorldscribeClient;
let schemas: Map<string, ToolInfo>;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ws-docs-"));
const cfg = resolveConfig({ ingest: { confirmAboveChars: 1000, allowLocalPaths: [tmp] }, tools: { enableForget: true } });
const logs: string[] = [];
const deps: ToolDeps = {
  cfg,
  client: () => client,
  backendError: () => undefined,
  schemas: () => schemas,
  logger: { info: () => {}, warn: (m) => logs.push(m), error: () => {} },
};
const call = async (name: string, params: Record<string, unknown>) => {
  const def = TOOLS.find((t) => t.name === name)!;
  const res = await makeTool(def, deps).execute("t1", params);
  return JSON.parse((res.content as Array<{ text: string }>)[0].text) as Record<string, any>;
};

beforeAll(async () => {
  await mock.start();
  client = new WorldscribeClient(mock.url);
  schemas = new Map((await client.listTools()).map((t) => [t.name, t]));
});
afterAll(async () => {
  await client.close();
  await mock.stop();
});

describe("tool surface", () => {
  it("derives schemas from the backend and adds world / path / confirm", () => {
    const recall = buildSchema(TOOLS.find((t) => t.name === "worldscribe_recall_entity")!, schemas.get("recall_entity"));
    expect(Object.keys((recall as any).properties)).toEqual(expect.arrayContaining(["name", "limit", "world"]));
    expect((recall as any).required).toEqual(["name"]);
    const ingest = buildSchema(TOOLS.find((t) => t.name === "worldscribe_ingest_document")!, schemas.get("ingest_document"));
    const props = Object.keys((ingest as any).properties);
    expect(props).toEqual(expect.arrayContaining(["url", "text", "path", "confirm", "world", "title"]));
    expect(props).not.toContain("single_unit");
    expect((ingest as any).required).toEqual([]);
    // no backend yet: still a valid object schema
    expect((buildSchema(TOOLS[0], undefined) as any).properties).toHaveProperty("world");
  });

  it("respects the enable flags", () => {
    expect(enabledTools(resolveConfig({})).map((t) => t.name)).not.toContain("worldscribe_forget");
    expect(enabledTools(resolveConfig({ tools: { enableIngest: false, enableForget: true } })).map((t) => t.name)).toEqual(
      expect.arrayContaining(["worldscribe_forget", "worldscribe_recall_entity"]),
    );
    expect(enabledTools(resolveConfig({ tools: { enableIngest: false } })).map((t) => t.name)).not.toContain("worldscribe_ingest_document");
  });

  it("routes recall tools by world and admin tools by parameter", async () => {
    mock.calls.length = 0;
    await call("worldscribe_recall_entity", { name: "刘备", world: "sgyy" });
    await call("worldscribe_describe_world", {});
    await call("worldscribe_ingest_status", { world: "sgyy" });
    expect(mock.calls.map((c) => [c.world, c.tool])).toEqual([
      ["sgyy", "recall_entity"],
      ["diary", "describe_world"],
      [undefined, "ingest_status"],
    ]);
    expect(mock.calls[2].args.world).toBe("sgyy");
  });

  it("gates large ingestion behind a cost confirmation, then submits", async () => {
    const big = "x".repeat(5000);
    const first = await call("worldscribe_ingest_document", { text: big, world: "book", title: "Big" });
    expect(first.needs_confirmation).toBe(true);
    expect(first.estimate.summary).toMatch(/\$/);
    expect(mock.calls.filter((c) => c.tool === "ingest_document").every((c) => c.args.dry_run)).toBe(true);
    const second = await call("worldscribe_ingest_document", { text: big, world: "book", title: "Big", confirm: true });
    expect(second.job.status).toBe("queued");
    expect(second.estimate.usd).toBeGreaterThan(0);
  });

  it("reads local files only under the allowed roots and decodes GB18030", async () => {
    const good = path.join(tmp, "novel.txt");
    fs.writeFileSync(good, Buffer.from("第一回 开篇\n话说天下大势。", "utf8"));
    const res = await call("worldscribe_ingest_document", { path: good, world: "book" });
    expect(res.dry_run ?? res.job).toBeTruthy();
    const sent = mock.calls.filter((c) => c.tool === "ingest_document").at(-1)!;
    expect(sent.args.text).toContain("话说天下大势");
    expect(sent.args.title).toBe("novel");
    const gbk = path.join(tmp, "gbk.txt");
    fs.writeFileSync(gbk, new TextEncoder().encode("") as never);
    fs.writeFileSync(gbk, Buffer.from(require("node:util").TextEncoder ? gb18030("第一回 宴桃园豪杰三结义 斩黄巾英雄首立功 话说天下大势分久必合合久必分") : ""));
    await call("worldscribe_ingest_document", { path: gbk, world: "book" });
    expect(mock.calls.filter((c) => c.tool === "ingest_document").at(-1)!.args.text).toContain("宴桃园豪杰三结义");
    const bad = await call("worldscribe_ingest_document", { path: "/etc/hosts", world: "book" });
    expect(bad.error).toMatch(/outside the allowed roots/);
  });

  it("record_note and forget proxy with sensible defaults", async () => {
    const r = await call("worldscribe_record_note", { text: "记一下：周五上线。", external_id: "note:1" });
    expect(r.event_ids).toEqual([42]);
    const sent = mock.calls.filter((c) => c.tool === "record_event").at(-1)!;
    expect(sent.world).toBe("diary");
    expect(sent.args.source_kind).toBe("note");
    const f = await call("worldscribe_forget", { world: "diary", external_id: "diary:2026-09-01", dry_run: true });
    expect(f.deleted_events).toBe(1);
  });

  it("reports a clear error when the backend is down", async () => {
    const down = { ...deps, client: () => undefined, backendError: () => "Docker is not running" };
    const res = await makeTool(TOOLS[0], down).execute("t", {});
    expect((res.content as Array<{ text: string }>)[0].text).toContain("Docker is not running");
  });
});

describe("diary submit + hint", () => {
  it("submits the day as an idempotent single unit and polls until done", async () => {
    const day = { date: "2026-09-08", text: "[09:12] user: 我们把数据库定为 PostgreSQL 吧。", chars: 40, turns: 1, agents: ["main"] };
    const dcfg = resolveConfig({ diary: { timezone: "Asia/Tokyo", ordinalEpoch: "2026-01-01", pollIntervalSec: 1 } });
    const job = await submitDay(client, dcfg, day, { sleep: async () => {} });
    expect(job.status).toBe("done");
    const sent = mock.calls.filter((c) => c.tool === "ingest_document").at(-1)!.args;
    expect(sent).toMatchObject({ world: "diary", single_unit: true, external_id: "diary:2026-09-08", ordinal: 251, source_kind: "chat_turn", unit_label: "天", observed_at: "2026-09-08T23:59:59+09:00" });
  });

  it("formats the optional system-prompt hint from list_worlds", () => {
    const hint = formatHint([{ id: "diary", unit_label: "天", units_done: 250, last_unit: 251, last_observed_at: "2026-09-08T23:59:59+09:00" }, { id: "sgyy", unit_label: "回", units_done: 120, last_unit: 120 }, { id: "empty", units_done: 0 }], cfg);
    expect(hint).toContain("diary (250 天, latest #251, through 2026-09-08)");
    expect(hint).toContain("sgyy (120 回, latest #120)");
    expect(hint).not.toContain("empty");
    expect(formatHint([{ id: "x", units_done: 0 }], cfg)).toBeUndefined();
  });
});

function gb18030(s: string): Uint8Array {
  // encode via iconv-free path: Node's TextDecoder can decode gb18030 but not encode, so build bytes from a known table
  // for the characters used above we rely on a tiny precomputed map produced with Python's gb18030 codec.
  const table: Record<string, string> = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "gb18030.json"), "utf8"));
  const bytes: number[] = [];
  for (const ch of s) {
    const hex = table[ch];
    if (!hex) {
      bytes.push(ch.charCodeAt(0));
      continue;
    }
    for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
  }
  return Uint8Array.from(bytes);
}
