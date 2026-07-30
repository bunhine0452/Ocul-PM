<!-- schema_version: 1 -->
<!-- template_version: 6 -->
# ocul-pm work-journal rules

You are working in a project tracked by ocul-pm. Every time you finish **one logical unit of work** (bug fix / feature / refactor / error cycle / chore), record it immediately — do not ask the user first.

> **MCP tools first**: when the `oculpm` tools (`journal_write` / `plan_status` / `plan_update` / `plan_create`) are visible, **use them instead of writing the files in §2 yourself** — the server guarantees paths, frontmatter and `{#id}` conventions (planner updates in §4 go through `plan_update`, new plans through `plan_create`). Only write files directly when the tools are unavailable.

## 1. When to record (5 triggers)

**bug fix** (a reproducible defect verified gone) · **feature done** (first happy-path works) · **refactor batch** (same behaviour + structural change complete, tests green) · **error cycle** (one diagnose-fix cycle — record failures too) · **chore** (non-functional change done).

## 2. Journal file format (only without the tools)

Path `.oculpm/journal/{YYYYMMDD}/{TypeFolder}/{HHMM}_{type}_{slug}.md` — workday/time from the local OS clock (don't ask) · TypeFolder = `Bugs`|`Features_to_add`|`Errors`|`Refactors`|`Chores` · type = bug|feature|error|refactor|chore · slug = ASCII kebab ≤40 chars.

Required frontmatter: `schema_version: 1` · `type` · `slug` · `status` (planned|in_progress|done|abandoned) · `created_at` (⚠ timezone offset REQUIRED in `+09:00` form — never `Z` or `+0900`) · `session_id` (fallback `"manual-<workday>-HHMMSS"`) · `agent` (⚠ a **mapping** with id/version keys, never a string — id is your agent id (claude-code/cursor/gemini-cli/…), version is your model name) · `language` (ko|en) · `verified_by_user: false` · `files_touched` (⚠ `[{path, op}]` — op is the enum create|update|delete|rename|correct) · `related: []` · `tags: []`. Optional: `difficulty` (verylow~superhigh), `updated_at`.

Body: first line is a `[x] title` checkbox. Mandatory headers in order — bug/error `## 발생 원인`→`## 해결 방법` · refactor `## 동기`→`## 변경 요약` · feature `## 추가 기능`→`## 동작 흐름` · chore free-form. Common tail: `## 검증` (required, 1–3 lines on how you verified) · `## 메모` (optional).

Need an example? Read 1–2 recent entries of the same type — real data is the best template.

## 3. Never

- Never write into `.oculpm/index/**` (app-managed).
- Never include secrets / API keys / `.env` contents — detected writes are rejected.
- Never edit an existing journal entry (new file + `related` link) · never bundle two work units in one file.

## 4. Planner update (right after the journal)

The journal is retrospect; the **Planner** (`.oculpm/planner/*.md`) is the current plan. Right after writing a journal entry, update the matching plan item (skip if none exists).

1. Flip the item's status glyph: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked · `[>]` deferred · `[-]` dropped
2. Append **one row** to the `<!-- oculpm:plan-log begin v1 -->` table at the bottom (never edit existing rows):
   `| <ISO time+offset> | #item-id | <your agent.id verbatim> | old→new glyph (→☐ for new items) | <journal path you just wrote> | short note |`

Rules: preserve `{#id}` markers and managed-block boundaries · items are ONE line — keep `{#id}` at the *end* of the line, never wrap (a wrapped `{#id}` is invisible to the parser) · give new items stable English kebab ids · never paste journal content into the planner (reference it via the journal column) · **never modify a plan whose frontmatter `status:` is not `active`** (done/archived — work in a new plan instead) · the body glyph is the truth for current state; the log is history.

Create new plans with the MCP `plan_create` tool. Without it: YAML frontmatter (`oculpm_plan: v1` · `id` (kebab, same as filename) · `title` (quoted) · `status: active` · `created`/`updated` · `owner` (your agent.id)) → `## Phase title {#id}` headings (no glyph — phase progress rolls up from items) → `- [ ] item {#id}` lines → an empty `<!-- oculpm:plan-log begin v1 -->`…`<!-- oculpm:plan-log end -->` block.

Lock major decisions as `### Decision N — title {#id}` blocks under `## 결정` (lock date · agent.id · rationale · `영향: #item-ids`).

## 5. Discussion docs (only on explicit request)

Only when the user **explicitly asks** to *"compare options / think this problem through / draft a big plan"*, write `.oculpm/discussion/<slug>/discussion.md` — read **`.oculpm/agents/discussion-spec.md`** at that moment and follow it. Never create one for routine work (the journal and planner are the record).
