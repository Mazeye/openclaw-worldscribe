/** Docker detection and a small spawn helper (compose is driven through the docker CLI). */
import { spawn } from "node:child_process";
export function run(cmd, args, opts = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, stdio: ["pipe", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d) => (stdout += d.toString()));
        child.stderr.on("data", (d) => (stderr += d.toString()));
        const timer = opts.timeoutMs ? setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs) : undefined;
        child.on("error", (e) => {
            if (timer)
                clearTimeout(timer);
            reject(e);
        });
        child.on("close", (code) => {
            if (timer)
                clearTimeout(timer);
            resolve({ code: code ?? -1, stdout, stderr });
        });
        if (opts.input !== undefined)
            child.stdin.write(opts.input);
        child.stdin.end();
    });
}
export class DockerUnavailable extends Error {
}
/** Verify `docker` (daemon reachable) and `docker compose` v2. Throws DockerUnavailable with an actionable message. */
export async function detectDocker(runner = run) {
    let v;
    try {
        v = await runner("docker", ["version", "--format", "{{.Server.Version}}"], { timeoutMs: 15000 });
    }
    catch (e) {
        throw new DockerUnavailable(`docker CLI not found (${e.message}). Install Docker Desktop / docker-ce with compose v2, ` +
            `or set plugins.entries.worldscribe.config.backend.mode="external" with backend.url pointing at a running Worldscribe.`);
    }
    if (v.code !== 0 || !v.stdout.trim()) {
        throw new DockerUnavailable(`docker daemon not reachable: ${v.stderr.trim() || v.stdout.trim() || "no output"}. Start Docker, then run \`openclaw worldscribe up\`.`);
    }
    const c = await runner("docker", ["compose", "version", "--short"], { timeoutMs: 15000 });
    if (c.code !== 0) {
        throw new DockerUnavailable(`docker compose v2 is required (${c.stderr.trim() || "plugin not installed"}).`);
    }
    return { version: v.stdout.trim(), composeVersion: c.stdout.trim() };
}
