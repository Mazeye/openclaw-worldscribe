import { detectDocker } from "./backend/docker.js";
import { probeHealth } from "./backend/health.js";
import { resolveLlmKey } from "./config.js";
import { buildDayText } from "./diary/compile.js";
import { addDays } from "./diary/schedule.js";
import { formatDate } from "./diary/transcripts.js";
const out = (v) => console.log(typeof v === "string" ? v : JSON.stringify(v, null, 2));
export function registerCli(api, rt) {
    api.registerCli(({ program }) => {
        const root = program.command("worldscribe").description("Worldscribe structured memory: backend, worlds, ingestion, diary");
        root
            .command("up")
            .description("start the bundled docker compose stack and connect")
            .action(async () => {
            if (!rt.stack)
                return out(`backend.mode=external (${rt.url}); nothing to start`);
            await detectDocker();
            await rt.stack.up();
            await rt.connect();
            out(await probeHealth(rt.url));
        });
        root
            .command("down")
            .description("stop the stack (keeps data); --purge also deletes the database volumes")
            .option("--purge", "delete volumes (irreversible)")
            .option("--yes", "confirm --purge")
            .action(async (o) => {
            if (!rt.stack)
                return out("backend.mode=external; nothing to stop");
            if (o.purge && !o.yes)
                return out("refusing to delete volumes without --yes");
            await rt.stop();
            const r = await rt.stack.down(Boolean(o.purge));
            out(r.code === 0 ? "stopped" : r.stderr);
        });
        root
            .command("status")
            .description("backend health, worlds, active jobs")
            .action(async () => {
            const h = await probeHealth(rt.url);
            const worlds = rt.client ? await rt.client.callTool(undefined, "list_worlds", {}).catch((e) => ({ error: String(e) })) : undefined;
            out({ url: rt.url, health: h ?? "unreachable", error: rt.backendError, worlds, diary: rt.diaryState.all() });
        });
        root
            .command("logs")
            .description("recent container logs")
            .option("--tail <n>", "lines", "100")
            .action(async (o) => {
            if (!rt.stack)
                return out("backend.mode=external; no local containers");
            const r = await rt.stack.logs(Number(o.tail));
            out(r.stdout || r.stderr);
        });
        root
            .command("doctor")
            .description("check docker, backend, LLM key, embedder, worlds")
            .action(async () => {
            const report = { url: rt.url, mode: rt.cfg.backend.mode };
            if (rt.stack) {
                try {
                    report.docker = await detectDocker();
                }
                catch (e) {
                    report.docker = `FAIL: ${e.message}`;
                }
            }
            const h = await probeHealth(rt.url);
            report.health = h ?? "FAIL: unreachable";
            report.llmKey = resolveLlmKey(rt.cfg) ? "set" : "MISSING (llm.apiKey or llm.apiKeyEnv)";
            if (h && rt.cfg.embedder.kind !== h.embedder)
                report.embedder = `WARN: plugin says ${rt.cfg.embedder.kind}, backend runs ${h.embedder}`;
            if (h && h.llm_configured === false)
                report.llm = "WARN: backend has no LLM key; compile jobs will fail";
            if (rt.client)
                report.worlds = await rt.client.callTool(undefined, "list_worlds", {}).catch((e) => `FAIL: ${String(e)}`);
            const days = Object.entries(rt.diaryState.all()).sort().slice(-3);
            report.diary = { enabled: rt.cfg.diary.enabled, recent: Object.fromEntries(days) };
            out(report);
        });
        root
            .command("worlds")
            .description("list memory worlds")
            .action(async () => {
            if (!rt.client)
                return out(rt.backendError ?? "backend not connected");
            out(await rt.client.callTool(undefined, "list_worlds", {}));
        });
        root
            .command("ingest <source>")
            .description("ingest a URL or local file into a world (background job)")
            .requiredOption("--world <id>", "target world id")
            .option("--title <title>")
            .option("--parser <name>", "auto | chapters | markdown | plain | jsonl", "auto")
            .option("--yes", "skip the cost confirmation")
            .action(async (source, o) => {
            if (!rt.client)
                return out(rt.backendError ?? "backend not connected");
            const args = { world: o.world, title: o.title, parser: o.parser, dry_run: !o.yes };
            if (/^https?:\/\//.test(source))
                args.url = source;
            else {
                const fs = await import("node:fs");
                args.text = fs.readFileSync(source, "utf8");
                args.title = o.title ?? source.split("/").pop();
            }
            const res = await rt.client.callTool(undefined, "ingest_document", args, { timeoutMs: 300000 });
            out(o.yes ? res : { ...res, hint: "re-run with --yes to start the job" });
        });
        root
            .command("jobs [job_id]")
            .description("job status")
            .option("--world <id>")
            .action(async (jobId, o) => {
            if (!rt.client)
                return out(rt.backendError ?? "backend not connected");
            out(await rt.client.callTool(undefined, "ingest_status", jobId ? { job_id: jobId } : { world: o.world ?? rt.cfg.worlds.diary }));
        });
        const diary = root.command("diary").description("daily conversation compile");
        diary
            .command("run")
            .description("compile one day now (default: yesterday)")
            .option("--date <YYYY-MM-DD>")
            .option("--force", "recompile a day that is already done")
            .option("--dry-run", "print the rendered text and size instead of compiling")
            .action(async (o) => {
            const date = o.date ?? addDays(formatDate(new Date(), rt.cfg.diary.timezone), -1);
            if (o.dryRun) {
                const day = await buildDayText(rt.cfg, date);
                out({ date, chars: day.chars, turns: day.turns, agents: day.agents });
                out(day.text);
                return;
            }
            out(await rt.diary.runDay(date, { force: o.force }));
        });
        diary
            .command("status")
            .description("compiled days and failures")
            .action(() => out(rt.diaryState.all()));
        root
            .command("forget")
            .description("delete a source unit and repair derived facts")
            .requiredOption("--world <id>")
            .option("--external-id <id>")
            .option("--doc <doc_id>")
            .option("--chapter <n>")
            .option("--dry-run")
            .action(async (o) => {
            if (!rt.client)
                return out(rt.backendError ?? "backend not connected");
            out(await rt.client.callTool(undefined, "delete_source", {
                world: o.world,
                external_id: o.externalId,
                doc_id: o.doc,
                chapter: o.chapter ? Number(o.chapter) : undefined,
                dry_run: Boolean(o.dryRun),
                reason: "cli",
            }));
        });
    }, {
        commands: ["worldscribe"],
        descriptors: [{ name: "worldscribe", description: "Worldscribe structured memory: backend, worlds, ingestion, diary", hasSubcommands: true }],
    });
}
