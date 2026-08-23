---
title: Work Journal
desc: When and how entries accumulate, the file layout, change diffs, sessions, and the honesty audit.
order: 5
updated: 2026-08-21
---

The work journal is why this app exists. It records what an agent did and why, as **markdown a human reads**. Longer than a commit message, shorter than meeting minutes.

## When entries happen — five moments

Agents record every time they finish a unit of work. The `AGENTS.md` rules define five moments:

| Trigger | When |
|---|---|
| **bug** | A reproducible defect is confirmed fixed |
| **feature** | A new feature's first happy path works |
| **refactor** | A batch that changed structure but not behavior lands, tests green |
| **error** | One diagnose-and-fix cycle — **recorded even when it failed** |
| **chore** | A non-functional change (config, docs) is done |

:::note
`error` recording failures is the point. "What was tried and why it didn't work" has to survive, or the next session's agent walks into the same wall.
:::

## File layout

```
.oculpm/journal/20260821/Bugs/0010_bug_session-attribution.md
                └ workday  └ category └ time └ type └ name
```

There are five category folders — `Bugs` · `Features_to_add` · `Errors` · `Refactors` · `Chores`.

## What's in an entry

Frontmatter holds facts a machine reads; the body holds prose a human reads.

```
---
type: bug
status: done
difficulty: high
created_at: "2026-08-21T00:10:14+09:00"
session_id: "20260821-002"
agent:
  id: claude-code
  version: claude-opus-5
files_touched:
  - path: "src/cache.rs"
    op: update
related: []
tags: [dogfooding]
---

[x] One-line title

## Root cause
…
## Fix
…
## Verification
1–3 lines on how it was confirmed
```

- **status** — `planned` · `in_progress` · `done` · `abandoned`
- **difficulty** — `verylow` through `superhigh` (optional)
- **Body headings are fixed per type**: bug and error use root cause → fix; refactor uses motivation → summary of changes; feature uses what was added → how it flows. All of them end with a required **Verification** section.

:::tip
Verification is mandatory for one reason — the credibility gap between "I fixed it" and "I fixed it and here's how I checked." It gives whoever reads the entry later, human or agent, a thread to re-verify.
:::

## Change diff — what actually changed at the time

Every entry **keeps the git diff from that moment**. Open an entry in the Work Journal screen and you get narrative on the left, changed files and line-level diff on the right.

However many times that file changes later, **the diff attached to the entry stays as it was**. Changes spread across several commits are gathered into one entry.

:::note
If you see "no recorded changes for this entry," it's usually one of two things — it isn't a git repository, or the recorded paths weren't found in git history. In that case you can inspect current changes from the panel below.
:::

## Sessions — how entries are grouped

The app watches file changes and **opens a session** when an agent starts working, closing it after things go quiet. A session is roughly "one sitting" and is named by date and sequence, like `20260821-002`.

Entries are grouped by which session produced them. Even when an agent can't know the session number (writing the file directly from a terminal, say), the app **attributes it by write time**, so there's nothing for you to manage.

## Honesty audit

A card that occasionally appears near the bottom of **Today** (`⌘1`). It reconciles the file changes the app observed against `files_touched` in entries and shows **changes no entry anywhere records**.

- If everything changed today is recorded somewhere, **the card doesn't appear at all** — no noise on clean days
- Temp files, editor artifacts, and agent internal state are never counted
- 80%+ coverage reads **Minor**, 50%+ **Warning**, below that **Critical**

If this card shows up often, [installing the plugin (hook bridge)](/wiki/en/claude-code) is the surest fix. Recording moves from "as much as the model remembers the rules" to "structurally, when the session ends."

## Working with entries

- **Verified** — entries a human read and confirmed can be filtered with the Verified toggle
- **Edit directly** — it's plain markdown; save and the app re-reads it
- **Export** — pick a period on the Retro screen and export entries as one `.md`

:::warn
`.oculpm/index/` is an app-managed cache — don't edit it. Everything else (`journal/`, `planner/`, `discussion/`) is yours.
:::

## Next steps

- How the planning side works → [Planner](/wiki/en/planner)
- Looking back over accumulated entries → [Retro](/wiki/en/retro)
- Nothing being recorded → [Troubleshooting](/wiki/en/troubleshooting)
