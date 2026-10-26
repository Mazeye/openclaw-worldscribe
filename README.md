# openclaw-worldscribe

OpenClaw plugin that gives your agent **structured long-document memory** powered by
[Worldscribe](https://github.com/Mazeye/worldscribe): events on a timeline, entities, states as of a point in time,
storylines, and mental states — each backed by verbatim source quotes. Two flows:

- **Diary** — once a day, when the gateway is idle, yesterday's conversations (session transcripts + the agent's daily
  notes) are compiled into the `diary` world. Later: *"when did we decide X?"*, *"what's the state of project Y?"*,
  *"how did I feel about Z last week?"*.
- **Read a book / document** — the agent (or you, via CLI) points at a URL or local file; it is compiled into its own
  world in the background, then you can discuss it with recall tools (列传 / 编年 / 纪事本末 / 状态 / 主观状态).

The plugin is declared as `kind: memory`. Select it with `plugins.slots.memory: "worldscribe"`
when replacing another memory plugin; do not assume it will run alongside an already selected memory slot.

## Install

Requirements: Docker Desktop (or docker-ce with compose v2), an OpenAI-compatible LLM key (DeepSeek by default).

```bash
openclaw plugins install git:github.com/Mazeye/openclaw-worldscribe
```

`~/.openclaw/openclaw.json`:

```json5
{
  plugins: {
    entries: {
      worldscribe: {
        enabled: true,
        config: {
          llm: { apiKeyEnv: "DEEPSEEK_API_KEY" },      // or apiKey: "sk-..."
          diary: { time: "03:30", timezone: "Asia/Shanghai" },
          ingest: { allowLocalPaths: ["~/Downloads", "~/Documents"] }
        }
      }
    }
  }
}
```

On gateway start the plugin runs `docker compose up` for a pgvector Postgres and the Worldscribe service
(`ghcr.io/mazeye/worldscribe:<tag>-bge`, bge-m3 embeddings on CPU), waits for `/health`, and creates the `diary` world.

```bash
openclaw worldscribe doctor          # docker, backend, LLM key, embedder, worlds, recent diary runs
openclaw worldscribe ingest ~/Downloads/xiyouji.txt --world xiyouji --title 西游记 --yes
openclaw worldscribe jobs --world xiyouji
openclaw worldscribe diary run --date 2026-09-08 --dry-run
```

## Tools

| tool | what it answers |
|---|---|
| `worldscribe_describe_world` | overview of a world (call first) |
| `worldscribe_recall_entity` | what a person / org / project did or underwent (列传) |
| `worldscribe_recall_time` | what happened between two days / chapters (编年) |
| `worldscribe_recall_narrative` | how a storyline unfolded (纪事本末) |
| `worldscribe_recall_state` | who owns / works for / is where, as of a point in time, with history |
| `worldscribe_recall_mental_state` | emotions, attitudes, beliefs, intentions — always inferences |
| `worldscribe_semantic_search` | fuzzy recall + source passages |
| `worldscribe_get_sources` | verbatim quotes behind events |
| `worldscribe_list_worlds`, `worldscribe_ingest_status` | worlds and background jobs |
| `worldscribe_ingest_document` (optional) | compile a URL / file / text into a world; confirms cost first |
| `worldscribe_record_note` (optional) | store one note / email as a source unit |
| `worldscribe_forget` (opt-in) | delete a source unit and the facts only it supported |

Parameter schemas are mirrored from the running Worldscribe at startup, so they never drift from the backend.

## Configuration

### Local source archive mode (MemOS migration)

`sourceArchive: true` selects the local source service in the sibling Worldscribe
checkout (`scripts/source_memory.py`) instead of the LLM compiler/diary stack.
It preserves raw text and metadata in Worldscribe's canonical PostgreSQL `sources`
table. Its tools are `worldscribe_search_sources` (keyword/pg_trgm retrieval),
`worldscribe_get_sources`, `worldscribe_record_note`, and `worldscribe_describe_world`.
It does **not** synthesize events, entities, states, or narratives, run a paid LLM,
or claim semantic embeddings. Historical duplicates remain archived but excluded
from recall. Unassigned source sessions remain quarantined.

