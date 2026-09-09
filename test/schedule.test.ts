import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addDays, daysBetween, nextDueDay, nextRetry, ordinalFor } from "../src/diary/schedule.js";
import { DiaryStateStore } from "../src/diary/state.js";

function store(): DiaryStateStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ws-diary-"));
  return new DiaryStateStore(path.join(dir, "state.json"));
}

const TZ = "Asia/Tokyo";
const at = (iso: string) => new Date(iso);

describe("diary scheduling", () => {
  it("date arithmetic and deterministic ordinals", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(daysBetween("2026-01-01", "2026-09-08")).toBe(250);
    expect(ordinalFor("2026-01-01", "2026-01-01")).toBe(1);
    expect(ordinalFor("2026-09-08", "2026-01-01")).toBe(251);
  });

  it("waits for the configured time, then compiles yesterday when idle", () => {
    const s = store();
    const base = { timeZone: TZ, time: "03:30", idleMinutes: 30, catchUpMaxDays: 7, state: s, jobsRunning: false, lastActivityAt: undefined };
    // 02:00 Tokyo on 09-09: too early for 09-08, and older days were never compiled -> catch-up floor applies
    expect(nextDueDay({ ...base, now: at("2026-09-08T17:00:00Z") })).toBe("2026-09-02"); // catch-up floor: today - 7
    for (let d = "2026-09-02"; d <= "2026-09-07"; d = addDays(d, 1)) s.set(d, { status: "done", at: "x", attempts: 1 });
    expect(nextDueDay({ ...base, now: at("2026-09-08T17:00:00Z") })).toBeUndefined(); // only yesterday left, before 03:30
    expect(nextDueDay({ ...base, now: at("2026-09-08T18:31:00Z") })).toBe("2026-09-08"); // 03:31 Tokyo
    expect(nextDueDay({ ...base, now: at("2026-09-08T18:31:00Z"), lastActivityAt: at("2026-09-08T18:20:00Z") })).toBeUndefined(); // busy
    expect(nextDueDay({ ...base, now: at("2026-09-08T18:31:00Z"), jobsRunning: true })).toBeUndefined();
  });

  it("skips done/empty days, retries failed days after backoff, never compiles today", () => {
    const s = store();
    const base = { timeZone: TZ, time: "00:00", idleMinutes: 0, catchUpMaxDays: 3, state: s, jobsRunning: false, lastActivityAt: undefined };
    const now = at("2026-09-09T03:00:00Z"); // 12:00 Tokyo on 09-09
    s.set("2026-09-06", { status: "done", at: "x", attempts: 1 });
    s.set("2026-09-07", { status: "empty", at: "x", attempts: 1 });
    s.set("2026-09-08", { status: "failed", at: "x", attempts: 1, nextRetryAt: "2026-09-09T05:00:00Z" });
    expect(nextDueDay({ ...base, now })).toBeUndefined(); // 09-08 still in backoff
    s.set("2026-09-08", { status: "failed", at: "x", attempts: 1, nextRetryAt: "2026-09-09T02:00:00Z" });
    expect(nextDueDay({ ...base, now })).toBe("2026-09-08");
    expect(s.lastCompleted()).toBe("2026-09-07");
    expect(nextRetry(at("2026-09-09T00:00:00Z"), 1)).toBe("2026-09-09T01:00:00.000Z");
    expect(nextRetry(at("2026-09-09T00:00:00Z"), 2)).toBe("2026-09-09T06:00:00.000Z");
    expect(nextRetry(at("2026-09-09T00:00:00Z"), 5)).toBe("2026-09-10T00:00:00.000Z");
  });
});
