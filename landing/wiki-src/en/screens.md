---
title: Screens tour
desc: The five surfaces of 4.0 — Today · Work Journal · Plan · Diff · Settings — and the start window, on one page.
order: 3
updated: 2026-10-29
---

Ocul-PM 4.0 has five surfaces. One principle — **show only the exceptions.** The screen grows with what a person must see, not with how much the agent did, so someone with 3 entries a day and someone with 60 use the same screen, with no modes. The agent itself runs **in your own terminal**.

Sidebar order = `⌘` number order (`⌘1` – `⌘4`). Settings sits at the foot of the sidebar (`⌘,`).

| Screen | Key | What it does |
|---|---|---|
| **Today** | `⌘1` | "To check" — failed verdicts · entries without command evidence · changes no entry mentions · blocked · decisions that are yours · a new plugin version. Work with evidence folds to one line per plan |
| **Work Journal** | `⌘2` | A list on the left, the detail on the right (verification box · inline diff per file · related entries). Journal search (`/`) lives here |
| **Plan** | `⌘3` | Done condition · check command · last verdict right under the title, the next item and a prompt to copy |
| **Diff** | `⌘4` | Uncommitted / last-commit diffs. "Unrecorded" (files no entry mentions) comes first |
| **Settings** | `⌘,` | Agent connections · this project · display · data, on one page |

A window with no project is the **start window** — recent projects and, the first time, three steps (folder → turn recording on → copy the plugin install command).

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
