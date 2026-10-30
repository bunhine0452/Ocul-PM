<!-- template_version: 2 -->
# Journal and plan file spec (ocul-pm)

> Managed by ocul-pm (do not edit — refreshed on app upgrade).
> The on-demand spec that the master rules (`AGENTS.md` §3) point at — read it **only when the MCP tools (`journal_write` · `plan_update` · `plan_create`) are unavailable**. With the tools, the server guarantees paths, frontmatter, header order and the plan-log.

## Journal

Path `.oculpm/journal/{YYYYMMDD}/{TypeFolder}/{HHMM}_{type}_{slug}.md` — workday/time from the local OS clock (don't ask) · TypeFolder = `Bugs`|`Features_to_add`|`Errors`|`Refactors`|`Chores` · type = bug|feature|error|refactor|chore (⚠ **not** the commit types `fix`/`feat` — and the folder is `Bugs/`, never `Fix/`) · slug = ASCII kebab ≤40 chars.

Required frontmatter: `schema_version: 1` · `type` · `slug` · `status` (planned|in_progress|done|abandoned) · `created_at` (⚠ tz offset like `+09:00` — never `Z`/`+0900`) · `session_id` (fallback `"manual-<workday>-HHMMSS"`) · `agent` (⚠ a **mapping** with id/version keys, never a string — id = your agent id (claude-code/cursor/…), version = your model) · `language` (ko|en) · `verified_by_user: false` · `files_touched` (⚠ `[{path, op}]` — op is the enum create|update|delete|rename|correct · **quote the path** when it contains `[` `]` `{` `}` `:` `#`) · `related: []` · `tags: []`. Optional: `difficulty` (verylow~superhigh), `updated_at`.

Body: first line is a `[x] area: what changed` checkbox — one sentence, area included, within 40 characters (e.g. `terminal: show Claude's status`). Reuse an area this project already uses (1–12 characters) and put it first in `tags` too. Don't join two phrases with a dash (details go in the body). `journal_write` refuses any other shape. Mandatory headers in order — bug/error `## Root cause`→`## Fix` · refactor `## Motivation`→`## Summary of changes` · feature `## What was added`→`## How it works` · chore free-form. Common tail: `## Verification` (required, 1–3 lines — let **something other than you** speak: commands with their **last result line** (N passed · exit 0), numbers. Neither a command name nor "Checked" is evidence) · `## Notes` (optional).

Need an example? Read a recent entry of the same type.

## Plans (`.oculpm/planner/<plan_id>.md`)

Update: flip the item's glyph (one character) and **append one row** to the `<!-- oculpm:plan-log begin v1 -->` table at the bottom (never edit existing rows):
`| <ISO time+offset> | #item-id | <your agent.id verbatim> | old→new glyph (→☐ for new items) | <journal path you just wrote> | short note |` — escape `|` inside a cell as `\|`. When you ran the check command, start the note with `verdict ✓ <last result line>` or `verdict ✗ <last result line>`.

Rules: preserve `{#id}` markers and managed-block boundaries · items are ONE line — keep `{#id}` at the *end*, never wrap (a wrapped `{#id}` is invisible) · give new items stable English kebab ids · nest at most one level (two-space indent `  - [ ] sub {#id}`; the parent's glyph rolls up) · reference journals via the journal column, never paste them · never touch the `archived:` marker lines · the body glyph is current truth; the log is history.

Closing: never set `status: done` while any `[ ]`/`[~]`/`[!]` remains — **move** those into a live plan first (open items in a folded plan are lost).

New plan: YAML frontmatter (`oculpm_plan: v1` · `id` (kebab, same as filename) · `title` (quoted) · `status: active` · `created`/`updated` · `owner` (your agent.id)) → one line each of `**Done when:** …` and `**Check:** …` → `## Phase title {#id}` headings (no glyph — progress rolls up) → `- [ ] item {#id}` lines (item titles under 40 characters) → an empty `<!-- oculpm:plan-log begin v1 -->`…`<!-- oculpm:plan-log end -->` block.
