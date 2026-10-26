# Source archive runtime review — 2026-10-26

## Evidence and limits

The plugin was first connected to the reviewed Gateway on this date. There is
not yet evidence of multiple days of production stability. The earlier source
checkout and design work should not be mistaken for continuous live operation.

Reviewed the Gateway logs for October 25–26, the source service's user journal,
the existing migration verification notes, and the uncommitted adapter code.
Only findings and synthetic fixtures are committed; no logs, source memories,
connection files, user IDs, or tokens are included.

Gateway diagnostics showed tool binding failing while the host omitted
`memoryAudience`, then succeeding after the exact-session compatibility path was
added. No source-service crash was observed in its journal. The service does not
log individual requests, so this is not proof that all reads/writes succeeded.

## Findings addressed

- Source adapter registration synchronously read a fixed operator home path.
  Missing or malformed JSON could abort registration. Resolve the state/profile
  path or a configured override, load credentials lazily, and fail closed without
  crashing registration. Re-read credentials for rotation.
- Contact identities and world mappings were embedded in source. Move them to
  operator-controlled private connection routes. Reject missing, unknown and
  ambiguous routes. Preserve exact-session fallback on older hosts; a local route
  never grants more authority than the host audience.
- The archive bypassed `tools.enableRecall`, `tools.enableWrite` and configured
  request timeouts. Apply them to read tools, explicit writes and automatic
  capture. Add an independent automatic-capture opt-out.
- Capture concatenated every assistant text after the last user message, including
  progress messages and text accompanying tool calls. Capture only the last
  visible response, discard explicit nonfinal channels and tool-call messages,
  and skip malformed/incomplete/oversized turns. For older hosts without channel
  metadata the last text response is a compatibility heuristic, not delivery
  confirmation.
- Documentation said the plugin did not take a memory slot, despite its new
  memory-kind manifest. Document explicit slot selection, separate source API
  deployment requirements, and remaining retrieval limits.

## Validation

- TypeScript typecheck passed.
- Manifest regeneration and distribution build passed.
- 36 tests passed across 8 test files, including 10 source-archive cases covering
  audience narrowing, isolation, malformed connection recovery, route revocation,
  credential rotation, forged tool scope, stale invocation rejection, write/read
  switches, deterministic capture IDs, and final-only capture.
- A direct read-only invocation of the built adapter against the running local
  source API successfully called `describe` and keyword `search` in the exact
  current conversation scope. No memory writes were performed by that smoke test.
- The active Gateway was not restarted or hot-reloaded for this review. This
  validates the built adapter/backend interaction, not a new end-to-end Gateway
  registration. Existing live behavior remains unchanged until reload.

## Still out of scope

The adapter does not bundle or provision the separate source API, database, or
migration. It does not provide semantic embeddings or structured narrative/entity
compilation. The older-host fallback still disallows cross-conversation recall.
The original transcripts remain recovery evidence when capture fails or is skipped.
