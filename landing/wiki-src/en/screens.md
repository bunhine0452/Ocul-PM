---
title: Screens tour
desc: The screens of 4.0 — Today · Work Journal · Plan · Diff · Terminal · Settings — and the start window, on one page.
order: 3
updated: 2026-11-15
---

Since 4.0, Ocul has five screens (Today · Work Journal · Plan · Diff · Terminal) plus Settings. One principle — **show only the exceptions.** The screen grows with what a person must see, not with how much the agent did, so someone with 3 entries a day and someone with 60 use the same screen, with no modes. Run the agent in the in-app **Terminal** tab or in your own terminal — the records come out the same.

Top-bar tab order = `⌘` number order (`⌘1` – `⌘5`). `⌃Tab` · `⌃⇧Tab` cycle through them, and a two-finger trackpad swipe goes back · forward. Settings is the gear at the end of the top bar (`⌘,`). On first launch a four-page "Getting started" guide shows these screens briefly; reopen it from the Help menu or `⌘K`.

| Screen | Key | What it does |
|---|---|---|
| **Today** | `⌘1` | One line of numbers on the right of the date line (your turn · plans to close · arrived · only here). "Needs your eyes" — Claude's questions (answer right there) · a waiting session · failed check commands · changed after pass · a ✓ from another machine · changes with no journal · blocked · a new plugin version, with the next item as its last row. Below it, entries finished without verification, and beside them what was done today (on a long day, one line per plan) |
| **Work Journal** | `⌘2` | A list on the left, the detail on the right (evidence first — verification box · body · inline diff per file · related entries). The plan item in the header links to that item. Journal search (`/`) lives here |
| **Plan** | `⌘3` | Done condition · check command · last result right under the title, the next item run in the terminal or taken to the end (`/goal`). "Run in shell" beside the check command runs it in a new shell session after a confirm dialog. "Send to Claude" on every item. Finished phases fold to one line, and a plan with nothing left gets "Close plan" |
| **Diff** | `⌘4` | Uncommitted / last-commit diffs. "No journal" (files no entry mentions) comes first, and [Ask for an entry] asks for one |
| **Terminal** | `⌘5` | A shell in this project folder. One session is just the terminal; two or more get a tab row on top — a session is named after the conversation title Claude Code sends. Claude Code's status signal tells it working · waiting · done. In Claude · Codex input `⇧↩` is a newline (Enter in a shell or vim), and `⌘L` sends the selected output to Claude. "Next" on Today and Plan opens `claude` here. Sessions end when the window closes, and closing while something runs asks first |
| **Settings** | `⌘,` | "To fix" on top, then agents · this project · appearance · app, on one page |

A window with no project is the **start window** — recent projects and Open folder. Pick a folder and that window becomes the project.

The journal and the plan are the app's two pillars — see [Work Journal](/wiki/en/journal) and [Plan](/wiki/en/planner).

:::tip
"Open" in an entry's detail and on Diff hands the file to the editor chosen under **Open files in** in Settings → App (Auto · VS Code · Cursor · Default app · Custom). There is no editor inside the app.
:::

## Screens removed in 4.0

| Removed | Instead |
|---|---|
| Search (semantic · symbol · text) | Journal search is in Work Journal (`/`); code search is your agent's grep |
| Discussions | A plan's decision block. `.oculpm/discussion/` files are never deleted |
| Branch · Skills & Rules | Recorded-rate lives in "No journal" on Today and Diff; skills live in the plugin |
| Menu-bar tray · Chrome-style tabs | One window = one project, switched by your OS |
| Simple / Pro density | One screen that shows only the exceptions |

The measured reasons are in the "removed in 4.0" table of [PROMISE.md](https://github.com/bunhine0452/Ocul-PM/blob/main/docs/PROMISE.md) (Korean).

## Next steps

- What Today unfolds and folds → [Today](/wiki/en/today)
- What the last result is → [Plan](/wiki/en/planner)
- Every shortcut → [Shortcuts](/wiki/en/shortcuts)
