import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureTurn,
  registerSourceArchive,
  sourceBinding,
  type SourceRoute,
} from "../src/source-archive.js";
const base = "agent:main:slack:default:direct:operator";
const session = base + ":thread:123.456";
const other = "agent:main:example:default:direct:family";
const routes: SourceRoute[] = [
  {
    sessionKey: base,
    world: "private-operator",
    allowThreads: true,
    ownerPrivate: true,
  },
  { sessionKey: other, world: "private-family" },
];
const context = { sessionKey: session, sessionId: "host-incarnation" };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ws-source-"));
const connectionFile = path.join(tmp, "connection.json");
function saveConnection(token = "fixture-token", value = routes) {
  fs.writeFileSync(
    connectionFile,
    JSON.stringify({ api_token: token, routes: value }),
    { mode: 0o600 },
  );
}
function setup(config: Record<string, unknown> = {}) {
  const factories = new Map<string, any>();
  const hooks = new Map<string, any>();
  const api = {
    pluginConfig: {
      storage: "source-api",
      sourceArchiveConnectionFile: connectionFile,
      ...config,
    },
    registerTool: (factory: any, opts: any) =>
      factories.set(opts.name, factory),
    on: (name: string, hook: any) => hooks.set(name, hook),
    registerCli: () => {},
    registerService: () => {},
    logger: { info: vi.fn(), warn: vi.fn() },
  };
  registerSourceArchive(api as any);
  return { factories, hooks, api };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fs.rmSync(connectionFile, { force: true });
});
describe("host privacy boundaries", () => {
  it("requires host authority and an explicit unambiguous route", () => {
    expect(sourceBinding({ sessionKey: session }, routes)).toBeUndefined();
    expect(sourceBinding(context, [])).toBeUndefined();
    expect(sourceBinding(context, [...routes, routes[0]])).toBeUndefined();
    expect(sourceBinding(context, routes)).toEqual({
      world: "private-operator",
      session_key: session,
      owner_private: false,
    });
  });
  it("narrows host owner-private authority with operator policy", () => {
    expect(
      sourceBinding(
        { ...context, memoryAudience: { kind: "owner-private" } },
        routes,
      )?.owner_private,
    ).toBe(true);
    expect(
      sourceBinding(
        { sessionKey: other, memoryAudience: { kind: "owner-private" } },
        routes,
      )?.owner_private,
    ).toBe(false);
    expect(
      sourceBinding(
        {
          ...context,
          memoryAudience: { kind: "conversation", sessionKey: other },
        },
        routes,
      ),
    ).toBeUndefined();
  });
  it("rejects groups, unknown routes, thread spoofing and non-private audiences", () => {
    for (const key of [
      "agent:main:cron:test",
      session.replace("direct", "group"),
      "evil:" + session,
      base + ":thread:..",
      base + "x:thread:123",
    ])
      expect(
        sourceBinding({ ...context, sessionKey: key }, routes),
      ).toBeUndefined();
    expect(
      sourceBinding({ ...context, memoryAudience: { kind: "shared" } }, routes),
    ).toBeUndefined();
  });
});
describe("source registration and invocation", () => {
  it("survives missing/malformed connection files and recovers without reload", () => {
    const factory = setup().factories.get("worldscribe_search_sources");
    expect(factory(context)).toBeNull();
    fs.writeFileSync(connectionFile, "invalid JSON containing fixture-secret");
    expect(factory(context)).toBeNull();
    saveConnection();
    expect(factory(context)?.name).toBe("worldscribe_search_sources");
  });
  it("honors recall/write switches including automatic writes", async () => {
    saveConnection();
    const { factories, hooks } = setup({
      tools: { enableRecall: false, enableWrite: false },
    });
    expect([...factories.keys()]).toEqual(["worldscribe_diagnostics"]);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await hooks.get("agent_end")(
      {
        success: true,
        messages: [
          { role: "user", content: "hello" },
          { role: "assistant", content: "answer" },
        ],
      },
      context,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rotates credentials, pins authority and detects revoked routes before IO", async () => {
    saveConnection();
    const tool = setup({
      backend: { port: 9876 },
      tools: { requestTimeoutMs: 1200 },
    }).factories.get("worldscribe_search_sources")(context);
    saveConnection("rotated-token");
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ hits: [] }) });
    vi.stubGlobal("fetch", fetch);
    await tool.execute("id", {
      query: "test",
      world: "other",
      session_key: other,
      owner_private: true,
    });
    expect(fetch.mock.calls[0][0]).toBe("http://127.0.0.1:9876/search");
    const options = fetch.mock.calls[0][1];
    expect(options.headers.Authorization).toBe("Bearer rotated-token");
    expect(JSON.parse(options.body)).toMatchObject({
      world: "private-operator",
      session_key: session,
      owner_private: false,
    });
    saveConnection("rotated-token", []);
    await expect(tool.execute("id", { query: "test" })).rejects.toThrow(
      /authorization changed/,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("obeys stale invocation guards before making requests", async () => {
    saveConnection();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const tool = setup().factories.get("worldscribe_get_sources")({
      ...context,
      assertInvocationCurrent: () => {
        throw Error("stale");
      },
    });
    await expect(tool.execute("id", { source_ids: [1] })).rejects.toThrow(
      "stale",
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it("captures successful final turns idempotently and can disable capture alone", async () => {
    saveConnection();
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ stored: true }) });
    vi.stubGlobal("fetch", fetch);
    const event = {
      success: true,
      runId: "run",
      messages: [
        { role: "user", content: "hello" },
        { role: "assistant", channel: "final", content: "answer" },
      ],
    };
    const { hooks } = setup();
    await hooks.get("agent_end")(event, context);
    await hooks.get("agent_end")(event, context);
    expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[1][1].body);
    await hooks.get("agent_end")({ ...event, success: false }, context);
    await setup({ sourceArchiveCapture: false }).hooks.get("agent_end")(
      event,
      context,
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
describe("visible-turn capture", () => {
  it("excludes history, tool messages, thinking and intermediate updates", () => {
    expect(
      captureTurn([
        { role: "user", content: "old" },
        { role: "assistant", content: "old answer" },
        {
          role: "user",
          content: [{ type: "text", text: "current" }, { type: "image" }],
        },
        { role: "assistant", channel: "commentary", content: "progress" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "calling tool" },
            { type: "toolCall" },
          ],
        },
        { role: "toolResult", content: "private result" },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "hidden" },
            { type: "text", text: "last answer" },
          ],
        },
      ]),
    ).toBe("user: current\n\nassistant: last answer");
  });
  it("skips malformed, incomplete, oversized and nonfinal-only turns", () => {
    for (const value of [
      undefined,
      {},
      [],
      [null],
      [{ role: "user", content: "hi" }],
      [
        { role: "user", content: "hi" },
        { role: "assistant", channel: "analysis", content: "hidden" },
      ],
      [
        { role: "user", content: "x".repeat(100000) },
        { role: "assistant", content: "answer" },
      ],
    ])
      expect(captureTurn(value)).toBeUndefined();
  });
});
