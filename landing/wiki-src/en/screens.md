---
title: Screen Tour
desc: What each screen in the sidebar does — from Today to Skills & Rules, on one page.
order: 3
updated: 2026-10-28
---

Ocul-PM looks like a lot of screens, but it's really **two groups**. The upper "record" group is where what agents did piles up; the lower "tools" group is for digging through code alongside those records.

Sidebar order = `⌘` number order. Only the first ten get numbers.

Screens have **tiers** ([promise document](https://github.com/bunhine0452/Ocul-PM/blob/main/docs/PROMISE.md), Korean): Today · Work Journal · Changes · Planner are **core** (what the app promises); Discussions · Branch · Search · Skills & Rules are **viewer** (they open, show, and don't break). The beta tier — terminal, editor, in-app agents, AI panel — was removed on 2026-10-28; your agent runs in your own terminal.

## Record

| Screen | Key | What it does |
|---|---|---|
| **Today** | `⌘1` | The day at a glance — activity rings, commit graph, agent contributions, honesty audit |
| **Work Journal** | `⌘2` | A timeline of entries. Collapses by date; each entry is narrative + change diff, side by side |
| **Changes** | `⌘3` | Your working tree, line by line. Can also group by entry or plan |
| **Planner** | `⌘4` | The current plan — a living document agents keep up to date |
| **Discussions** | `⌘7` | Lay out options and compare them before deciding |
| **Branch** | `⌘8` | What happened on this branch — commits, entries, plan items, changed files, coverage |

Journal and Planner are the two pillars — see [Work Journal](/wiki/en/journal) and [Planner](/wiki/en/planner).

## Tools

| Screen | Key | What it does |
|---|---|---|
| **Search** | `⌘5` | Semantic · Symbols · Exact match — three modes |
| **Skills & Rules** | `⌘6` | Everything injected into agents, in one place |

:::tip
"Open" on a search result hands the file and line to the **external editor** command in Settings (VS Code · Cursor …). There is no in-app editor.
:::

## Code Search — the three modes

| Mode | When | How it finds things |
|---|---|---|
| **Semantic** | "Where do we handle login failure?" | Local embeddings find passages close in meaning |
| **Symbols** | You know the function or class name | From the symbol table extracted by tree-sitter |
| **Exact match** | Chasing a typo, constant, or string | The literal string |

Semantic indexing is **entirely local** — code never leaves the machine. A project is indexed once when first opened, then only changed files are refreshed. By default it scans code only; turn on **Include docs** to pull `.md` and `.txt` into results.

## Discussions

If the journal is *what already happened* and the planner is *the current plan*, discussions are **the moment before deciding**. You lay out options A/B/C with pros and cons and choose, and it's saved to `.oculpm/discussion/<name>/discussion.md`.

:::note
Agents only create a discussion document when you **explicitly ask** — "let's compare options," "let's write this problem up." Ordinary work is covered by entries and the planner.
:::

## Next steps

- What an entry looks like and holds → [Work Journal](/wiki/en/journal)
- What "the plan updates itself" means → [Planner](/wiki/en/planner)
- The full key list → [Shortcuts](/wiki/en/shortcuts)
