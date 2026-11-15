---
title: Shortcuts
desc: Screens, windows, and the keys on Today, Work Journal and Terminal.
order: 16
updated: 2026-11-15
---

`⌘` numbers come from the top-bar tab order automatically — what each screen does is in the [Screens tour](/wiki/en/screens). On Windows · Linux, `Ctrl` replaces `⌘`. Press `⌘/` in the app for the full table — the keys inside the Plan and Diff screens are there too.

## Anywhere

| Key | Action |
|---|---|
| `⌘K` | Command palette — finds terminal sessions (waiting first) · screens · actions (all shortcuts · open folder · open in your editor · project color …) · projects · plans · entries and opens them. Korean initial consonants work too (`ㅇㅈ` → Work Journal) |
| `⌘J` | Jump to the waiting session — the one that has waited longest first, again for the next. If none is in this window, it brings forward another project window that has one (`Ctrl+Shift+J` inside the terminal on Windows · Linux) |
| `⌘1` – `⌘5` | Jump to a screen — `⌘1` Today · `⌘2` Work Journal · `⌘3` Plan · `⌘4` Diff · `⌘5` Terminal |
| `⌘,` | Settings |
| `⌘[` / `⌘]` | Back / forward between screens — like a browser |
| `⌘/` | Shortcut cheatsheet |
| `⌃Tab` / `⌃⇧Tab` | Next / previous screen (cycles) |
| Two-finger swipe | Back / forward between screens (trackpad) |

## Windows

One window is one project — there are no tabs.

| Key | Action |
|---|---|
| `⌘O` | Recent projects — type to filter; if it is already open, its window comes forward |
| `⇧⌘N` | New window (start window) |
| `⌘W` | Close window — in the terminal with several sessions, the selected session first. On macOS the app stays alive after the last window; a Dock click reopens |
| `⌥Tab` | Recent window — tap for the previous one, hold for the list in most-recent order (Ctrl+backtick on Windows · Linux) |
| `⌥⌘1` – `⌥⌘9` | Project windows in most-recent order — without opening a list. The current window has no number (`Alt+1` – `Alt+9` on Windows · Linux) |

## Today · Work Journal

These keys listen only inside that screen.

| Key | Action |
|---|---|
| `j` / `k` | Next / previous item |
| `Enter` | Today — the row's first button (Check again · Open plan · View changes …; a question opens its answer box) · Work Journal — open the detail |
| `v` | Mark read — on Today the unverified entry row, on Work Journal the selected entry (again to unmark) |
| `r` | Today — run the next item in the terminal |
| `/` · `⌘F` | Work Journal — journal search |

## Terminal

| Key | Action |
|---|---|
| `⌘T` | New session |
| `⌘D` / `⇧⌘D` | Split the selected pane right / down — as often as you like |
| `⌥⌘` + arrows | Move between panes |
| `⇧⌘↩` | Expand the selected pane · restore |
| `⌘F` | Find in output |
| `⌘L` | Send the selected output to Claude |
| `⇧↩` | New line in Claude · Codex input — plain `Enter` in a shell or vim |
| `⇧⌘[` / `⇧⌘]` | Previous · next session |
| `⌘=` / `⌘-` / `⌘0` | Larger · smaller · default text |
| `⌘W` | Close session (when there are several) |

On Windows · Linux the shell owns `Ctrl+letter`, so terminal keys add one more `Shift` — `⌘T` is `Ctrl+Shift+T`, `⌘D` is `Ctrl+Shift+D`, `⇧⌘D` is `Ctrl+Alt+Shift+D`. Moving between panes is `Ctrl+Alt+arrows`, switching sessions `Ctrl+PageUp` / `PageDown`, text size `Ctrl+=` · `Ctrl+-` · `Ctrl+0`, and copy · paste `Ctrl+Shift+C` / `V`.

:::note
The in-app terminal was removed on 2026-10-28 and came back, smaller, on 10-29 — sessions live inside the app and end when the window closes. `r` on Today and the Plan screen's [Run in terminal] · [To the end (/goal)] open `claude` in a new session. The editor and agent chat screens did not come back.
:::
