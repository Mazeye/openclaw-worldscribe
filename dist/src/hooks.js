export function formatHint(worlds, cfg) {
    const usable = worlds.filter((w) => (w.units_done ?? 0) > 0);
    if (usable.length === 0)
        return undefined;
    const parts = usable.map((w) => {
        const unit = w.unit_label ?? "unit";
        const range = w.units_done ? `${w.units_done} ${unit}${w.last_unit ? `, latest #${w.last_unit}` : ""}` : "";
        const when = w.id === cfg.worlds.diary && w.last_observed_at ? `, through ${w.last_observed_at.slice(0, 10)}` : "";
        return `${w.id} (${range}${when})`;
    });
    return `Worldscribe structured memory is available — worlds: ${parts.join("; ")}. Use worldscribe_* tools for past decisions, how things evolved, states as of a time, feelings (inferences), and questions about ingested books.`;
}
export class HintCache {
    cfg;
    client;
    ttlMs;
    hint;
    fetchedAt = 0;
    constructor(cfg, client, ttlMs = 600000) {
        this.cfg = cfg;
        this.client = client;
        this.ttlMs = ttlMs;
    }
    async current() {
        if (Date.now() - this.fetchedAt < this.ttlMs)
            return this.hint;
        this.fetchedAt = Date.now();
        const client = this.client();
        if (!client)
            return this.hint;
        try {
            const res = await client.callTool(undefined, "list_worlds", {});
            this.hint = formatHint(res.worlds ?? [], this.cfg);
        }
        catch {
            /* keep the previous hint */
        }
        return this.hint;
    }
}
export function registerHooks(api, opts) {
    api.on("message_received", () => opts.onActivity(new Date()));
    api.on("before_agent_run", () => {
        opts.onActivity(new Date());
        return undefined;
    });
    api.on("agent_end", () => opts.onActivity(new Date()));
    if (opts.cfg.recall.promptHint === "hint" && opts.hint) {
        const hint = opts.hint;
        api.on("before_prompt_build", async () => {
            const text = await hint.current();
            return text ? { prependSystemContext: text } : undefined;
        });
    }
}
