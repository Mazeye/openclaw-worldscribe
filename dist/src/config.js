/**
 * Plugin configuration: one TypeBox schema is the source of truth; `openclaw.plugin.json#configSchema` is generated
 * from it (`pnpm run schema`) so the manifest and the runtime validation never disagree.
 */
import { Type } from "typebox";
export const BackendSchema = Type.Object({
    mode: Type.Union([Type.Literal("compose"), Type.Literal("external")], { default: "compose" }),
    url: Type.Optional(Type.String({ description: "external mode: base URL of a running `worldscribe serve-http --world-routing`" })),
    port: Type.Integer({ default: 8765, minimum: 1, maximum: 65535 }),
    image: Type.String({ default: "ghcr.io/mazeye/worldscribe" }),
    imageTag: Type.String({ default: "latest" }),
    pullPolicy: Type.Union([Type.Literal("missing"), Type.Literal("always"), Type.Literal("never")], { default: "missing" }),
    buildFrom: Type.Optional(Type.String({ description: "dev only: path of a Worldscribe checkout to build the image from" })),
    startupTimeoutSec: Type.Integer({ default: 240, minimum: 10 }),
    autoStart: Type.Boolean({ default: true }),
    stopOnGatewayStop: Type.Boolean({ default: false }),
}, { additionalProperties: false });
export const LlmSchema = Type.Object({
    baseUrl: Type.String({ default: "https://api.deepseek.com" }),
    apiKey: Type.Optional(Type.String()),
    apiKeyEnv: Type.Optional(Type.String({ description: "name of an environment variable holding the API key" })),
    model: Type.String({ default: "deepseek-v4-flash" }),
    concurrency: Type.Integer({ default: 4, minimum: 1, maximum: 32 }),
    priceInPerMTok: Type.Number({ default: 0.28, minimum: 0 }),
    priceOutPerMTok: Type.Number({ default: 0.42, minimum: 0 }),
}, { additionalProperties: false });
export const EmbedderSchema = Type.Object({
    kind: Type.Union([Type.Literal("bge-m3"), Type.Literal("remote"), Type.Literal("hashing")], { default: "bge-m3" }),
    url: Type.Optional(Type.String()),
    secret: Type.Optional(Type.String()),
}, { additionalProperties: false });
export const WorldsSchema = Type.Object({
    diary: Type.String({ default: "diary" }),
    defaultRecall: Type.String({ default: "diary" }),
    language: Type.String({ default: "zh" }),
}, { additionalProperties: false });
export const DiarySchema = Type.Object({
    enabled: Type.Boolean({ default: true }),
    time: Type.String({ default: "03:30", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" }),
    timezone: Type.Optional(Type.String({ description: "IANA time zone; default = host" })),
    idleMinutes: Type.Integer({ default: 30, minimum: 0 }),
    include: Type.Array(Type.Union([Type.Literal("transcripts"), Type.Literal("dailyNotes")]), {
        default: ["transcripts", "dailyNotes"],
    }),
    agentIds: Type.Array(Type.String(), { default: ["main"] }),
    includeToolResults: Type.Boolean({ default: false }),
    maxToolResultChars: Type.Integer({ default: 400, minimum: 0 }),
    maxChars: Type.Integer({ default: 200000, minimum: 1000 }),
    minChars: Type.Integer({ default: 200, minimum: 0 }),
    catchUpMaxDays: Type.Integer({ default: 7, minimum: 0 }),
    ordinalEpoch: Type.String({ default: "2026-01-01", pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
    skipEmptyDays: Type.Boolean({ default: true }),
    pollIntervalSec: Type.Integer({ default: 15, minimum: 1 }),
    jobTimeoutMin: Type.Integer({ default: 120, minimum: 1 }),
}, { additionalProperties: false });
export const IngestSchema = Type.Object({
    maxChars: Type.Integer({ default: 2000000, minimum: 1000 }),
    confirmAboveChars: Type.Integer({ default: 200000, minimum: 0 }),
    allowLocalPaths: Type.Array(Type.String(), { default: ["~/Downloads", "~/Documents"] }),
}, { additionalProperties: false });
export const ToolsSchema = Type.Object({
    enableRecall: Type.Boolean({ default: true }),
    enableIngest: Type.Boolean({ default: true }),
    enableWrite: Type.Boolean({ default: true }),
    enableForget: Type.Boolean({ default: false }),
    requestTimeoutMs: Type.Integer({ default: 60000, minimum: 1000 }),
}, { additionalProperties: false });
export const ConfigSchema = Type.Object({
    sourceArchiveConnectionFile: Type.Optional(Type.String({ description: "Private source API connection JSON; defaults to <OpenClaw state>/worldscribe-source/connection.json" })),
    sourceArchiveCapture: Type.Optional(Type.Boolean({ default: true, description: "Archive successful private turns; also requires tools.enableWrite" })),
    sourceArchive: Type.Optional(Type.Boolean({ default: false, description: "Local lossless source-memory mode; no LLM compilation" })),
    backend: Type.Optional(BackendSchema),
    llm: Type.Optional(LlmSchema),
    embedder: Type.Optional(EmbedderSchema),
    worlds: Type.Optional(WorldsSchema),
    diary: Type.Optional(DiarySchema),
    ingest: Type.Optional(IngestSchema),
    tools: Type.Optional(ToolsSchema),
    recall: Type.Optional(Type.Object({ promptHint: Type.Union([Type.Literal("off"), Type.Literal("hint")], { default: "off" }) }, { additionalProperties: false })),
    logLevel: Type.Optional(Type.Union([Type.Literal("debug"), Type.Literal("info"), Type.Literal("warn")], { default: "info" })),
}, { additionalProperties: false });
/** Fill defaults declared in the schema (one level of nesting is all we use). */
function withDefaults(schema, value) {
    const out = {};
    for (const [key, prop] of Object.entries(schema.properties)) {
        const v = value?.[key];
        out[key] = v === undefined ? (Array.isArray(prop.default) ? [...prop.default] : prop.default) : v;
    }
    return out;
}
export function resolveConfig(raw) {
    const r = (raw ?? {});
    const cfg = {
        backend: withDefaults(BackendSchema, r.backend),
        llm: withDefaults(LlmSchema, r.llm),
        embedder: withDefaults(EmbedderSchema, r.embedder),
        worlds: withDefaults(WorldsSchema, r.worlds),
        diary: withDefaults(DiarySchema, r.diary),
        ingest: withDefaults(IngestSchema, r.ingest),
        tools: withDefaults(ToolsSchema, r.tools),
        recall: { promptHint: r.recall?.promptHint ?? "off" },
        logLevel: r.logLevel ?? "info",
    };
    if (cfg.backend.mode === "external" && !cfg.backend.url) {
        throw new Error("worldscribe: backend.mode=external requires backend.url");
    }
    return cfg;
}
/** Base URL of the Worldscribe HTTP service for this config. */
export function backendUrl(cfg) {
    return cfg.backend.mode === "external" ? cfg.backend.url.replace(/\/+$/, "") : `http://127.0.0.1:${cfg.backend.port}`;
}
/** Resolve the LLM key from config or the named environment variable (never logged). */
export function resolveLlmKey(cfg, env = process.env) {
    if (cfg.llm.apiKey)
        return cfg.llm.apiKey;
    if (cfg.llm.apiKeyEnv)
        return env[cfg.llm.apiKeyEnv] || undefined;
    return undefined;
}
/** Image tag for the chosen embedder: the in-container model needs the `-bge` variant. */
export function imageRef(cfg) {
    const suffix = cfg.embedder.kind === "bge-m3" ? "-bge" : "";
    return `${cfg.backend.image}:${cfg.backend.imageTag}${suffix}`;
}
