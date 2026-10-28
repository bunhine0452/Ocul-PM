<!-- template_version: 1 -->
# Journal file spec (ocul-pm)

> Managed by ocul-pm (do not edit — refreshed on app upgrade).
> The on-demand spec that the master rules (`AGENTS.md` §3) point at — read it **only when the MCP `journal_write` tool is unavailable**. With the tool, the server guarantees paths, frontmatter and header order.

Path `.oculpm/journal/{YYYYMMDD}/{TypeFolder}/{HHMM}_{type}_{slug}.md` — workday/time from the local OS clock (don't ask) · TypeFolder = `Bugs`|`Features_to_add`|`Errors`|`Refactors`|`Chores` · type = bug|feature|error|refactor|chore (⚠ **not** the commit types `fix`/`feat` — and the folder is `Bugs/`, never `Fix/`) · slug = ASCII kebab ≤40 chars.

Required frontmatter: `schema_version: 1` · `type` · `slug` · `status` (planned|in_progress|done|abandoned) · `created_at` (⚠ tz offset like `+09:00` — never `Z`/`+0900`) · `session_id` (fallback `"manual-<workday>-HHMMSS"`) · `agent` (⚠ a **mapping** with id/version keys, never a string — id = your agent id (claude-code/cursor/…), version = your model) · `language` (ko|en) · `verified_by_user: false` · `files_touched` (⚠ `[{path, op}]` — op is the enum create|update|delete|rename|correct · **quote the path** when it contains `[` `]` `{` `}` `:` `#`) · `related: []` · `tags: []`. Optional: `difficulty` (verylow~superhigh), `updated_at`.

Body: first line is a `[x] title` checkbox. Mandatory headers in order — bug/error `## Root cause`→`## Fix` · refactor `## Motivation`→`## Summary of changes` · feature `## What was added`→`## How it works` · chore free-form. Common tail: `## Verification` (required, 1–3 lines — let **something other than you** speak: commands with their **last result line** (N passed · exit 0), numbers. Neither a command name nor "Checked" is evidence) · `## Notes` (optional).

Need an example? Read a recent entry of the same type.
