/** Compile one calendar day of OpenClaw conversations into the diary world (one source unit per day). */
import type { WorldscribeClient } from "../client/mcp.js";
import type { Config } from "../config.js";
import { sessionsDir, workspaceDir } from "../paths.js";
import { readDailyNote } from "./notes.js";
import { appendDailyNote, capLength, renderTurns } from "./render.js";
import { ordinalFor } from "./schedule.js";
import { dayWindow, readAgentDay, type Turn } from "./transcripts.js";

export type DayText = { date: string; text: string; chars: number; turns: number; agents: string[] };

export async function buildDayText(cfg: Config, date: string, env: NodeJS.ProcessEnv = process.env): Promise<DayText> {
  const window = dayWindow(date, cfg.diary.timezone);
  let turns: Turn[] = [];
  if (cfg.diary.include.includes("transcripts")) {
    for (const agentId of cfg.diary.agentIds) {
      turns = turns.concat(await readAgentDay(sessionsDir(agentId, env), agentId, window));
    }
    turns.sort((a, b) => a.ts.getTime() - b.ts.getTime());
  }
  let text = renderTurns(turns, {
    timeZone: cfg.diary.timezone,
    includeToolResults: cfg.diary.includeToolResults,
    maxToolResultChars: cfg.diary.maxToolResultChars,
    maxChars: cfg.diary.maxChars,
  });
  if (cfg.diary.include.includes("dailyNotes")) {
    text = appendDailyNote(text, readDailyNote(workspaceDir(env), date), date);
  }
  text = capLength(text, cfg.diary.maxChars);
  return { date, text, chars: text.length, turns: turns.length, agents: [...new Set(turns.map((t) => t.agentId))] };
}

export type JobRow = { id: string; status: string; error?: string | null; progress?: Record<string, unknown> };

export function externalIdFor(date: string): string {
  return `diary:${date}`;
}

/** Submit the day as a single-unit job and wait for it. Idempotent by external_id (replays return the original events). */
export async function submitDay(client: WorldscribeClient, cfg: Config, day: DayText, opts: { sleep?: (ms: number) => Promise<void>; now?: () => number } = {}): Promise<JobRow> {
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const tz = cfg.diary.timezone;
  const offset = tz ? tzOffsetSuffix(day.date, tz) : localOffsetSuffix(new Date(`${day.date}T12:00:00`));
  const res = await client.callTool<{ job?: JobRow; error?: string }>(undefined, "ingest_document", {
    world: cfg.worlds.diary,
    text: day.text,
    single_unit: true,
    doc_id: "diary",
    title: day.date,
    external_id: externalIdFor(day.date),
    source_kind: "chat_turn",
    observed_at: `${day.date}T23:59:59${offset}`,
    event_time: `${day.date}T12:00:00${offset}`,
    ordinal: ordinalFor(day.date, cfg.diary.ordinalEpoch),
    unit_label: "天",
    language: cfg.worlds.language,
    name: "Diary",
    description: "OpenClaw daily conversations",
  });
  if (res.error || !res.job) throw new Error(res.error ?? "ingest_document returned no job");
  const deadline = now() + cfg.diary.jobTimeoutMin * 60000;
  let job = res.job;
  while (["queued", "running", "interrupted"].includes(job.status)) {
    if (now() > deadline) throw new Error(`diary job ${job.id} still ${job.status} after ${cfg.diary.jobTimeoutMin} min`);
    await sleep(cfg.diary.pollIntervalSec * 1000);
    const st = await client.callTool<{ job?: JobRow; error?: string }>(undefined, "ingest_status", { job_id: job.id });
    if (!st.job) throw new Error(st.error ?? `job ${job.id} vanished`);
    job = st.job;
  }
  return job;
}

function pad(n: number): string {
  return String(Math.abs(n)).padStart(2, "0");
}

function localOffsetSuffix(d: Date): string {
  const min = -d.getTimezoneOffset();
  return `${min >= 0 ? "+" : "-"}${pad(Math.trunc(min / 60))}:${pad(min % 60)}`;
}

function tzOffsetSuffix(date: string, timeZone: string): string {
  const at = new Date(`${date}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" }).formatToParts(at);
  const raw = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = /GMT([+-]\d{1,2})(?::?(\d{2}))?/.exec(raw);
  if (!m) return "+00:00";
  const h = Number(m[1]);
  return `${h >= 0 ? "+" : "-"}${pad(h)}:${m[2] ?? "00"}`;
}
