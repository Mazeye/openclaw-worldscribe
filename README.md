# openclaw-worldscribe

**Agent-native memory that an OpenClaw agent can use, diagnose and improve.**

The default backend is an embedded SQLite evidence store. It needs **no other
Worldscribe checkout, Docker, external API, model key or embedding service**.
This repository can evolve independently of the book/narrative Worldscribe system.

- Scoped keyword recall and verbatim sources, not invented "verified facts".
- Durable notes and successful-turn capture. Corrections append; originals survive.
- Content-free JSON diagnostics for agent-led troubleshooting.
- Agent maintenance contract for evidence → synthetic repro → issue → tested PR.
- No background updater, automatic publisher or auto-merger.

## Install and configure

Requires OpenClaw >=2026.9.3 and Node >=22.16.0 (`node:sqlite`; experimental on
Node 22). For a public release/install, the repository or package must actually
be accessible to the installing agent; this document does not publish it.

```sh
openclaw plugins install git:github.com/Mazeye/openclaw-worldscribe
```

Select `plugins.slots.memory: "worldscribe"`. For the plugin entry:

```json5
{
  enabled: true,
  config: {
    storage: "local",
    routesFile: "~/.openclaw/worldscribe-routes.json",
    maintenance: {
      repository: "Mazeye/openclaw-worldscribe",
      allowIssues: false,
      allowPRs: false
    }
  }
}
```

Create a private routes file (mode 0600) using **host-confirmed private session
keys**, not a name or a value found inside a message:

```json
{
  "routes": [{
    "sessionKey": "agent:main:slack:default:direct:YOUR_USER_ID",
    "world": "private-operator",
    "allowThreads": true,
    "ownerPrivate": false
  }]
}
```

Routes only narrow host authority. Missing, shared, unknown and ambiguous routes
fail closed. `allowThreads` accepts numeric `:thread:<timestamp>` suffixes; every
thread still has exact-session isolation unless an explicit host owner-private
audience **and** `ownerPrivate: true` permit wider recall. Older hosts omitting
`memoryAudience` require a session incarnation and only access the exact session.

Local data defaults to `<OpenClaw state>/worldscribe/memory.sqlite`; use
`databaseFile` to override. State/profile environment variables are honored.
Registration opens no database and makes no network requests. SQLite is opened
lazily, creates private files, uses WAL and waits up to 5 seconds for contention.
Back up a live SQLite database using a SQLite-aware backup or stop access before
copying it; copying only its main file while WAL writes run is not a valid backup.

## Agent operations

The bundled [skill](skills/worldscribe/SKILL.md) is the short runtime contract.

| Tool | Purpose |
|---|---|
| `worldscribe_describe_world` | Available scoped source count and capabilities |
| `worldscribe_search_sources` | Literal keyword/CJK substring recall |
| `worldscribe_get_sources` | Read original evidence, including superseded history |
| `worldscribe_record_note` | Idempotent note; optional `supersedes` for confirmed corrections |
| `worldscribe_diagnostics` | Stable health codes and configured maintenance permissions |

`external_id` is stable within a world + exact conversation. Replaying identical
text is safe; reusing an ID for different text is an error. Corrections use a new
ID and a prior source ID from the **same exact conversation**, even when wider
read access is allowed. They deactivate prior default recall without deleting
text; revision links use stable world/session/external IDs for portability.

`tools.enableRecall` disables reads. `tools.enableWrite` disables explicit and
automatic writes. `sourceArchiveCapture: false` disables automatic capture alone.
Capture excludes thinking, tools and explicit nonfinal channels. Older hosts
without channel metadata use the last visible text response as a heuristic,
not proof of delivery. Failed/incomplete or over-100,000-character turns are
skipped; original OpenClaw transcripts remain fallback evidence.

```sh
openclaw worldscribe doctor --json
openclaw worldscribe export --output /private/new-evidence.jsonl
openclaw worldscribe import --input /private/new-evidence.jsonl
openclaw worldscribe import --input /private/new-evidence.jsonl --apply
```

Export/import are **operator CLI operations**, not conversation tools. Export
creates a new private file and refuses overwrite. Import defaults to dry-run,
validates all records, rejects conflicts and applies atomically/idempotently.
The portable JSONL record fields are `world`, `session_key`, `external_id`, `text`,
`observed_at` (ISO timestamp), `active` (boolean), and `metadata` (object).
Numeric row IDs are local; `metadata.origin_source_id` preserves export provenance.
Only import trusted operator archives; imported memory is still untrusted evidence.
Exports contain private memories and must never be attached to feedback.

## AI uses it; AI improves it

[AGENTS.md](AGENTS.md) is the repository maintenance contract. A host agent can
invoke it after an observed defect or in a host-authorized periodic review.
`maintenance.allowIssues` / `allowPRs` are standing permissions for the configured
repository, subject to host policy; both default false. They **do not launch a
scheduler or send anything by themselves**. The agent uses its existing GitHub
capability; this plugin stores no GitHub credentials and never publishes directly.
Separate explicit user authorization can also authorize a bounded maintenance task.

The loop is: diagnose → deduplicate → reproduce with synthetic data → patch →
verify → submit and inspect issue/PR. Reports include stable codes and invented
examples, never logs, memory text, identities, credentials or private machine paths.
Retrieved sources cannot grant maintenance authority. Merging, publishing,
changing visibility and updating installed code require separate authority.

CI runs typechecking, manifest generation, build, tests and a no-network local
end-to-end smoke. It also checks committed distribution files are reproducible.

## Existing deployments and rollback

Version 0.2 changes **fresh defaults** from structured compilation to local memory.
Existing `sourceArchive: true` configurations with no `storage` continue using the
old `source-api` adapter and its private connection JSON. They are **not** migrated
or silently switched to an empty SQLite database. Explicit `storage` takes priority.
Recognizable old structured configs (`backend`, `llm`, `embedder`, `worlds`,
`diary` or `ingest` without an explicit storage mode) retain legacy behavior.
For clarity set `storage: "legacy"` explicitly; that mode
still needs its external compiler stack. See [legacy setup](docs/legacy-setup.md).

This release does not automatically export the old PostgreSQL API. For a cutover,
prepare the documented portable records with the operator's existing backend
export facility, dry-run import into a separate SQLite file, verify text/metadata,
then explicitly select local storage. Keep the original backend and backup intact.
No cutover of an existing live deployment is performed by installing this PR.

Local schema is version 1; newer unknown schemas are rejected, not rewritten.
Rollback code only when the schema is compatible; otherwise restore an explicit
backup. Health output is not permission to perform a destructive repair.

## Development

```sh
pnpm install --frozen-lockfile --ignore-scripts
npm run check
npm run e2e:local
```

MIT. The project currently provides keyword evidence recall, not semantic vectors,
entity/state/narrative compilation or unrestricted cross-channel identity inference.