The host-supplied `memoryAudience` is honored when present. Operator-configured
private routes narrow that audience to isolated worlds; conversation audiences
add an exact source-session filter. OpenClaw 2026.10.4's Codex projection omits the
audience: that compatibility path requires the host session incarnation and allows
only an exact source-session match, never owner-private or cross-conversation access.
No tool argument can widen the bound scope. Shared, cron, unknown, and unbound
sessions have no source tools.
Successful private turns are archived by `agent_end`; original transcripts remain
the fallback if capture fails. The local service never blocks plugin registration
or prompt preparation.

#### Source archive setup and limits

This is an **opt-in adapter to a separately deployed local source API**, not a
self-contained source server. Installing this plugin does not install or start
`scripts/source_memory.py`, create database tables, migrate another memory store,
or provision authentication. The ordinary Worldscribe MCP backend is not this
API. Deploy a compatible service first; keep its token and route configuration
private and ensure it enforces the same world/session boundaries server-side.
The plugin only sends POSTs to loopback `/search`, `/get`, `/record`, `/describe`;
`backend.port` selects the port (default 8765). `backend.mode`/`backend.url` do
not redirect this local adapter. `tools.requestTimeoutMs` controls its timeout.

Connection JSON defaults to `<OpenClaw state>/worldscribe-source/connection.json`
(respects `OPENCLAW_STATE_DIR` / `OPENCLAW_PROFILE`). Override with
`sourceArchiveConnectionFile`; use a private file, mode 0600, outside the repo:

```json
{
  "api_token": "YOUR_LOCAL_SERVICE_TOKEN",
  "routes": [
    {
      "sessionKey": "agent:main:slack:default:direct:YOUR_USER_ID",
      "world": "private-operator",
      "allowThreads": true,
      "ownerPrivate": false
    }
  ]
}
```

Use host-confirmed private session keys, never user-provided tool arguments.
Routes match exactly, case-insensitively. `allowThreads` additionally accepts only
`:thread:<numeric timestamp>` suffixes. Ambiguous or missing routes fail closed.
`ownerPrivate: true` may *narrow* an explicit host owner-private audience; it never
creates one. Connection files are read lazily, so missing/invalid files do not
crash plugin registration; restore the file and resolve tools again to recover.
Credentials are refreshed on each request. Revoked routes block existing tool
instances on their next invocation.

`tools.enableRecall: false` disables source read tools. `tools.enableWrite: false`
disables both explicit notes and automatic capture. `sourceArchiveCapture: false`
disables only automatic capture. Failed/incomplete turns and over-100,000-character
turns are not captured. Capture stores the last user message and last visible
assistant response only, dropping tool calls/results, thinking and intermediate
responses. Older hosts without channel metadata can only identify the last text
response, not prove it was delivered. Original transcripts remain the fallback.

See `openclaw.plugin.json#configSchema` (generated from `src/config.ts`). Highlights:

- `backend.mode`: `compose` (default, bundled stack on `127.0.0.1:8765`) or `external` (`backend.url` of a Worldscribe started with `serve-http --writable --world-routing`).
- `embedder.kind`: `bge-m3` (in-container CPU, image tag `-bge`) or `remote`.
- `diary`: `time`, `timezone`, `idleMinutes`, `include` (`transcripts` / `dailyNotes`), `agentIds`, `maxChars`, `catchUpMaxDays`, `ordinalEpoch`.
- `ingest`: `maxChars`, `confirmAboveChars`, `allowLocalPaths`.
- `tools`: `enableRecall` / `enableIngest` / `enableWrite` / `enableForget`.
- `recall.promptHint`: `off` (default) or `hint` (one cached line in the system prompt listing available worlds; no per-turn backend calls).

## Privacy

Diary compilation sends the day's transcript text to your configured LLM provider. Set `diary.include` to
`["dailyNotes"]` to compile only the agent's own notes, or disable the diary. `worldscribe_forget` removes a day with
provenance-safe repair; tombstones never keep content.

## Development

```bash
pnpm install
pnpm run check            # typecheck + regenerate openclaw.plugin.json + vitest
openclaw plugins install ./ && openclaw plugins inspect worldscribe --runtime --json
```

Backend requirements are listed in `docs/worldscribe-prereqs.md`.
