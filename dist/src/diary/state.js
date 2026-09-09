/** Persistent diary bookkeeping: which days are compiled, failures + attempts (JSON file in the plugin state dir). */
import fs from "node:fs";
import path from "node:path";
export class DiaryStateStore {
    file;
    state;
    constructor(file) {
        this.file = file;
        this.state = { version: 1, days: {} };
        try {
            const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
            if (parsed?.version === 1 && parsed.days)
                this.state = parsed;
        }
        catch {
            /* fresh state */
        }
    }
    get(date) {
        return this.state.days[date];
    }
    set(date, rec) {
        this.state.days[date] = rec;
        fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
        fs.writeFileSync(this.file, JSON.stringify(this.state, null, 1), { mode: 0o600 });
    }
    lastCompleted() {
        return Object.entries(this.state.days)
            .filter(([, r]) => r.status !== "failed")
            .map(([d]) => d)
            .sort()
            .at(-1);
    }
    all() {
        return { ...this.state.days };
    }
}
