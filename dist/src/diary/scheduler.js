import { buildDayText, submitDay } from "./compile.js";
import { nextDueDay, nextRetry } from "./schedule.js";
export class DiaryScheduler {
    cfg;
    client;
    state;
    logger;
    jobsRunning;
    tickMs;
    timer;
    busy = false;
    lastActivityAt;
    constructor(cfg, client, state, logger, jobsRunning, tickMs = 60000) {
        this.cfg = cfg;
        this.client = client;
        this.state = state;
        this.logger = logger;
        this.jobsRunning = jobsRunning;
        this.tickMs = tickMs;
    }
    noteActivity(at = new Date()) {
        this.lastActivityAt = at;
    }
    start() {
        if (this.timer)
            return;
        this.timer = setInterval(() => void this.tick(), this.tickMs);
        this.timer.unref?.();
        void this.tick();
    }
    stop() {
        if (this.timer)
            clearInterval(this.timer);
        this.timer = undefined;
    }
    async tick(now = new Date()) {
        if (this.busy || !this.client())
            return undefined;
        const due = nextDueDay({
            now,
            timeZone: this.cfg.diary.timezone,
            time: this.cfg.diary.time,
            idleMinutes: this.cfg.diary.idleMinutes,
            lastActivityAt: this.lastActivityAt,
            catchUpMaxDays: this.cfg.diary.catchUpMaxDays,
            state: this.state,
            jobsRunning: await this.jobsRunning(),
        });
        if (!due)
            return undefined;
        return this.runDay(due);
    }
    /** Compile one day now (scheduler or CLI). */
    async runDay(date, opts = {}) {
        const client = this.client();
        if (!client)
            return { date, status: "failed", chars: 0, error: "backend not running" };
        this.busy = true;
        const prev = this.state.get(date);
        const attempts = (prev?.attempts ?? 0) + 1;
        try {
            const day = await buildDayText(this.cfg, date);
            if (day.chars < this.cfg.diary.minChars && this.cfg.diary.skipEmptyDays) {
                this.state.set(date, { status: "empty", at: new Date().toISOString(), attempts, chars: day.chars });
                this.logger.info(`worldscribe diary: ${date} has only ${day.chars} chars; skipped`);
                return { date, status: "empty", chars: day.chars };
            }
            if (opts.force && prev?.status === "done") {
                await client.callTool(undefined, "recompile_source", { world: this.cfg.worlds.diary, external_id: `diary:${date}` }, { timeoutMs: this.cfg.diary.jobTimeoutMin * 60000 });
            }
            const job = await submitDay(client, this.cfg, day);
            if (job.status !== "done") {
                throw new Error(job.error ?? `job ${job.id} ended with status ${job.status}`);
            }
            const events = Number(job.progress?.events ?? 0);
            const eventIds = job.progress?.event_ids;
            this.state.set(date, { status: "done", at: new Date().toISOString(), attempts, jobId: job.id, eventIds, chars: day.chars });
            this.logger.info(`worldscribe diary: compiled ${date} (${day.chars} chars, ${events} events, job ${job.id})`);
            return { date, status: "done", chars: day.chars, events, jobId: job.id };
        }
        catch (e) {
            const error = e instanceof Error ? e.message : String(e);
            this.state.set(date, { status: "failed", at: new Date().toISOString(), attempts, error, nextRetryAt: nextRetry(new Date(), attempts) });
            this.logger.warn(`worldscribe diary: ${date} failed (attempt ${attempts}): ${error}`);
            return { date, status: "failed", chars: 0, error };
        }
        finally {
            this.busy = false;
        }
    }
}
