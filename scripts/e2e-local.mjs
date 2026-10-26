/** Isolated standalone smoke: real SQLite and plugin registration, no services. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "worldscribe-e2e-"));
process.env.OPENCLAW_STATE_DIR = dir;
const originalFetch = globalThis.fetch;
globalThis.fetch = () => {
  throw Error("Standalone smoke forbids network access");
};
const sessionKey = "agent:main:example:default:direct:synthetic";
const routesFile = path.join(dir, "routes.json");
fs.writeFileSync(
  routesFile,
  JSON.stringify({ routes: [{ sessionKey, world: "synthetic" }] }),
  { mode: 0o600 },
);
const tools = new Map(),
  services = [],
  hooks = new Map();
try {
  const { default: plugin } = await import("../dist/index.js");
  const { register } = plugin;
  register({
    pluginConfig: { routesFile },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    registerTool: (factory, opts) =>
      tools.set(
        opts.name,
        typeof factory === "function"
          ? factory({ sessionKey, sessionId: "synthetic-host-incarnation" })
          : factory,
      ),
    registerCli: () => {},
    registerService: (s) => services.push(s),
    on: (name, fn) => hooks.set(name, fn),
  });
  assert.equal(
    fs.existsSync(path.join(dir, "worldscribe", "memory.sqlite")),
    false,
    "registration must not open a DB",
  );
  const call = async (name, args = {}) =>
    (await tools.get(name).execute("synthetic", args)).details;
  const stored = await call("worldscribe_record_note", {
    text: "Chosen database is SQLite",
    external_id: "synthetic:one",
  });
  const hits = await call("worldscribe_search_sources", { query: "SQLite" });
  assert.equal(hits.hits.length, 1);
  assert.equal(
    (await call("worldscribe_get_sources", { source_ids: [stored.source_id] }))
      .sources[0].text,
    "Chosen database is SQLite",
  );
  await call("worldscribe_record_note", {
    text: "Chosen database is local SQLite",
    external_id: "synthetic:two",
    supersedes: stored.source_id,
  });
  assert.equal((await call("worldscribe_describe_world")).sources, 1);
  assert.equal((await call("worldscribe_diagnostics")).ok, true);
  const { exportFile, importFile } = await import("../dist/src/archive-cli.js");
  const { ArchiveRuntime } = await import("../dist/src/archive-runtime.js");
  const source = new ArchiveRuntime({ routesFile });
  const target = new ArchiveRuntime({
    routesFile,
    databaseFile: path.join(dir, "restored.sqlite"),
  });
  try {
    const output = path.join(dir, "evidence.jsonl");
    assert.equal((await exportFile(source, output)).exported, 2);
    assert.equal((await importFile(target, output, false)).inserted, 2);
    assert.equal((await importFile(target, output, true)).inserted, 2);
    assert.equal((await importFile(target, output, true)).replayed, 2);
  } finally {
    await source.close();
    await target.close();
  }
  console.log(
    JSON.stringify({
      ok: true,
      registration: true,
      scopedReadWrite: true,
      correction: true,
      portability: true,
      networkCalls: 0,
    }),
  );
} finally {
  for (const service of services) await service.stop?.();
  globalThis.fetch = originalFetch;
  fs.rmSync(dir, { recursive: true, force: true });
}
