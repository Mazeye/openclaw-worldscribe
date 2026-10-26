import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArchiveRuntime } from "../src/archive-runtime.js";
import { storageMode, resolveConfig } from "../src/config.js";
import { exportFile, importFile } from "../src/archive-cli.js";
const dirs: string[] = [];
const runtimes: ArchiveRuntime[] = [];
function fixture(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ws-runtime-"));
  dirs.push(dir);
  const routesFile = path.join(dir, "routes.json");
  fs.writeFileSync(
    routesFile,
    JSON.stringify({
      routes: [
        {
          sessionKey: "agent:main:example:default:direct:fixture",
          world: "fixture",
        },
      ],
    }),
  );
  const rt = new ArchiveRuntime({
    routesFile,
    databaseFile: path.join(dir, "memory.sqlite"),
    ...extra,
  });
  runtimes.push(rt);
  return { rt, dir, routesFile };
}
afterEach(async () => {
  for (const rt of runtimes.splice(0)) await rt.close();
  for (const dir of dirs.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});
describe("agent-native runtime", () => {
  it("defaults to standalone but never silently switches existing API deployments", () => {
    expect(storageMode({})).toBe("local");
    expect(storageMode({llm:{...resolveConfig({}).llm,model:"legacy-model"}})).toBe("legacy");
    expect(storageMode({storage:"local",llm:{...resolveConfig({}).llm,model:"ignored"}})).toBe("local");
    expect(storageMode({ sourceArchive: true })).toBe("source-api");
    expect(storageMode({ sourceArchive: true, storage: "local" })).toBe(
      "local",
    );
    expect(storageMode({ storage: "legacy" })).toBe("legacy");
  });
  it("operates without services, network, tokens or compiler checkout", async () => {
    const { rt } = fixture();
    const fetch = vi.fn(() => {
      throw Error("network forbidden");
    });
    vi.stubGlobal("fetch", fetch);
    const scope = {
      world: "fixture",
      session_key: "agent:main:example:default:direct:fixture",
      owner_private: false,
    };
    await rt.call(
      "record",
      { text: "independent memory", external_id: "one" },
      scope,
    );
    expect(
      ((await rt.call("search", { query: "independent" }, scope)) as any).hits,
    ).toHaveLength(1);
    expect((await rt.doctor()).ok).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("diagnoses configuration failure without exposing paths, secrets, identity or evidence", async () => {
    const { rt, routesFile } = fixture();
    fs.writeFileSync(routesFile, "secret-token-private-identity");
    const report = await rt.doctor();
    expect(report.ok).toBe(false);
    const text = JSON.stringify(report);
    expect(text).not.toContain(routesFile);
    expect(text).not.toContain("secret-token");
    expect(text).not.toContain("private-identity");
    expect(report.maintenance).toMatchObject({
      allowIssues: false,
      allowPRs: false,
      allowMerge: false,
    });
  });
  it("supports private, no-overwrite portable export and dry-run import", async () => {
    const { rt, dir } = fixture();
    const scope = {
      world: "fixture",
      session_key: "session",
      owner_private: false,
    };
    await rt.call(
      "record",
      { text: "original evidence", external_id: "one" },
      scope,
    );
    const file = path.join(dir, "export.jsonl");
    expect(await exportFile(rt, file)).toEqual({ exported: 1 });
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    await expect(exportFile(rt, file)).rejects.toThrow();
    const target = fixture().rt;
    expect(await importFile(target, file, false)).toMatchObject({
      apply: false,
      inserted: 1,
    });
    expect(await importFile(target, file, true)).toMatchObject({
      apply: true,
      inserted: 1,
    });
  });
});
