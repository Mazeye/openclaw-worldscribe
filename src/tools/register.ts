/** Register the worldscribe_* tools with OpenClaw; each proxies to the Worldscribe MCP service. */
import fs from "node:fs";
import type { AnyAgentTool, OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { textResult } from "openclaw/plugin-sdk/tool-results";
import { Type, type TSchema } from "typebox";
import type { WorldscribeClient, ToolInfo } from "../client/mcp.js";
import { WorldscribeError } from "../client/mcp.js";
import type { Config } from "../config.js";
import { type BackendEstimate, costEstimate } from "../estimate.js";
import { expandHome, isUnderAllowedRoots } from "../paths.js";
import { TOOLS, type ToolDef } from "./catalog.js";

export type ToolDeps = {
  cfg: Config;
  client: () => WorldscribeClient | undefined; // undefined while the backend is down
  backendError: () => string | undefined;
  schemas: () => Map<string, ToolInfo> | undefined; // cached backend tool list (default world route)
  logger: OpenClawPluginApi["logger"];
};

const WORLD_PROP = { world: { type: "string", description: "Memory world id (default: the configured default world). See worldscribe_list_worlds." } };

/** Build the TypeBox schema for a tool from the backend's JSON schema (plus `world`, minus plugin-handled params). */
export function buildSchema(def: ToolDef, backend: ToolInfo | undefined): TSchema {
  const src = (backend?.inputSchema ?? { type: "object", properties: {} }) as { properties?: Record<string, unknown>; required?: string[] };
  const properties: Record<string, unknown> = { ...(src.properties ?? {}) };
  for (const p of def.dropParams ?? []) delete properties[p];
  let required = (src.required ?? []).filter((r) => !(def.dropParams ?? []).includes(r));
  if (def.name === "worldscribe_ingest_document") {
    properties.path = { type: "string", description: "Local file path (txt / md / html) under the allowed roots" };
    properties.confirm = { type: "boolean", description: "Set true after the user accepted the cost estimate", default: false };
    required = required.filter((r) => r !== "text" && r !== "url");
  }
  if (def.name === "worldscribe_record_note") {
    properties.source_kind = { type: "string", description: "note | email | chat_turn", default: "note" };
  }
  Object.assign(properties, WORLD_PROP);
  return Type.Unsafe({ type: "object", properties, required, additionalProperties: false });
}

async function readLocalFile(p: string, cfg: Config): Promise<string> {
  const file = expandHome(p);
  if (!isUnderAllowedRoots(file, cfg.ingest.allowLocalPaths)) {
    throw new WorldscribeError(`path ${p} is outside the allowed roots (${cfg.ingest.allowLocalPaths.join(", ")}); configure ingest.allowLocalPaths`);
  }
  const buf = fs.readFileSync(file);
  let text = buf.toString("utf8");
  const bad = (text.match(/�/g) ?? []).length;
  if (bad > 0 && bad > text.length / 500) {
    text = new TextDecoder("gb18030").decode(buf);
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (text.length > cfg.ingest.maxChars) {
    throw new WorldscribeError(`file has ${text.length} chars; ingest.maxChars is ${cfg.ingest.maxChars}`);
  }
  return text;
}

function fail(message: string, details: Record<string, unknown> = {}) {
  return textResult(JSON.stringify({ error: message, ...details }), { error: message, ...details });
}

function ok(result: unknown) {
  return textResult(JSON.stringify(result), result);
}

export function makeTool(def: ToolDef, deps: ToolDeps): AnyAgentTool {
  const backendInfo = deps.schemas()?.get(def.backend);
  return {
    name: def.name,
    label: def.label,
    description: def.description,
    parameters: buildSchema(def, backendInfo),
    async execute(_toolCallId: string, rawParams: unknown) {
      const params = { ...((rawParams ?? {}) as Record<string, unknown>) };
      const client = deps.client();
      if (!client) return fail(deps.backendError() ?? "Worldscribe backend is not running; run `openclaw worldscribe up` or check `openclaw worldscribe doctor`.");
      const world = (typeof params.world === "string" && params.world) || deps.cfg.worlds.defaultRecall;
      delete params.world;
      try {
        switch (def.kind) {
          case "ingest":
            return await ingestDocument(client, params, world, deps);
          case "write":
            return await recordNote(client, params, world, deps);
          default: {
            // recall tools route by world; admin tools (list_worlds/ingest_status/delete_source) take `world` as a param
            const admin = def.backend === "list_worlds" || def.backend === "ingest_status" || def.backend === "delete_source";
            const result = admin
              ? await client.callTool(undefined, def.backend, { ...params, world })
              : await client.callTool(world, def.backend, params);
            return ok(result);
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        deps.logger.warn(`worldscribe: ${def.name} failed: ${msg}`);
        return fail(msg, { tool: def.name });
      }
    },
  };
}

async function ingestDocument(client: WorldscribeClient, params: Record<string, unknown>, world: string, deps: ToolDeps) {
  const { cfg } = deps;
  const confirm = params.confirm === true;
  delete params.confirm;
  if (typeof params.path === "string" && params.path) {
    params.text = await readLocalFile(params.path, cfg);
    params.title = params.title ?? params.path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "");
    delete params.path;
  }
  if (typeof params.text === "string" && params.text.length > cfg.ingest.maxChars) {
    return fail(`text has ${params.text.length} chars; ingest.maxChars is ${cfg.ingest.maxChars}`);
  }
  const dry = await client.callTool<{ error?: string; estimate?: BackendEstimate; parser?: string; doc_id?: string }>(undefined, "ingest_document", {
    ...params,
    world,
    dry_run: true,
  }, { timeoutMs: Math.max(cfg.tools.requestTimeoutMs, 120000) });
  if (dry.error || !dry.estimate) return ok(dry);
  const cost = costEstimate(dry.estimate, cfg, { confirm });
  if (cost.needsConfirmation) {
    return ok({
      needs_confirmation: true,
      world,
      doc_id: dry.doc_id,
      parser: dry.parser,
      estimate: { ...dry.estimate, usd: Number(cost.usd.toFixed(2)), minutes: cost.minutes, summary: cost.summary },
      hint: "Ask the user to confirm this cost, then call worldscribe_ingest_document again with confirm=true.",
    });
  }
  const res = await client.callTool<Record<string, unknown>>(undefined, "ingest_document", { ...params, world }, {
    timeoutMs: Math.max(cfg.tools.requestTimeoutMs, 120000),
  });
  return ok({ ...res, estimate: { ...dry.estimate, usd: Number(cost.usd.toFixed(2)), minutes: cost.minutes, summary: cost.summary } });
}

async function recordNote(client: WorldscribeClient, params: Record<string, unknown>, world: string, deps: ToolDeps) {
  const text = typeof params.text === "string" ? params.text : "";
  if (!text.trim()) return fail("text is required");
  const args = { ...params, source_kind: params.source_kind ?? "note" };
  if (text.length > 20000) {
    // long notes go through the job runner so the request returns quickly
    const res = await client.callTool<Record<string, unknown>>(undefined, "ingest_document", {
      world,
      text,
      single_unit: true,
      doc_id: params.doc_id ?? "notes",
      external_id: params.external_id,
      source_kind: args.source_kind,
      observed_at: params.observed_at,
      event_time: params.event_time,
      ordinal: params.ordinal,
    });
    return ok(res);
  }
  const res = await client.callTool<Record<string, unknown>>(world, "record_event", args, { timeoutMs: Math.max(deps.cfg.tools.requestTimeoutMs, 300000) });
  return ok(res);
}

/** Which catalog entries are enabled by config. */
export function enabledTools(cfg: Config): ToolDef[] {
  return TOOLS.filter((t) => {
    if (t.kind === "recall") return cfg.tools.enableRecall;
    if (t.kind === "ingest") return cfg.tools.enableIngest;
    if (t.kind === "write") return cfg.tools.enableWrite;
    return cfg.tools.enableForget;
  });
}

export function registerTools(api: OpenClawPluginApi, deps: ToolDeps): void {
  for (const def of enabledTools(deps.cfg)) {
    api.registerTool(() => makeTool(def, deps), { name: def.name, optional: def.optional });
  }
}
