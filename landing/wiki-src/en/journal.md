---
title: Work Journal
desc: When and how entries accumulate, the file layout, the verification box and change diffs, journal search, and unrecorded changes.
order: 5
updated: 2026-10-29
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
tags: [cache, dogfooding]
---

[x] cache: fix late invalidation

## Root cause
…
## Fix
…
## Verification
1–3 lines on how it was confirmed
```

- **Title** — `area: what changed`, one sentence, area included, within 40 characters. The area (1–12 characters) reuses a word the project already uses (e.g. terminal · MCP · CI · landing) and is kept as the first tag too, so the tag filter doubles as a per-area view. Don't join two phrases with a dash. The recording tool (`journal_write`) refuses any other shape and says how to fix it
- **status** — `planned` · `in_progress` · `done` · `abandoned`
- **difficulty** — `verylow` through `superhigh` (optional)
- **Body headings are fixed per type**: bug and error use root cause → fix; refactor uses motivation → summary of changes; feature uses what was added → how it flows. All of them end with a required **Verification** section.

:::tip
Verification is mandatory for one reason — the credibility gap between "I fixed it" and "I fixed it and here's how I checked." The verdict is not the agent's word but **the command that ran and its last line of output**.
:::

## The Work Journal screen

On the left, one row per entry under date headers (type dot · title · evidence chip · time/agent/file count); on the right, the selected entry's detail. The toolbar shows "N · of M total", filters (all · bugs · features · refactors · chores · no evidence) and a search box.

- **Verification box** — pulls the command that ran and its last result line out of the Verification section. With no command evidence it shows a warning chip and calls the entry a claim; when a human has read it and agrees, press **Checked**
- **Journal search** (`/`) — titles · files · tags · body, grouped by date. 4.0 removed the Search screen; journal search lives here
- Keys listen only inside the screen — `j`/`k` move · `Enter` open · `/` search

## Change diff — what actually changed at the time

Every entry **keeps the git diff from that moment**. In an entry's detail, each recorded file's line-level diff unfolds inline.

However many times that file changes later, **the diff attached to the entry stays as it was**. Changes spread across several commits are gathered into one entry.

:::note
If you see "no recorded changes for this entry," it's usually one of two things — it isn't a git repository, or the recorded paths weren't found in git history. In that case you can inspect current changes from the panel below.
:::

## Sessions — how entries are grouped

The app watches file changes and **opens a session** when an agent starts working, closing it after things go quiet. A session is roughly "one sitting" and is named by date and sequence, like `20260821-002`.

Entries are grouped by which session produced them. Even when an agent can't know the session number (writing the file directly from a terminal, say), the app **attributes it by write time**, so there's nothing for you to manage.

## Unrecorded changes

The app reconciles the file changes it observed against `files_touched` in entries and points at **changes no entry anywhere records** — in Today's "Look first", and as the "No journal" group at the top of Diff (`⌘4`).

- If everything changed today is recorded somewhere, **nothing shows** — no noise on clean days
- Temp files, editor artifacts, and agent internal state are never counted
- On Diff, **[Ask Claude]** hands that file list to the in-app terminal's claude to record, and **[Record it myself]** opens the composer pre-filled with those files

If this shows up often, [installing the plugin](/wiki/en/claude-code) is the surest fix. Recording moves from "as much as the model remembers the rules" to "structurally, when the session ends."

## Working with entries

- **Checked** — a human's check mark is stored with a fingerprint of the body at that moment; if an agent edits the body later, it stops counting as checked
- **Edit directly** — it's plain markdown; save and the app re-reads it

:::warn
`.oculpm/index/` is an app-managed cache — don't edit it. Everything else (`journal/`, `planner/`, the `discussion/` 3.x created …) is yours, and the app never deletes it.
:::

## Next steps

- How the planning side works → [Plan](/wiki/en/planner)
- Nothing being recorded → [Troubleshooting](/wiki/en/troubleshooting)
