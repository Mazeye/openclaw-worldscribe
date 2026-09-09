/** Render a day's turns into the transcript text Worldscribe compiles as one source unit. */
import { formatHHMM } from "./transcripts.js";
const OMITTED = (n) => `[… ${n} chars omitted …]`;
function truncate(text, max) {
    if (text.length <= max)
        return text;
    return text.slice(0, max) + OMITTED(text.length - max);
}
function indent(text) {
    const lines = text.split("\n");
    return lines.length === 1 ? text : lines.map((l, i) => (i === 0 ? l : `    ${l}`)).join("\n");
}
export function renderTurns(turns, opts) {
    const byAgent = new Map();
    for (const t of turns) {
        if (t.toolResult && !opts.includeToolResults)
            continue;
        if (t.role !== "user" && t.role !== "assistant" && !t.toolResult)
            continue;
        const sessions = byAgent.get(t.agentId) ?? new Map();
        byAgent.set(t.agentId, sessions);
        sessions.set(t.sessionId, [...(sessions.get(t.sessionId) ?? []), t]);
    }
    const blocks = [];
    const multiAgent = byAgent.size > 1;
    for (const [agentId, sessions] of byAgent) {
        if (multiAgent)
            blocks.push(`# Agent ${agentId}`);
        for (const [sessionId, ts] of sessions) {
            const first = formatHHMM(ts[0].ts, opts.timeZone);
            const last = formatHHMM(ts[ts.length - 1].ts, opts.timeZone);
            const lines = [`## Session ${sessionId.slice(0, 8)} (${first}–${last})`];
            for (const t of ts) {
                const who = t.toolResult ? "tool" : t.role;
                const body = t.toolResult ? truncate(t.text, opts.maxToolResultChars) : t.text;
                lines.push(`[${formatHHMM(t.ts, opts.timeZone)}] ${who}: ${indent(body)}`);
            }
            blocks.push(lines.join("\n"));
        }
    }
    return blocks.join("\n\n");
}
/** Append the agent's own daily note (memory/YYYY-MM-DD.md) as a trailing section. */
export function appendDailyNote(transcript, note, date) {
    if (!note?.trim())
        return transcript;
    const section = `# Daily notes (memory/${date}.md)\n\n${note.trim()}`;
    return transcript ? `${transcript}\n\n${section}` : section;
}
/** Enforce the per-day size cap: trim the middle of the largest sections first, keep head and tail. */
export function capLength(text, maxChars) {
    if (text.length <= maxChars)
        return text;
    const keep = Math.floor(maxChars / 2) - 40;
    return text.slice(0, keep) + `\n\n${OMITTED(text.length - 2 * keep)}\n\n` + text.slice(-keep);
}
