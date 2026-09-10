---
title: Screen Tour
desc: What each screen in the sidebar does — from Today to the code editor, on one page.
order: 3
updated: 2026-08-21
---

Ocul-PM looks like a lot of screens, but it's really **two groups**. The upper "record" group is where what agents did piles up; the lower "tools" group is for digging through code alongside those records.

Sidebar order = `⌘` number order. Only the first ten get numbers.

## Record

| Screen | Key | What it does |
|---|---|---|
| **Today** | `⌘1` | The day at a glance — activity rings, commit graph, agent contributions, honesty audit |
| **Work Journal** | `⌘2` | A timeline of entries. Collapses by date; each entry is narrative + change diff, side by side |
| **Changes** | `⌘3` | Your working tree, line by line. Can also group by entry or plan |
| **Planner** | `⌘4` | The current plan — a living document agents keep up to date |
| **Discussions** | — | Lay out options and compare them before deciding |
| **Branch** | — | What happened on this branch — commits, entries, plan items, changed files, coverage |

Journal and Planner are the two pillars — see [Work Journal](/wiki/en/journal) and [Planner](/wiki/en/planner).

## Tools

| Screen | Key | What it does |
|---|---|---|
| **Code Search** | `⌘5` | Semantic · Symbols · Exact match — three modes |
| **Code Map** | `⌘6` | File and symbol dependency graph. How far a change reaches |
| **Terminal** | `⌘7` | A real shell rooted in the project |
| **Code** | `⌘8` | The in-app editor (Monaco — VS Code's own editor) |
| **Agents** | `⌘9` | Claude Code and Codex running inside the app ([integration](/wiki/en/claude-code)) |
| **AI panel** | `⌘0` | Chat with several LLM providers, including planner action proposals |
| **Skills & Rules** | — | Everything injected into agents, in one place |
| **Sessions** | — | The agents attached to this project, and the teams you grouped |

:::tip
`⌘J` pops the **terminal dock** over whatever screen you're on. No need to navigate to Terminal (`⌘7`) — handy for typing commands while reading an entry.
:::

## Code Search — the three modes

| Mode | When | How it finds things |
|---|---|---|
| **Semantic** | "Where do we handle login failure?" | Local embeddings find passages close in meaning |
| **Symbols** | You know the function or class name | From the symbol table extracted by tree-sitter |
| **Exact match** | Chasing a typo, constant, or string | The literal string |

Semantic indexing is **entirely local** — code never leaves the machine. A project is indexed once when first opened, then only changed files are refreshed. By default it scans code only; turn on **Include docs** to pull `.md` and `.txt` into results.

## Code Map — what it's for

A graph of what calls what, across files and symbols. Three uses:

- **Understanding an unfamiliar repo** — modules cluster automatically
- **Tracing calls** — which functions a file actually calls, at symbol granularity
- **Blast radius** — walk backwards from a file you just changed to see what might wobble

## Discussions

If the journal is *what already happened* and the planner is *the current plan*, discussions are **the moment before deciding**. You lay out options A/B/C with pros and cons and choose, and it's saved to `.oculpm/discussion/<name>/discussion.md`.

:::note
Agents only create a discussion document when you **explicitly ask** — "let's compare options," "let's write this problem up." Ordinary work is covered by entries and the planner.
:::

## Next steps

- What an entry looks like and holds → [Work Journal](/wiki/en/journal)
- What "the plan updates itself" means → [Planner](/wiki/en/planner)
- The full key list → [Shortcuts](/wiki/en/shortcuts)
