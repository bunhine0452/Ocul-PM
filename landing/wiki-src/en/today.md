---
title: Today
desc: The screen you land on — activity rings, commit graph, agent contributions, honesty audit, standup copy.
order: 4
updated: 2026-08-21
---

`⌘1` is what you see when the app opens. It gathers **what happened today** onto one page — and it fills in without you recording anything.

## Activity rings

Three concentric rings in the middle.

| Ring | What it counts |
|---|---|
| **Entries** | Journal entries written today |
| **Files changed** | Distinct files the app observed |
| **Line delta** | Lines added / removed |

If there were error cycles, they're shown too — how many walls you hit today.

:::note
**Line delta** is computed from the **change diff attached to each entry**, not from the entry's frontmatter. In other words, it doesn't rely on agents writing the numbers down themselves.
:::

## The monitor

The small numbers beside the rings. If the rings are the *result*, these are the *state*.

- **Active time · N sessions** — how long agents actually worked today
- **Total entries** — cumulative for this project
- **Commits today** / **Uncommitted changes** — whether anything is waiting to be committed

## This week's output

Seven days of bars. It surfaces the rhythm a single day can't show — the bursts and the gaps.

## Commit graph

Today's commits, drawn as lanes. Click a commit and **it opens on GitHub**.

:::note
If this isn't a git repository the card turns into a hint (a repo has to exist at the root or in a subfolder). Without a GitHub remote the graph still draws, but commits won't open in a browser.
:::

## Agent contributions

When you mix several agents, this splits out who did what. With a single agent it's a card you can ignore.

## Next up · Plan updates · Awaiting a decision

Three cards that point **forward** rather than back.

- **Next up** — unfinished planner items, in-progress ones first
- **Plan updates** — planner items that moved today
- **Awaiting a decision** — discussion documents with no conclusion yet

## Where records leak — two cards

Both are **hidden most of the time**. They only appear when there's a problem, so a clean day stays quiet.

### Sessions that ended with no entry

Cases in the last 7 days where **a session opened but no entry was written**. Even with rules and tools in place, short sessions can skip the write-up.

Turn on **auto journal draft** (`auto_journal_draft`) in Settings and a draft is left automatically when a session ends. You can enable it straight from the card.

### Honesty audit

Compares the file changes the app observed against the `files_touched` recorded in entries, and shows **changes no entry mentions**. More in [Work Journal](/wiki/en/journal).

## Copy standup

Turns yesterday-and-today's entries into **one shareable block** on your clipboard. Good for pasting into a morning standup.

With an API key the AI polishes it; without one you get a **plain template** with the bones. Both work.

:::tip
For longer periods (weekly, PR descriptions) use the [Retro](/wiki/en/retro) screen. Standup is the shortcut for "yesterday and today."
:::

## Code search bar

Jumps straight to code search from this screen. The **All entries** link goes to Work Journal (`⌘2`).

## Next steps

- How the records the rings count pile up → [Work Journal](/wiki/en/journal)
- Where "Next up" comes from → [Planner](/wiki/en/planner)
- Looking back over longer periods → [Retro](/wiki/en/retro)
