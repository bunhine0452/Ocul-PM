<!-- schema_version: 1 -->
<!-- template_version: 20 -->
# ocul-pm work-journal rules

You are working in a project tracked by ocul-pm. Every time you finish **one logical unit of work** (bug fix / feature / refactor / error cycle / chore), record it immediately — do not ask the user first.

> **MCP tools first**: when the `oculpm` tools (`journal_search` / `journal_read` / `journal_write` / `plan_status` / `plan_update` / `plan_create`) are visible, use them instead of writing files — the server guarantees paths, frontmatter and `{#id}` conventions. Only without them: §3.

## 0. Before you start — search the past first

The cause, an earlier decision or an approach that already failed is in the journal — among hundreds of entries, so skimming won't find it.

- Know the file you'll change? `journal_search(file: "watcher.rs")` — most precise filter; start here.
- Have a symptom? `journal_search(query: "IME composition", types: ["bug"])`.
- Expand only what's worth reading: `journal_read(path: …)`. Plan context: `plan_status`.

Link what you find from the new entry's `related`. Without the tools, grep `.oculpm/journal/**`.

## 1. Working discipline (plan or no plan)

- **Done is an outcome**: before code, say in one line what must be true at the end — and what should happen next because of it. A task list is not a done condition. Ambiguous? At most three questions. More than two steps → `plan_create` (done_when · check). Go deeper, not wider.
- **Something other than you judges**: first pick a check command that comes back pass or fail (test, benchmark, repro script) — if none exists, build it first. At the end take its **last result line**; "done" is not evidence. Green? Still launch it and use it once if you can.
- **Start from raw material**: logs, real data, a reproduction — not summaries or memory. Use the expert's tools (profiler, DB query, statistics, debugger), not the expert's vocabulary.
- **Hard numeric targets are normal**: before calling something impossible, try the next method. Two failures with the same approach → change the approach. Falling short is allowed — record how far you got, in numbers.
- **Record failures too**: a dead end is an error-cycle entry — raw material for the next session. What is left or blocked goes into plan items (`[ ]` · `[!]`), not the chat.

## 2. When to record (5 triggers)

**bug fix** (a reproducible defect verified gone) · **feature done** (first happy-path works) · **refactor batch** (same behaviour + structural change complete, tests green) · **error cycle** (one diagnose-fix cycle — even a failed one) · **chore** (non-functional change done).

## 3. Only without the tools

**Read `.oculpm/agents/journal-spec.md`** and write the files yourself to that spec — journal path, frontmatter, headers and `## Verification`; plan glyphs, plan-log rows and the new-plan skeleton.

## 4. Never

- Never write into `.oculpm/index/**` (app-managed) · never touch `<plan_id>.log.md` (the app's log archive).
- Never include secrets / API keys / `.env` contents — detected writes are rejected.
- Never edit an existing journal entry (new file + `related` link) · never bundle two work units in one file.
- Never `git add -A` (parallel sessions share the index) — stage explicit paths, add→commit in one go.
- Never hand-edit plan frontmatter (`status:` · `updated:`) · never modify a plan whose `status` is not `active` — work in a new plan.

## 5. Planner update (right after the journal)

The journal is retrospect; the **Planner** (`.oculpm/planner/*.md`) is the current plan. Right after a journal entry, flip the matching item with `plan_update` — `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked · `[>]` deferred · `[-]` dropped; the server appends a row to the `oculpm:plan-log` block. A parent rolls up from its children — **never set a parent directly**. When you take an item, mark it `[~]` first so a parallel session won't take it too.

Create new plans with `plan_create`, giving a one-line **done condition** (`done_when`: the outcome beyond the tasks) and a **check command** (`check`: what passes or fails it); the session-start hook ships both with the items. Whenever you run the check (closing the last item or midway), start the `plan_update` note with `verdict ✓ <last result line>` or `verdict ✗ <last result line>` — the next session's start hook ships it as the plan's last verdict.

Lock major decisions and option comparisons as `### Decision N — title {#id}` blocks under the plan's `## Decisions` (date · agent.id · rationale · `Affects: #item-ids`). Don't create a separate document.
