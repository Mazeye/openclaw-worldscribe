/** Generate openclaw.plugin.json from the TypeBox config schema + tool catalog (run: pnpm run manifest). */
import fs from "node:fs";
import { ConfigSchema } from "../src/config.ts";
import { TOOLS } from "../src/tools/catalog.ts";

// every key has a default applied by resolveConfig(), so nothing is required at any nesting level
function stripRequired(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripRequired);
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) if (k !== "required") out[k] = stripRequired(v);
    return out;
  }
  return node;
}
const configSchema = stripRequired(JSON.parse(JSON.stringify(ConfigSchema)));
const manifest = {
  id: "worldscribe",
  kind: "memory",
  name: "Worldscribe",
  description: "Structured long-document memory (timeline, entities, states, storylines, mental states) over books, documents and daily conversations.",
  version: JSON.parse(fs.readFileSync("package.json", "utf8")).version,
  skills: ["skills"],
  cliCommands: [{ name: "worldscribe", description: "Worldscribe structured memory: backend, worlds, ingestion, diary", hasSubcommands: true }],
  activation: { onStartup: true, onCommands: ["worldscribe"] },
  contracts: { tools: [...TOOLS.map((t) => t.name), "worldscribe_search_sources"] },
  toolMetadata: Object.fromEntries(
    TOOLS.filter((t) => t.optional || t.kind !== "recall").map((t) => [
      t.name,
      { ...(t.optional ? { optional: true } : {}), ...(t.kind !== "recall" ? { sideEffecting: true } : {}) },
    ]),
  ),
  uiHints: {
    "llm.apiKey": { label: "LLM API key", sensitive: true, placeholder: "sk-...", help: "OpenAI-compatible key used by Worldscribe to compile text (DeepSeek by default)" },
    "llm.apiKeyEnv": { label: "LLM API key env var", advanced: true },
    "embedder.secret": { label: "Embedder secret", sensitive: true, advanced: true },
    "backend.mode": { label: "Backend mode", help: "compose = start pgvector + Worldscribe with docker compose; external = connect to backend.url" },
    "diary.time": { label: "Diary compile time", help: "Local time after which yesterday's conversations are compiled (when idle)" },
  },
  configSchema,
};
fs.writeFileSync("openclaw.plugin.json", JSON.stringify(manifest, null, 2) + "\n");
console.log(`openclaw.plugin.json written (${TOOLS.length} tools)`);
