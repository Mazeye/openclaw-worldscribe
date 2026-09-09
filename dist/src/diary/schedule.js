import { formatDate } from "./transcripts.js";
export function addDays(date, n) {
    const [y, m, d] = date.split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + n));
    return t.toISOString().slice(0, 10);
}
export function daysBetween(from, to) {
    const a = Date.UTC(...from.split("-").map(Number).map((v, i) => (i === 1 ? v - 1 : v)));
    const b = Date.UTC(...to.split("-").map(Number).map((v, i) => (i === 1 ? v - 1 : v)));
    return Math.round((b - a) / 86400000);
}
/** Timeline position of a day: 1-based days since the configured epoch (deterministic across catch-up runs). */
export function ordinalFor(date, epoch) {
    return daysBetween(epoch, date) + 1;
}
/** "HH:MM" today in the zone has passed? */
export function pastLocalTime(now, hhmm, timeZone) {
    const cur = new Intl.DateTimeFormat("en-GB", { timeZone, hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).format(now);
    return cur >= hhmm;
}
/** The next day that should be compiled now, or undefined. Oldest missing day first; only completed days. */
export function nextDueDay(o) {
    if (o.jobsRunning)
        return undefined;
    if (o.lastActivityAt && o.now.getTime() - o.lastActivityAt.getTime() < o.idleMinutes * 60000)
        return undefined;
    const today = formatDate(o.now, o.timeZone);
    const yesterday = addDays(today, -1);
    const last = o.state.lastCompleted();
    const floor = addDays(today, -Math.max(1, o.catchUpMaxDays));
    let start = last ? addDays(last, 1) : floor;
    if (start < floor)
        start = floor;
    for (let d = start; d <= yesterday; d = addDays(d, 1)) {
        const rec = o.state.get(d);
        if (rec?.status === "done" || rec?.status === "empty")
            continue;
        if (rec?.status === "failed" && rec.nextRetryAt && new Date(rec.nextRetryAt) > o.now)
            continue;
        // yesterday only after the configured time; older days are always due (catch-up)
        if (d === yesterday && !o.time.startsWith("00:00") && !pastLocalTime(o.now, o.time, o.timeZone))
            return undefined;
        return d;
    }
    return undefined;
}
/** Retry backoff after a failed day: 1 h, 6 h, then daily. */
export function nextRetry(now, attempts) {
    const hours = attempts <= 1 ? 1 : attempts === 2 ? 6 : 24;
    return new Date(now.getTime() + hours * 3600000).toISOString();
}
