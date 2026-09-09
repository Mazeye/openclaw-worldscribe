/** In-process stand-in for a world-routed Worldscribe service (Streamable HTTP MCP + /health). */
import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

export type Call = { world: string | undefined; tool: string; args: Record<string, unknown> };

export type MockOptions = {
  worlds?: Record<string, { unit_label: string; units_done: number; events: number }>;
  writable?: boolean;
  jobs?: Record<string, { status: string; error?: string; progress?: Record<string, unknown> }>;
  /** status sequence returned by successive ingest_status calls for a job id */
  jobSequence?: Record<string, string[]>;
};

export class MockWorldscribe {
  readonly calls: Call[] = [];
  private server!: http.Server;
  url = "";
  readonly worlds: NonNullable<MockOptions["worlds"]>;
  readonly jobs: NonNullable<MockOptions["jobs"]>;
  private readonly seq: Record<string, string[]>;
  private readonly writable: boolean;
  private jobCounter = 0;

  constructor(opts: MockOptions = {}) {
    this.worlds = opts.worlds ?? { diary: { unit_label: "天", units_done: 3, events: 7 } };
    this.jobs = opts.jobs ?? {};
    this.seq = opts.jobSequence ?? {};
    this.writable = opts.writable ?? true;
  }

  private build(world: string | undefined): McpServer {
    const s = new McpServer({ name: "mock-worldscribe", version: "0.0.0" });
    const rec = (tool: string, args: Record<string, unknown>) => this.calls.push({ world, tool, args });
    const json = (v: unknown, isError = false) => ({ content: [{ type: "text" as const, text: JSON.stringify(v) }], isError });
    const w = world ?? "diary";
    if (world && !this.worlds[world]) {
      s.registerTool("describe_world", { inputSchema: {} }, async () => ({ content: [{ type: "text" as const, text: `unknown world: ${world}` }], isError: true }));
      return s;
    }
    s.registerTool("describe_world", { description: "世界概览", inputSchema: {} }, async () => {
      rec("describe_world", {});
      const info = this.worlds[w];
      return json({ world: w, unit: info.unit_label, chapters_ingested: info.units_done, counts: { events: info.events } });
    });
    s.registerTool("recall_entity", { description: "列传", inputSchema: { name: z.string().describe("人物"), limit: z.number().optional() } }, async (a) => {
      rec("recall_entity", a);
      return json({ entity: { name: a.name }, events: [] });
    });
    s.registerTool("get_sources", { inputSchema: { source_ids: z.array(z.number()).optional() } }, async (a) => {
      rec("get_sources", a);
      return json({ sources: [] });
    });
    if (this.writable) {
      s.registerTool("record_event", { inputSchema: { text: z.string(), external_id: z.string().optional(), source_kind: z.string().optional(), ordinal: z.number().optional(), title: z.string().optional() } }, async (a) => {
        rec("record_event", a);
        return json({ doc_id: "manual", ordinal: 9, event_ids: [42] });
      });
      s.registerTool("list_worlds", { inputSchema: { world: z.string().optional() } }, async (a) => {
        rec("list_worlds", a);
        return json({ worlds: Object.entries(this.worlds).map(([id, v]) => ({ id, unit_label: v.unit_label, units_done: v.units_done, last_unit: v.units_done, last_observed_at: id === "diary" ? "2026-09-08T23:59:59+09:00" : null })) });
      });
      s.registerTool("create_world", { inputSchema: { world_id: z.string(), unit_label: z.string().optional() } }, async (a) => {
        rec("create_world", a);
        this.worlds[a.world_id] ??= { unit_label: a.unit_label ?? "章", units_done: 0, events: 0 };
        return json({ world: a.world_id });
      });
      s.registerTool(
        "ingest_document",
        {
          inputSchema: {
            world: z.string().optional(), text: z.string().optional(), url: z.string().optional(), doc_id: z.string().optional(), title: z.string().optional(),
            parser: z.string().optional(), dry_run: z.boolean().optional(), single_unit: z.boolean().optional(), external_id: z.string().optional(),
            source_kind: z.string().optional(), observed_at: z.string().optional(), event_time: z.string().optional(), ordinal: z.number().optional(),
            unit_label: z.string().optional(), language: z.string().optional(), name: z.string().optional(), description: z.string().optional(),
          },
        },
        async (a) => {
          rec("ingest_document", a);
          const chars = (a.text ?? "").length || 650000;
          const estimate = { units: a.single_unit ? 1 : 3, segments: Math.ceil(chars / 2000), chars, est_prompt_tokens: Math.round(chars * 3.5), est_completion_tokens: Math.round(chars * 3.6) };
          if (a.dry_run) return json({ dry_run: true, world: a.world, doc_id: a.doc_id ?? "doc", parser: "markdown", estimate });
          const id = `job${++this.jobCounter}`;
          this.jobs[id] = { status: "queued", progress: { units_total: estimate.units } };
          return json({ job: { id, status: "queued" }, world: a.world, doc_id: a.doc_id ?? "doc", parser: "markdown", estimate });
        },
      );
      s.registerTool("ingest_status", { inputSchema: { job_id: z.string().optional(), world: z.string().optional() } }, async (a) => {
        rec("ingest_status", a);
        if (a.job_id) {
          const job = this.jobs[a.job_id];
          if (!job) return json({ error: `unknown job ${a.job_id}` });
          const next = this.seq[a.job_id]?.shift() ?? (job.status === "queued" ? "running" : job.status === "running" ? "done" : undefined);
          if (next) job.status = next;
          if (job.status === "done") job.progress = { ...(job.progress ?? {}), events: 2, event_ids: [101, 102] };
          return json({ job: { id: a.job_id, ...job } });
        }
        return json({ jobs: Object.entries(this.jobs).map(([id, j]) => ({ id, ...j })) });
      });
      s.registerTool("delete_source", { inputSchema: { world: z.string().optional(), external_id: z.string().optional(), dry_run: z.boolean().optional() } }, async (a) => {
        rec("delete_source", a);
        return json({ world: a.world, deleted_events: 1, dry_run: Boolean(a.dry_run) });
      });
      s.registerTool("recompile_source", { inputSchema: { world: z.string().optional(), external_id: z.string().optional() } }, async (a) => {
        rec("recompile_source", a);
        return json({ world: a.world, event_ids: [7] });
      });
    }
    return s;
  }

  async start(): Promise<string> {
    this.server = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://x");
      if (url.pathname === "/health") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: true, world_routing: true, writable: this.writable, default_world: "diary", embedder: "hashing", version: "0.2.0", llm_configured: true, jobs: { running: 0, queued: 0 } }));
        return;
      }
      const m = /^\/w\/([^/]+)\/mcp$/.exec(url.pathname);
      const world = m ? decodeURIComponent(m[1]) : url.pathname === "/mcp" ? undefined : null;
      if (world === null) {
        res.statusCode = 404;
        res.end();
        return;
      }
      const server = this.build(world);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => void transport.close());
      await server.connect(transport);
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
      await transport.handleRequest(req, res, body);
    });
    await new Promise<void>((r) => this.server.listen(0, "127.0.0.1", r));
    const addr = this.server.address() as { port: number };
    this.url = `http://127.0.0.1:${addr.port}`;
    return this.url;
  }

  async stop(): Promise<void> {
    await new Promise<void>((r) => this.server.close(() => r()));
  }
}
