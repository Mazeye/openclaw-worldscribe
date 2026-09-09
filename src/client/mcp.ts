/** Thin MCP Streamable-HTTP client for a world-routed Worldscribe service (`/mcp`, `/w/<world>/mcp`). */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export class WorldscribeError extends Error {
  constructor(
    message: string,
    readonly tool?: string,
  ) {
    super(message);
  }
}

export type ToolInfo = { name: string; description?: string; inputSchema: Record<string, unknown> };

type Logger = { debug?: (m: string) => void; warn: (m: string) => void };

export class WorldscribeClient {
  private clients = new Map<string, Promise<Client>>();
  readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly opts: { requestTimeoutMs?: number; logger?: Logger; clientInfo?: { name: string; version: string } } = {},
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  /** MCP endpoint for a world; `undefined` = the service's default world. */
  endpoint(world?: string): string {
    return world ? `${this.baseUrl}/w/${encodeURIComponent(world)}/mcp` : `${this.baseUrl}/mcp`;
  }

  private async connect(world?: string): Promise<Client> {
    const key = world ?? "";
    let pending = this.clients.get(key);
    if (!pending) {
      pending = (async () => {
        const client = new Client(this.opts.clientInfo ?? { name: "openclaw-worldscribe", version: "0.1.0" });
        const transport = new StreamableHTTPClientTransport(new URL(this.endpoint(world)));
        await client.connect(transport);
        client.onclose = () => this.clients.delete(key);
        return client;
      })();
      this.clients.set(key, pending);
      pending.catch(() => this.clients.delete(key));
    }
    return pending;
  }

  async listTools(world?: string): Promise<ToolInfo[]> {
    const c = await this.connect(world);
    const res = await c.listTools();
    return res.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema as Record<string, unknown> }));
  }

  /**
   * Call a Worldscribe tool and parse its JSON text result. Tool-level failures (`is_error`) become WorldscribeError;
   * one transport retry covers a stale connection.
   */
  async callTool<T = Record<string, unknown>>(world: string | undefined, name: string, args: Record<string, unknown> = {}, opts: { timeoutMs?: number } = {}): Promise<T> {
    const timeout = opts.timeoutMs ?? this.opts.requestTimeoutMs ?? 60000;
    const attempt = async (): Promise<T> => {
      const c = await this.connect(world);
      const res = (await c.callTool({ name, arguments: args }, undefined, { timeout })) as {
        content?: Array<{ type: string; text?: string }>;
        isError?: boolean;
      };
      const text = (res.content ?? []).find((b) => b.type === "text")?.text ?? "";
      if (res.isError) throw new WorldscribeError(text || `tool ${name} failed`, name);
      try {
        return JSON.parse(text) as T;
      } catch {
        return { text } as unknown as T;
      }
    };
    try {
      return await attempt();
    } catch (e) {
      if (e instanceof WorldscribeError) throw e;
      this.opts.logger?.debug?.(`worldscribe: ${name} failed (${(e as Error).message}); reconnecting once`);
      this.clients.delete(world ?? "");
      return attempt();
    }
  }

  async close(): Promise<void> {
    const all = [...this.clients.values()];
    this.clients.clear();
    await Promise.allSettled(all.map(async (p) => (await p).close()));
  }
}
