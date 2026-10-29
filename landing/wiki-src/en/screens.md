---
title: Screens tour
desc: The screens of 4.0 — Today · Work Journal · Plan · Diff · Terminal · Settings — and the start window, on one page.
order: 3
updated: 2026-10-29
---

Ocul Since 4.0 the app has five screens (Today · Work Journal · Plan · Diff · Terminal) plus Settings. One principle — **show only the exceptions.** The screen grows with what a person must see, not with how much the agent did, so someone with 3 entries a day and someone with 60 use the same screen, with no modes. Run the agent in the in-app **Terminal** tab or in your own terminal — the records come out the same.

Top-bar tab order = `⌘` number order (`⌘1` – `⌘5`). `⌃Tab` · `⌃⇧Tab` cycle through them, and a two-finger trackpad swipe goes back · forward. Settings is the gear at the end of the top bar (`⌘,`). On first launch a four-page "Getting started" guide shows these screens briefly; reopen it from the Help menu or `⌘K`.

| Screen | Key | What it does |
|---|---|---|
| **Today** | `⌘1` | "Look first" — Claude is waiting · Claude asks (answer right there) · failed verdicts · changes with no journal · blocked · a new plugin version. Below it, entries finished without verification and what was done today (work with evidence folds to one line per plan) |
| **Work Journal** | `⌘2` | A list on the left, the detail on the right (body first — verification box · inline diff per file · related entries). The plan item in the header links to that item. Journal search (`/`) lives here |
| **Plan** | `⌘3` | Done condition · check command · last verdict right under the title, the next item run in the terminal or taken to the end (`/goal`). "Send to Claude" on every item. Finished phases fold to one line |
| **Diff** | `⌘4` | Uncommitted / last-commit diffs. "No journal" (files no entry mentions) comes first, and [Ask Claude] asks for an entry |
| **Terminal** | `⌘5` | A shell in this project folder. One session is just the terminal; two or more get a tab row on top. Claude Code's status signal tells it working · waiting · done. "Next" on Today and Plan opens `claude` here. Sessions end when the window closes, and closing while something runs asks first |
| **Settings** | `⌘,` | Agent connections · this project · display · data, on one page |

A window with no project is the **start window** — recent projects and Open folder. Pick a folder and that window becomes the project.

The journal and the plan are the app's two pillars — see [Work Journal](/wiki/en/journal) and [Plan](/wiki/en/planner).

:::tip
"Open" in an entry's detail and on Diff hands the file to your **external editor** command (VS Code · Cursor …). There is no editor inside the app.
:::

## Screens removed in 4.0

| Removed | Instead |
|---|---|
| Search (semantic · symbol · text) | Journal search is in Work Journal (`/`); code search is your agent's grep |
| Discussions | A plan's decision block. `.oculpm/discussion/` files are never deleted |
| Branch · Skills & Rules | Recorded-rate lives in "unrecorded changes" on Today and Diff; skills live in the plugin |
| Menu-bar tray · Chrome-style tabs | One window = one project, switched by your OS |
| Simple / Pro density | One screen that shows only the exceptions |

The measured reasons are in the "removed in 4.0" table of [PROMISE.md](https://github.com/bunhine0452/Ocul-PM/blob/main/docs/PROMISE.md) (Korean).

## Next steps

- What Today unfolds and folds → [Today](/wiki/en/today)
- What the last verdict is → [Plan](/wiki/en/planner)
- Every shortcut → [Shortcuts](/wiki/en/shortcuts)
