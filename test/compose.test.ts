import { describe, expect, it } from "vitest";
import { envFileText, renderEnv } from "../src/backend/compose.js";
import { detectDocker, DockerUnavailable } from "../src/backend/docker.js";
import { resolveConfig } from "../src/config.js";

describe("compose env", () => {
  it("renders the compose environment from config", () => {
    const cfg = resolveConfig({ llm: { apiKeyEnv: "K" }, worlds: { diary: "journal" } });
    const env = renderEnv(cfg, { K: "sk-1" });
    expect(env).toMatchObject({ WS_IMAGE: "ghcr.io/mazeye/worldscribe:latest-bge", WS_PORT: "8765", WS_LLM_API_KEY: "sk-1", WS_WORLD: "journal", WS_EMBEDDER: "bge-m3", WS_EMBED_WARMUP: "1" });
    expect(envFileText(env)).toContain("WS_LLM_API_KEY=sk-1\n");
  });
});

describe("detectDocker", () => {
  it("explains a missing docker binary", async () => {
    const runner = async () => {
      throw new Error("spawn docker ENOENT");
    };
    await expect(detectDocker(runner as never)).rejects.toBeInstanceOf(DockerUnavailable);
    await expect(detectDocker(runner as never)).rejects.toThrow(/backend.mode="external"/);
  });
  it("explains a stopped daemon and a missing compose plugin", async () => {
    const daemonDown = async () => ({ code: 1, stdout: "", stderr: "Cannot connect to the Docker daemon" });
    await expect(detectDocker(daemonDown as never)).rejects.toThrow(/daemon not reachable/);
    const noCompose = async (_c: string, args: string[]) => (args[0] === "version" ? { code: 0, stdout: "28.0\n", stderr: "" } : { code: 1, stdout: "", stderr: "unknown command compose" });
    await expect(detectDocker(noCompose as never)).rejects.toThrow(/compose v2/);
    const ok = async (_c: string, args: string[]) => ({ code: 0, stdout: args[0] === "version" ? "28.0\n" : "2.34\n", stderr: "" });
    expect(await detectDocker(ok as never)).toEqual({ version: "28.0", composeVersion: "2.34" });
  });
});
