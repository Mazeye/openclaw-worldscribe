# Worldscribe prerequisites

This plugin drives a Worldscribe service started with `worldscribe serve-http --writable --world-routing`
(Worldscribe ≥ 0.2 / branch `feat/world-routing`). It relies on:

- world routing: `/w/<world>/mcp` plus the default `/mcp`; `/health` exposing `world_routing`, `writable`, `version`, `jobs`;
- admin tools (writable mode): `list_worlds`, `create_world`, `ingest_document`, `ingest_status`, `cancel_job`, `retry_job`,
  `list_documents`, `delete_source`, `recompile_source`;
- recall tools: `describe_world`, `recall_entity`, `recall_time`, `recall_narrative`, `recall_state`, `recall_mental_state`,
  `semantic_search`, `get_sources`, and `record_event` (writable).

The bundled `docker/docker-compose.yml` pulls `ghcr.io/mazeye/worldscribe:<tag>[-bge]` built from `deploy/docker/Dockerfile`
in the Worldscribe repository.
