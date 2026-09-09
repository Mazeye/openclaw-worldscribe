/** Persistent diary bookkeeping: which days are compiled, failures + attempts (JSON file in the plugin state dir). */
import fs from "node:fs";
import path from "node:path";

export type DayRecord = {
  status: "done" | "empty" | "failed";
  at: string; // ISO
  attempts: number;
  jobId?: string;
  eventIds?: number[];
  chars?: number;
  error?: string;
  nextRetryAt?: string;
};

export type DiaryState = { version: 1; days: Record<string, DayRecord> };

export class DiaryStateStore {
  private state: DiaryState;
  constructor(private readonly file: string) {
    this.state = { version: 1, days: {} };
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as DiaryState;
      if (parsed?.version === 1 && parsed.days) this.state = parsed;
    } catch {
      /* fresh state */
    }
  }

  get(date: string): DayRecord | undefined {
    return this.state.days[date];
  }

  set(date: string, rec: DayRecord): void {
    this.state.days[date] = rec;
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(this.file, JSON.stringify(this.state, null, 1), { mode: 0o600 });
  }

  lastCompleted(): string | undefined {
    return Object.entries(this.state.days)
      .filter(([, r]) => r.status !== "failed")
      .map(([d]) => d)
      .sort()
      .at(-1);
  }

  all(): Record<string, DayRecord> {
    return { ...this.state.days };
  }
}
