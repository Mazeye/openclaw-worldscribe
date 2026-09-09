import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WorldscribeClient, WorldscribeError } from "../src/client/mcp.js";
import { MockWorldscribe } from "./mock-server.js";

const mock = new MockWorldscribe({ worlds: { diary: { unit_label: "天", units_done: 3, events: 7 }, sgyy: { unit_label: "回", units_done: 120, events: 2800 } } });
let client: WorldscribeClient;

beforeAll(async () => {
  await mock.start();
  client = new WorldscribeClient(mock.url, { requestTimeoutMs: 5000 });
});
afterAll(async () => {
  await client.close();
  await mock.stop();
});

describe("WorldscribeClient", () => {
  it("routes per world and parses JSON results", async () => {
    const a = await client.callTool<{ world: string; unit: string }>("sgyy", "describe_world");
    const b = await client.callTool<{ world: string; unit: string }>(undefined, "describe_world");
    expect(a).toMatchObject({ world: "sgyy", unit: "回" });
    expect(b).toMatchObject({ world: "diary", unit: "天" });
    expect(mock.calls.map((c) => c.world)).toEqual(["sgyy", undefined]);
  });

  it("turns is_error results into WorldscribeError", async () => {
    await expect(client.callTool("nope", "describe_world")).rejects.toBeInstanceOf(WorldscribeError);
    await expect(client.callTool("nope", "describe_world")).rejects.toThrow(/unknown world: nope/);
  });

  it("lists backend tools with schemas", async () => {
    const tools = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("recall_entity");
    expect(names).toContain("ingest_document");
    const re = tools.find((t) => t.name === "recall_entity")!;
    expect((re.inputSchema as { properties: Record<string, unknown> }).properties).toHaveProperty("name");
  });
});
