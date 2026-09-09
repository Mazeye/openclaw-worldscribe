/** Render a day's turns into the transcript text Worldscribe compiles as one source unit. */
import { formatHHMM, type Turn } from "./transcripts.js";

export type RenderOptions = {
  timeZone?: string;
  includeToolResults: boolean;
  maxToolResultChars: number;
  maxChars: number;
};

const OMITTED = (n: number) => `[… ${n} chars omitted …]`;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + OMITTED(text.length - max);
}

function indent(text: string): string {
  const lines = text.split("\n");
  return lines.length === 1 ? text : lines.map((l, i) => (i === 0 ? l : `    ${l}`)).join("\n");
}

export function renderTurns(turns: Turn[], opts: RenderOptions): string {
  const byAgent = new Map<string, Map<string, Turn[]>>();
  for (const t of turns) {
    if (t.toolResult && !opts.includeToolResults) continue;
    if (t.role !== "user" && t.role !== "assistant" && !t.toolResult) continue;
    const sessions = byAgent.get(t.agentId) ?? new Map<string, Turn[]>();
    byAgent.set(t.agentId, sessions);
    sessions.set(t.sessionId, [...(sessions.get(t.sessionId) ?? []), t]);
  }
  const blocks: string[] = [];
  const multiAgent = byAgent.size > 1;
  for (const [agentId, sessions] of byAgent) {
    if (multiAgent) blocks.push(`# Agent ${agentId}`);
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
export function appendDailyNote(transcript: string, note: string | undefined, date: string): string {
  if (!note?.trim()) return transcript;
  const section = `# Daily notes (memory/${date}.md)\n\n${note.trim()}`;
  return transcript ? `${transcript}\n\n${section}` : section;
}

/** Enforce the per-day size cap: trim the middle of the largest sections first, keep head and tail. */
export function capLength(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const keep = Math.floor(maxChars / 2) - 40;
  return text.slice(0, keep) + `\n\n${OMITTED(text.length - 2 * keep)}\n\n` + text.slice(-keep);
}
