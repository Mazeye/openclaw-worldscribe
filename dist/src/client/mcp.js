/** Thin MCP Streamable-HTTP client for a world-routed Worldscribe service (`/mcp`, `/w/<world>/mcp`). */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
export class WorldscribeError extends Error {
    tool;
    constructor(message, tool) {
        super(message);
        this.tool = tool;
    }
}
export class WorldscribeClient {
    opts;
    clients = new Map();
    baseUrl;
    constructor(baseUrl, opts = {}) {
        this.opts = opts;
        this.baseUrl = baseUrl.replace(/\/+$/, "");
    }
    /** MCP endpoint for a world; `undefined` = the service's default world. */
    endpoint(world) {
        return world ? `${this.baseUrl}/w/${encodeURIComponent(world)}/mcp` : `${this.baseUrl}/mcp`;
    }
    async connect(world) {
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
    async listTools(world) {
        const c = await this.connect(world);
        const res = await c.listTools();
        return res.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
    }
    /**
     * Call a Worldscribe tool and parse its JSON text result. Tool-level failures (`is_error`) become WorldscribeError;
     * one transport retry covers a stale connection.
     */
    async callTool(world, name, args = {}, opts = {}) {
        const timeout = opts.timeoutMs ?? this.opts.requestTimeoutMs ?? 60000;
        const attempt = async () => {
            const c = await this.connect(world);
            const res = (await c.callTool({ name, arguments: args }, undefined, { timeout }));
            const text = (res.content ?? []).find((b) => b.type === "text")?.text ?? "";
            if (res.isError)
                throw new WorldscribeError(text || `tool ${name} failed`, name);
            try {
                return JSON.parse(text);
            }
            catch {
                return { text };
            }
        };
        try {
            return await attempt();
        }
        catch (e) {
            if (e instanceof WorldscribeError)
                throw e;
            this.opts.logger?.debug?.(`worldscribe: ${name} failed (${e.message}); reconnecting once`);
            this.clients.delete(world ?? "");
            return attempt();
        }
    }
    async close() {
        const all = [...this.clients.values()];
        this.clients.clear();
        await Promise.allSettled(all.map(async (p) => (await p).close()));
    }
}
