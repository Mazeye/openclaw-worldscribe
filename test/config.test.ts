import { describe, expect, it } from "vitest";
import { backendUrl, imageRef, resolveConfig, resolveLlmKey } from "../src/config.js";

describe("config", () => {
  it("fills defaults", () => {
    const cfg = resolveConfig({});
    expect(cfg.backend.port).toBe(8765);
    expect(cfg.diary.time).toBe("03:30");
    expect(cfg.diary.include).toEqual(["transcripts", "dailyNotes"]);
    expect(cfg.ingest.allowLocalPaths).toEqual(["~/Downloads", "~/Documents"]);
    expect(backendUrl(cfg)).toBe("http://127.0.0.1:8765");
    expect(imageRef(cfg)).toBe("ghcr.io/mazeye/worldscribe:latest-bge");
  });

  it("keeps overrides and resolves external url / slim image / env key", () => {
    const cfg = resolveConfig({ backend: { mode: "external", url: "http://10.0.0.5:9000/" }, embedder: { kind: "remote", url: "https://e" }, llm: { apiKeyEnv: "WS_TEST_KEY" } });
    expect(backendUrl(cfg)).toBe("http://10.0.0.5:9000");
    expect(imageRef(cfg)).toBe("ghcr.io/mazeye/worldscribe:latest");
    expect(resolveLlmKey(cfg, { WS_TEST_KEY: "sk-x" })).toBe("sk-x");
    expect(resolveLlmKey(cfg, {})).toBeUndefined();
  });

  it("rejects external mode without url", () => {
    expect(() => resolveConfig({ backend: { mode: "external" } })).toThrow(/backend.url/);
  });
});
