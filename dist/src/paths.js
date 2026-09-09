/** Where OpenClaw keeps things on disk, and where this plugin keeps its own state. */
import os from "node:os";
import path from "node:path";
export function expandHome(p) {
    return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}
export function stateDir(env = process.env) {
    if (env.OPENCLAW_STATE_DIR)
        return expandHome(env.OPENCLAW_STATE_DIR);
    const profile = env.OPENCLAW_PROFILE;
    return path.join(os.homedir(), profile ? `.openclaw-${profile}` : ".openclaw");
}
export function pluginStateDir(env = process.env) {
    return path.join(stateDir(env), "worldscribe");
}
export function workspaceDir(env = process.env) {
    if (env.OPENCLAW_WORKSPACE_DIR)
        return expandHome(env.OPENCLAW_WORKSPACE_DIR);
    return path.join(stateDir(env), "workspace");
}
export function sessionsDir(agentId, env = process.env) {
    return path.join(stateDir(env), "agents", agentId, "sessions");
}
/** True when `candidate` is inside one of `roots` (after ~ expansion and normalisation). */
export function isUnderAllowedRoots(candidate, roots) {
    const abs = path.resolve(expandHome(candidate));
    return roots.some((r) => {
        const root = path.resolve(expandHome(r));
        return abs === root || abs.startsWith(root + path.sep);
    });
}
