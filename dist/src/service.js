/** Plugin runtime: backend lifecycle (compose or external), MCP client, tool schema cache, diary scheduler. */
import path from "node:path";
import { ComposeStack } from "./backend/compose.js";
import { detectDocker, DockerUnavailable } from "./backend/docker.js";
import { probeHealth, waitForHealth } from "./backend/health.js";
import { WorldscribeClient } from "./client/mcp.js";
import { backendUrl } from "./config.js";
import { DiaryScheduler } from "./diary/scheduler.js";
import { DiaryStateStore } from "./diary/state.js";
import { HintCache } from "./hooks.js";
import { pluginStateDir } from "./paths.js";
export class WorldscribeRuntime {
    cfg;
    logger;
    url;
    stateDir;
    stack;
    diaryState;
    diary;
    hint;
    _client;
    _schemas;
    _error;
    health;
    constructor(cfg, logger) {
        this.cfg = cfg;
        this.logger = logger;
        this.url = backendUrl(cfg);
        this.stateDir = pluginStateDir();
        this.stack = cfg.backend.mode === "compose" ? new ComposeStack(cfg, this.stateDir) : undefined;
        this.diaryState = new DiaryStateStore(path.join(this.stateDir, "diary-state.json"));
        this.diary = new DiaryScheduler(cfg, () => this.client, this.diaryState, logger, async () => {
            const h = await probeHealth(this.url);
            return (h?.jobs?.running ?? 0) > 0 || (h?.jobs?.queued ?? 0) > 0;
        });
        this.hint = new HintCache(cfg, () => this.client);
    }
    get client() {
        return this._client;
    }
    get schemas() {
        return this._schemas;
    }
    get backendError() {
        return this._error;
    }
    /** Bring the backend up (compose mode) and connect. Errors are recorded, not thrown: tools report them per call. */
    async start() {
        try {
            if (this.stack && this.cfg.backend.autoStart) {
                const already = await probeHealth(this.url);
                if (!already?.ok) {
                    await detectDocker();
                    this.logger.info(`worldscribe: starting docker compose stack (${this.cfg.backend.image}:${this.cfg.backend.imageTag})`);
                    await this.stack.up();
                }
            }
            await this.connect();
        }
        catch (e) {
            this._error = e instanceof DockerUnavailable ? e.message : `Worldscribe backend unavailable: ${e.message}`;
            this.logger.warn(`worldscribe: ${this._error}`);
        }
    }
    /** Connect to a running backend, verify capabilities, cache tool schemas, make sure the diary world exists. */
    async connect() {
        this.health = await waitForHealth(this.url, this.cfg.backend.startupTimeoutSec * 1000);
        if (!this.health.world_routing)
            throw new Error(`${this.url} is a single-world server; start it with --world-routing`);
        if (!this.health.writable)
            this.logger.warn("worldscribe: backend is read-only; ingest/diary/record tools will fail");
        const client = new WorldscribeClient(this.url, { requestTimeoutMs: this.cfg.tools.requestTimeoutMs, logger: this.logger });
        const tools = await client.listTools();
        this._schemas = new Map(tools.map((t) => [t.name, t]));
        if (this.health.writable) {
            await client.callTool(undefined, "create_world", {
                world_id: this.cfg.worlds.diary,
                name: "Diary",
                description: "OpenClaw daily conversations",
                unit_label: "天",
                unit_label_en: "day",
                language: this.cfg.worlds.language,
            });
        }
        this._client = client;
        this._error = undefined;
        this.logger.info(`worldscribe: connected to ${this.url} (v${this.health.version ?? "?"}, ${tools.length} tools)`);
        if (this.cfg.diary.enabled && this.health.writable)
            this.diary.start();
    }
    async stop() {
        this.diary.stop();
        await this._client?.close();
        this._client = undefined;
        if (this.stack && this.cfg.backend.stopOnGatewayStop) {
            await this.stack.stop().catch((e) => this.logger.warn(`worldscribe: compose stop failed: ${e.message}`));
        }
    }
}
