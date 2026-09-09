# Architecture

```
OpenClaw gateway (Node)
 └─ plugin "worldscribe" (this repo, TypeScript, in-process)
     ├─ tools   worldscribe_* ── MCP Streamable HTTP ──► Worldscribe service (Python, container)
     ├─ hooks   message_received / before_agent_run / agent_end → idle tracking; optional before_prompt_build hint
     ├─ service registerService: docker compose up / wait /health / create diary world / diary scheduler
     └─ cli     openclaw worldscribe up|down|status|logs|doctor|worlds|ingest|jobs|diary run|forget

docker compose project "openclaw-worldscribe"
 ├─ db          pgvector/pgvector:pg17          volume pgdata
 └─ worldscribe ghcr.io/mazeye/worldscribe:*   serve-http --writable --world-routing   volume hf_cache
      /mcp  (default world = diary)   /w/<world>/mcp   /health
```

- **One backend, many worlds.** The plugin opens one MCP client per world (`/w/<world>/mcp`); admin tools
  (`list_worlds`, `ingest_document`, `ingest_status`, `delete_source`…) are called on the default route with a `world` parameter.
- **Schemas are mirrored.** At connect time the plugin fetches the backend tool list and builds each `worldscribe_*`
  parameter schema from it (plus `world`, `path`, `confirm`), so parameter drift is impossible.
- **Long work is a job.** Document compiles and diary days are `ingest_jobs` rows inside the backend; the plugin polls
  `ingest_status`. Jobs survive container restarts (`interrupted` → re-queued).
- **Diary identity.** One unit per day: `doc_id=diary`, `external_id=diary:<YYYY-MM-DD>`, `ordinal = days since
  diary.ordinalEpoch + 1`. Re-running a day replays (no LLM cost); `--force` recompiles from stored segments.
- **State on the host.** `~/.openclaw/worldscribe/{.env,docker-compose.yml,diary-state.json}`; secrets only in the 0600 `.env`.
