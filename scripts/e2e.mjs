#!/usr/bin/env node
/**
 * End-to-end smoke against a real Worldscribe stack (needs Docker and an LLM key):
 *   WS_E2E_KEY=sk-... WS_E2E_IMAGE=worldscribe WS_E2E_TAG=dev node scripts/e2e.mjs [path/to/novel.txt]
 * Brings the compose stack up on port 18777, ingests the file (or a tiny built-in sample), compiles a synthetic diary day
 * from a temp OPENCLAW_STATE_DIR, exercises recall tools, then tears the stack down (volumes purged).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveConfig } from "../dist/src/config.js";
import { addDays } from "../dist/src/diary/schedule.js";
import { formatDate } from "../dist/src/diary/transcripts.js";
import { WorldscribeRuntime } from "../dist/src/service.js";
import { TOOLS } from "../dist/src/tools/catalog.js";
import { makeTool } from "../dist/src/tools/register.js";

if (!process.env.WS_E2E_KEY) {
  console.error("set WS_E2E_KEY to an OpenAI-compatible LLM key (DeepSeek by default)");
  process.exit(2);
}
const state = fs.mkdtempSync(path.join(os.tmpdir(), "oc-e2e-"));
process.env.OPENCLAW_STATE_DIR = state;
const y = addDays(formatDate(new Date(), "UTC"), -1);
fs.mkdirSync(path.join(state, "agents/main/sessions"), { recursive: true });
fs.mkdirSync(path.join(state, "workspace/memory"), { recursive: true });
const line = (t, role, text) => JSON.stringify({ type: "message", timestamp: `${y}T${t}:00.000Z`, message: { role, content: [{ type: "text", text }] } });
fs.writeFileSync(
  path.join(state, "agents/main/sessions/sess-e2e.jsonl"),
  [
    JSON.stringify({ type: "session", id: "sess-e2e", timestamp: `${y}T01:00:00.000Z` }),
    line("01:10", "user", "今天我们把项目 Atlas 的数据库正式定为 PostgreSQL，不再考虑 Neo4j。"),
    line("01:11", "assistant", "记录：Atlas 的数据库选型定为 PostgreSQL。"),
    line("03:20", "user", "小王对这个决定很沮丧，周五再跟他聊一次。"),
  ].join("\n") + "\n",
);
fs.writeFileSync(path.join(state, `workspace/memory/${y}.md`), `# ${y}\n\n- 决定：Atlas 用 PostgreSQL\n`);

const sample = process.argv[2];
const sampleDir = fs.mkdtempSync(path.join(os.tmpdir(), "ws-doc-"));
const docPath = sample ?? path.join(sampleDir, "sample.md");
if (!sample) fs.writeFileSync(docPath, "# 第一章 启程\n\n王小明在 2026 年 3 月离开了北京，前往杭州加入星河公司。\n\n# 第二章 抉择\n\n在杭州，王小明选择了数据库方向，放弃了图数据库。\n\n# 第三章 回望\n\n年底他回到北京，星河公司已经改名为银河。\n");

const logger = { info: (m) => console.log("[info]", m), warn: (m) => console.log("[warn]", m), error: (m) => console.log("[error]", m) };
const cfg = resolveConfig({
  backend: { image: process.env.WS_E2E_IMAGE ?? "ghcr.io/mazeye/worldscribe", imageTag: process.env.WS_E2E_TAG ?? "latest", port: 18777, pullPolicy: process.env.WS_E2E_IMAGE ? "never" : "missing" },
  embedder: { kind: process.env.WS_E2E_EMBEDDER ?? "hashing" },
  llm: { apiKeyEnv: "WS_E2E_KEY" },
  diary: { enabled: false, timezone: "UTC", pollIntervalSec: 5 },
  ingest: { allowLocalPaths: [path.dirname(docPath)], confirmAboveChars: 500000 },
});
const rt = new WorldscribeRuntime(cfg, logger);
await rt.start();
if (rt.backendError) throw new Error(rt.backendError);
const deps = { cfg, client: () => rt.client, backendError: () => rt.backendError, schemas: () => rt.schemas, logger };
const call = async (name, params) => JSON.parse((await makeTool(TOOLS.find((t) => t.name === name), deps).execute("e2e", params)).content[0].text);
const fail = (m) => { throw new Error(m); };
try {
  const sub = await call("worldscribe_ingest_document", { path: docPath, world: "e2e-book", title: "sample" });
  if (!sub.job) fail(`ingest not submitted: ${JSON.stringify(sub)}`);
  console.log("ingest:", sub.estimate.summary);
  let job;
  for (let i = 0; i < 240; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    job = (await call("worldscribe_ingest_status", { job_id: sub.job.id })).job;
    if (!["queued", "running"].includes(job.status)) break;
  }
  if (job.status !== "done") fail(`job ${job.status}: ${job.error}`);
  const desc = await call("worldscribe_describe_world", { world: "e2e-book" });
  console.log("book:", desc.unit, desc.chapters_ingested, "units,", desc.counts.events, "events");
  if (!desc.counts.events) fail("no events compiled");
  const r1 = await rt.diary.runDay(y);
  const r2 = await rt.diary.runDay(y);
  console.log("diary:", JSON.stringify(r1), "replay:", r2.status);
  if (r1.status !== "done" || r2.status !== "done") fail("diary failed");
  const ss = await call("worldscribe_semantic_search", { query: "数据库选型", world: "diary", k: 3 });
  console.log("diary search:", (ss.events ?? []).map((e) => e.s ?? e.summary));
  if (!(ss.events ?? []).length) fail("diary recall empty");
  console.log("E2E OK");
} finally {
  await rt.stop();
  await rt.stack.down(true);
  fs.rmSync(state, { recursive: true, force: true });
  fs.rmSync(sampleDir, { recursive: true, force: true });
}
