/** Read OpenClaw session transcripts (`~/.openclaw/agents/<agentId>/sessions/*.jsonl`) for one calendar day. */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

export type Role = "user" | "assistant" | "toolResult" | "system" | string;

export type Turn = {
  agentId: string;
  sessionId: string;
  ts: Date;
  role: Role;
  text: string; // visible text (thinking / tool-call blocks dropped)
  toolResult?: boolean;
};

export type DayWindow = { start: Date; end: Date; date: string; timeZone?: string };

/** [start, end) of calendar day `date` (YYYY-MM-DD) in `timeZone` (default: host zone). */
export function dayWindow(date: string, timeZone?: string): DayWindow {
  const [y, m, d] = date.split("-").map(Number);
  const start = zonedDate(y, m, d, timeZone);
  const end = zonedDate(y, m, d + 1, timeZone);
  return { start, end, date, timeZone };
}

/** Local midnight of y-m-d in `timeZone` as an absolute instant. */
export function zonedDate(y: number, m: number, d: number, timeZone?: string): Date {
  const guess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  if (!timeZone) {
    return new Date(y, m - 1, d, 0, 0, 0);
  }
  // offset of the zone at the guessed instant; two passes handle DST edges well enough for a daily job
  let t = guess.getTime() - zoneOffsetMs(guess, timeZone);
  t = guess.getTime() - zoneOffsetMs(new Date(t), timeZone);
  return new Date(t);
}

export function zoneOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

export function formatHHMM(ts: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).format(ts);
}

export function formatDate(ts: Date, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(ts);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

type RawLine = {
  type?: string;
  timestamp?: string | number;
  message?: { role?: string; content?: unknown; timestamp?: string | number };
};

function visibleText(content: unknown): { text: string; toolResult: boolean } {
  if (typeof content === "string") return { text: content, toolResult: false };
  if (!Array.isArray(content)) return { text: "", toolResult: false };
  const parts: string[] = [];
  let toolResult = false;
  for (const block of content as Array<Record<string, unknown>>) {
    const t = block?.type;
    if (t === "text" && typeof block.text === "string") parts.push(block.text);
    else if (t === "tool_result" || t === "toolResult") {
      toolResult = true;
      const inner = block.content ?? block.text;
      parts.push(typeof inner === "string" ? inner : visibleText(inner).text);
    }
    // thinking / tool_use / tool_call / image blocks are dropped
  }
  return { text: parts.join("\n").trim(), toolResult };
}

export async function readSessionFile(file: string, agentId: string, window: DayWindow): Promise<Turn[]> {
  const sessionId = path.basename(file, ".jsonl");
  const out: Turn[] = [];
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let obj: RawLine;
    try {
      obj = JSON.parse(line) as RawLine;
    } catch {
      continue;
    }
    if (obj.type && obj.type !== "message") continue;
    const rawTs = obj.timestamp ?? obj.message?.timestamp;
    if (rawTs === undefined) continue;
    const ts = new Date(rawTs);
    if (Number.isNaN(ts.getTime()) || ts < window.start || ts >= window.end) continue;
    const role = obj.message?.role;
    if (!role) continue;
    const { text, toolResult } = visibleText(obj.message?.content);
    if (!text) continue;
    out.push({ agentId, sessionId, ts, role, text, toolResult: toolResult || role === "toolResult" });
  }
  return out;
}

/** All turns of `agentId` within the day window, oldest first. Files not modified since the window start are skipped. */
export async function readAgentDay(sessionsDir: string, agentId: string, window: DayWindow): Promise<Turn[]> {
  if (!fs.existsSync(sessionsDir)) return [];
  const turns: Turn[] = [];
  for (const name of fs.readdirSync(sessionsDir)) {
    if (!name.endsWith(".jsonl")) continue;
    const file = path.join(sessionsDir, name);
    if (fs.statSync(file).mtimeMs < window.start.getTime()) continue;
    turns.push(...(await readSessionFile(file, agentId, window)));
  }
  turns.sort((a, b) => a.ts.getTime() - b.ts.getTime() || a.sessionId.localeCompare(b.sessionId));
  return turns;
}
