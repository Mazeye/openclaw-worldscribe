/** Render the compose env file and drive `docker compose` for the bundled Worldscribe stack. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { imageRef, resolveLlmKey } from "../config.js";
import { run } from "./docker.js";
export const PROJECT = "openclaw-worldscribe";
const here = path.dirname(fileURLToPath(import.meta.url));
/** docker/ directory shipped with the plugin (works from src/ in dev and dist/ when built). */
export function bundledDockerDir() {
    let dir = here;
    for (let i = 0; i < 5; i++) {
        const candidate = path.join(dir, "docker");
        if (fs.existsSync(path.join(candidate, "docker-compose.yml")))
            return candidate;
        dir = path.dirname(dir);
    }
    throw new Error("worldscribe: bundled docker/docker-compose.yml not found");
}
/** Environment consumed by docker/docker-compose.yml. Secrets stay in this object / the 0600 .env file only. */
export function renderEnv(cfg, env = process.env) {
    const out = {
        WS_IMAGE: imageRef(cfg),
        WS_PORT: String(cfg.backend.port),
        WS_LLM_BASE_URL: cfg.llm.baseUrl,
        WS_LLM_API_KEY: resolveLlmKey(cfg, env) ?? "",
        WS_LLM_MODEL: cfg.llm.model,
        WS_LLM_CONCURRENCY: String(cfg.llm.concurrency),
        WS_EMBEDDER: cfg.embedder.kind,
        WS_EMBED_URL: cfg.embedder.url ?? "",
        WS_EMBED_SECRET: cfg.embedder.secret ?? "",
        WS_EMBED_WARMUP: cfg.embedder.kind === "bge-m3" ? "1" : "0",
        WS_WORLD: cfg.worlds.diary,
        WS_JOB_WORKERS: "1",
    };
    if (cfg.backend.buildFrom)
        out.WORLDSCRIBE_SRC = path.resolve(cfg.backend.buildFrom);
    return out;
}
export function envFileText(env) {
    return Object.entries(env)
        .map(([k, v]) => `${k}=${v.replace(/\n/g, " ")}`)
        .join("\n") + "\n";
}
export class ComposeStack {
    cfg;
    dir;
    runner;
    constructor(cfg, dir, runner = run) {
        this.cfg = cfg;
        this.dir = dir;
        this.runner = runner;
    }
    /** Copy the compose files next to a freshly rendered .env in the plugin state dir. */
    prepare(env = process.env) {
        fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
        const src = bundledDockerDir();
        const files = ["docker-compose.yml"];
        if (this.cfg.backend.buildFrom)
            files.push("docker-compose.build.yml");
        for (const f of files)
            fs.copyFileSync(path.join(src, f), path.join(this.dir, f));
        const envFile = path.join(this.dir, ".env");
        fs.writeFileSync(envFile, envFileText(renderEnv(this.cfg, env)), { mode: 0o600 });
        return { envFile, composeFiles: files.map((f) => path.join(this.dir, f)) };
    }
    baseArgs() {
        const { envFile, composeFiles } = this.prepare();
        const args = ["compose", "-p", PROJECT, "--env-file", envFile];
        for (const f of composeFiles)
            args.push("-f", f);
        return args;
    }
    compose(args, timeoutMs = 600000) {
        return this.runner("docker", [...this.baseArgs(), ...args], { cwd: this.dir, timeoutMs });
    }
    async up() {
        const args = ["up", "-d", "--wait", "--wait-timeout", String(this.cfg.backend.startupTimeoutSec)];
        if (this.cfg.backend.buildFrom)
            args.push("--build");
        else if (this.cfg.backend.pullPolicy !== "never")
            args.push("--pull", this.cfg.backend.pullPolicy);
        const r = await this.compose(args, (this.cfg.backend.startupTimeoutSec + 600) * 1000);
        if (r.code !== 0)
            throw new Error(`docker compose up failed:\n${(r.stderr || r.stdout).trim().split("\n").slice(-15).join("\n")}`);
        return r;
    }
    stop() {
        return this.compose(["stop"]);
    }
    down(purge = false) {
        return this.compose(purge ? ["down", "-v"] : ["down"]);
    }
    ps() {
        return this.compose(["ps", "--format", "json"], 60000);
    }
    logs(tail = 100) {
        return this.compose(["logs", "--no-color", "--tail", String(tail)], 60000);
    }
}
