---
name: worldscribe
description: Structured long-document memory (timeline, entities, states, narratives, mental states) via the worldscribe_* tools. Use for questions about past decisions, how a project or relationship evolved, what someone felt about something, or anything about a book/document that was ingested.
---

# Worldscribe: structured memory over long text

Worldscribe compiles long text (a book, a day of conversations, a document) into a world of **events** on a timeline,
**entities** (people, orgs, places), **states** (who owns what, who works for whom, alive/location/title… as of a point in time),
**narratives** (how a storyline unfolded), and **mental states** (emotions, attitudes, beliefs, intentions — always inferences).
Every fact points back to the source passage.

It complements memory-core: memory-core is for short durable facts and preferences; Worldscribe is for *what happened,
when, and how it changed*.

## Worlds

- `diary` — one unit per calendar day of your conversations with the user. Unit label is 天 (day). Ordinal = days since
  the configured epoch + 1; `worldscribe_describe_world` shows the range and the latest day.
- Book / document worlds — one unit per chapter (回 / 章 / 段). Created by `worldscribe_ingest_document`.
- `worldscribe_list_worlds` lists them all. Every tool accepts `world`; omit it for the default world.

## Which tool

| The user asks… | Call |
|---|---|
| Anything for the first time about a world | `worldscribe_describe_world` (range, top entities, storylines, state attributes) |
| "When did we decide X?" / "What did we say about Y?" | `worldscribe_semantic_search`, then `worldscribe_get_sources` for the exact quote |
| "What is the status of project Z?" / "Who owns X as of day N?" | `worldscribe_recall_state` (`as_of_chapter` = unit index) |
| "How did Z evolve?" / "Tell me the story of…" | `worldscribe_recall_narrative` |
| "What happened last week / between chapter 3 and 5?" | `worldscribe_recall_time` |
| "What has 刘备 / the user / the team done?" | `worldscribe_recall_entity` |
| "How did I feel about…?" / "What does 周瑜 think of 诸葛亮?" | `worldscribe_recall_mental_state` — present results as inferences, with `inference_type` and confidence |

Quote sources before asserting details: results carry `src` ids; `worldscribe_get_sources` returns the passages.

## Ingesting a document ("read this book/article")

1. Call `worldscribe_ingest_document` with `url` **or** `path` **or** `text`, a `world` id (e.g. `xiyouji`), and a `title`.
   It returns a cost/time estimate first when the document is large (`needs_confirmation: true`).
2. Tell the user the estimate (tokens, ≈ USD, ≈ minutes) and ask for confirmation, then call again with `confirm: true`.
3. The compile runs in the background: report the `job_id`, and use `worldscribe_ingest_status` when asked for progress.
   Chapters already compiled are recallable immediately.
4. Local files must live under the configured allowed roots (default: ~/Downloads, ~/Documents).

## Notes and deletion

- `worldscribe_record_note` stores a note / email / message as one source unit (give an `external_id` to make it idempotent).
- `worldscribe_forget` deletes a source unit and every fact that only it supported. Only call it when the user explicitly
  asks to delete a specific unit (by external id or doc + unit number), and confirm what will be removed with `dry_run: true` first.
