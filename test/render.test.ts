import path from "node:path";
import { describe, expect, it } from "vitest";
import { appendDailyNote, capLength, renderTurns } from "../src/diary/render.js";
import { dayWindow, readAgentDay } from "../src/diary/transcripts.js";
import { readDailyNote } from "../src/diary/notes.js";

const SESSIONS = path.join(__dirname, "fixtures", "sessions", "main");
const TZ = "Asia/Tokyo"; // 2026-09-08 local = 2026-09-07T15:00Z .. 2026-09-08T15:00Z

describe("diary transcripts", () => {
  it("keeps only the day's user/assistant text, drops thinking and tool calls, honours the time zone", async () => {
    const turns = await readAgentDay(SESSIONS, "main", dayWindow("2026-09-08", TZ));
    expect(turns.map((t) => `${t.role}:${t.text.slice(0, 8)}`)).toEqual([
      "user:我们把数据库定为",
      "assistant:好，Postgr",
      "toolResult:Stored: ",
      "user:纯字符串 con",
      "user:小王今天很沮丧，",
    ]);
    expect(turns.some((t) => t.text.includes("secret reasoning"))).toBe(false);
    const text = renderTurns(turns, { timeZone: TZ, includeToolResults: false, maxToolResultChars: 40, maxChars: 100000 });
    expect(text).toMatchInlineSnapshot(`
      "## Session sess-aaa (09:12–23:59)
      [09:12] user: 我们把数据库定为 PostgreSQL 吧。
      [09:12] assistant: 好，PostgreSQL 定了。
          我记一下。
      [23:59] user: 小王今天很沮丧，Neo4j 方案被否了。

      ## Session sess-bbb (14:00–14:00)
      [14:00] user: 纯字符串 content 也要支持。"
    `);
  });

  it("can include truncated tool results and appends the daily note", async () => {
    const turns = await readAgentDay(SESSIONS, "main", dayWindow("2026-09-08", TZ));
    const text = renderTurns(turns, { timeZone: TZ, includeToolResults: true, maxToolResultChars: 20, maxChars: 100000 });
    expect(text).toContain("[09:12] tool: Stored: xxxxxxxxxxxx[… ");
    const note = readDailyNote(path.join(__dirname, "fixtures", "workspace"), "2026-09-08");
    const full = appendDailyNote(text, note, "2026-09-08");
    expect(full).toContain("# Daily notes (memory/2026-09-08.md)\n\n# 2026-09-08\n\n- 决定：数据库用 PostgreSQL");
    expect(readDailyNote(path.join(__dirname, "fixtures", "workspace"), "2026-09-09")).toBeUndefined();
  });

  it("caps oversized days keeping head and tail", () => {
    const text = "a".repeat(5000) + "MIDDLE" + "b".repeat(5000);
    const capped = capLength(text, 2000);
    expect(capped.length).toBeLessThan(2100);
    expect(capped.startsWith("aaa")).toBe(true);
    expect(capped.endsWith("bbb")).toBe(true);
    expect(capped).toContain("chars omitted");
    expect(capped).not.toContain("MIDDLE");
  });
});
