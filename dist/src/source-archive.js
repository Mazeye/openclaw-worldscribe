/** Local Worldscribe source memory. Privacy authority is supplied by the host,
 * never by tool parameters. No prompt-time network requests or native SQLite. */
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { expandHome, stateDir } from "./paths.js";
import { resolveConfig } from "./config.js";
import { Type } from "typebox";
export function sourceBinding(ctx, routes) {
    const key = ctx.sessionKey?.toLowerCase();
    // Older hosts omit memoryAudience: require a session incarnation and stay
    // within the exact source session. Never infer cross-conversation authority.
    const audience = ctx.memoryAudience ?? (ctx.sessionId ? { kind: "conversation", sessionKey: ctx.sessionKey } : undefined);
    if (!key || !audience)
        return;
    if (audience.kind === "conversation" && audience.sessionKey?.toLowerCase() !== key)
        return;
    if (audience.kind !== "conversation" && audience.kind !== "owner-private")
        return;
    const matches = routes.filter(route => {
        const base = route.sessionKey.toLowerCase();
        if (key === base)
            return true;
        const suffix = key.slice(base.length);
        return route.allowThreads === true && key.startsWith(base) && /^:thread:[0-9]+(?:\.[0-9]+)?$/.test(suffix);
    });
    // Ambiguous mappings cannot select a privacy partition by array order.
    if (matches.length !== 1)
        return;
    const route = matches[0];
    return { world: route.world, session_key: key, owner_private: audience.kind === "owner-private" && route.ownerPrivate === true };
}
/** Take only the last user's message and last visible assistant response.
 * Tool-call messages and explicit analysis/commentary are not a final response.
 * Older transcripts without channel metadata retain the last text response.
 */
export function captureTurn(raw) {
    if (!Array.isArray(raw))
        return;
    const messages = raw;
    let start = -1;
    for (let i = messages.length - 1; i >= 0; i--)
        if (messages[i]?.role === "user") {
            start = i;
            break;
        }
    if (start < 0)
        return;
    const visible = (m) => {
        if (typeof m.content === "string")
            return m.content.trim();
        if (!Array.isArray(m.content))
            return "";
        return m.content.filter(b => b?.type === "text" && typeof b.text === "string").map(b => b.text).join("\n").trim();
    };
    const user = visible(messages[start]);
    let answer = "";
    for (let i = messages.length - 1; i > start; i--) {
        const m = messages[i];
        if (m?.role !== "assistant" || (m.channel && m.channel !== "final"))
            continue;
        if (Array.isArray(m.content) && m.content.some(b => ["toolCall", "tool_call", "tool_use"].includes(b?.type)))
            continue;
        answer = visible(m);
        if (answer)
            break;
    }
    if (!user || !answer)
        return;
    const text = `user: ${user}\n\nassistant: ${answer}`;
    return text.length <= 100000 ? text : undefined;
}
function guard(ctx) {
    ctx.assertInvocationCurrent?.();
    ctx.assertMemoryAudienceCurrent?.();
}
export function registerSourceArchive(api) {
    const raw = (api.pluginConfig ?? {});
    const cfg = resolveConfig(raw);
    const connectionFile = expandHome(raw.sourceArchiveConnectionFile ?? path.join(stateDir(), "worldscribe-source", "connection.json"));
    // Read lazily: absent/rotated credentials must not break plugin registration.
    // Operator-controlled routes stay outside source code, tools and prompts.
    function connection() {
        try {
            const conn = JSON.parse(fs.readFileSync(connectionFile, "utf8"));
            if (typeof conn.api_token !== "string" || !conn.api_token.trim() || !Array.isArray(conn.routes) ||
                conn.routes.some(r => !r || typeof r.sessionKey !== "string" || !r.sessionKey || typeof r.world !== "string" || !r.world))
                throw new Error();
            return conn;
        }
        catch {
            throw new Error("Worldscribe source connection unavailable or invalid; configure its private connection file and routes");
        }
    }
    try {
        connection();
    }
    catch {
        api.logger.warn("worldscribe: source connection unavailable or invalid; source tools remain disabled until configured");
    }
    function bindingFor(ctx) {
        try {
            return sourceBinding(ctx, connection().routes);
        }
        catch {
            return undefined;
        }
    }
    async function call(action, data) {
        const conn = connection();
        const r = await fetch(`http://127.0.0.1:${cfg.backend.port}/${action}`, {
            method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${conn.api_token}` },
            body: JSON.stringify(data), signal: AbortSignal.timeout(cfg.tools.requestTimeoutMs),
        });
        if (!r.ok)
            throw new Error(`Worldscribe source service returned HTTP ${r.status}`);
        return await r.json();
    }
    const definitions = [
        { name: "worldscribe_search_sources", action: "search", description: "Search your authorized Worldscribe memories and migrated MemOS evidence. Keyword/trigram retrieval, not semantic or inferred facts. Quote source IDs; use worldscribe_get_sources for full evidence.",
            parameters: Type.Object({ query: Type.String({ minLength: 1, maxLength: 500 }), k: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })) }) },
        { name: "worldscribe_describe_world", action: "describe", description: "Describe the Worldscribe source-memory partition available to this conversation. Raw evidence is available; narrative/entity compilation has not run.", parameters: Type.Object({}) },
        { name: "worldscribe_get_sources", action: "get", description: "Read full original memory sources by ID within this conversation's authorized Worldscribe partition.",
            parameters: Type.Object({ source_ids: Type.Array(Type.Integer({ minimum: 1 }), { maxItems: 20 }) }) },
        { name: "worldscribe_record_note", action: "record", description: "Persist an explicit durable note in this conversation's authorized Worldscribe memory. Supply a stable external_id for idempotency. Stores original text, not inferred structured events.",
            parameters: Type.Object({ text: Type.String({ minLength: 1, maxLength: 100000 }), external_id: Type.String({ minLength: 1, maxLength: 250 }) }) },
    ];
    for (const def of definitions.filter(d => d.action === "record" ? cfg.tools.enableWrite : cfg.tools.enableRecall)) {
        api.registerTool((toolCtx) => {
            const ctx = toolCtx;
            const binding = bindingFor(ctx);
            if (!binding)
                return null;
            return { name: def.name, label: def.name, description: def.description, parameters: def.parameters,
                async execute(_id, raw) {
                    guard(ctx);
                    const current = bindingFor(ctx);
                    if (!current || JSON.stringify(current) !== JSON.stringify(binding))
                        throw new Error("Worldscribe source authorization changed");
                    // Authority is written last: injected extra fields cannot select another world.
                    const result = await call(def.action, { ...raw, ...binding });
                    guard(ctx);
                    return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
                } };
        }, { name: def.name, ...(def.action === "record" ? { optional: true } : {}) });
    }
    api.on("agent_end", async (event, rawCtx) => {
        const ctx = rawCtx;
        const binding = bindingFor(ctx);
        if (!binding || !event.success)
            return;
        if (!cfg.tools.enableWrite || raw.sourceArchiveCapture === false)
            return;
        const visible = captureTurn(event.messages);
        if (!visible)
            return;
        const eid = crypto.createHash("sha256").update(binding.session_key + ":" + (event.runId ?? "") + ":" + visible).digest("hex");
        try {
            guard(ctx);
            await call("record", { ...binding, text: visible, external_id: `turn:${eid}`, capture: true });
        }
        catch {
            api.logger.warn("worldscribe: source capture failed; original OpenClaw transcript remains intact");
        }
    });
    api.logger.info("worldscribe: local source archive tools registered (host-scoped, no LLM compilation)");
}
