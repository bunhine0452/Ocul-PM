---
title: Windows, Tabs, Terminal, Code
desc: Running several projects at once, the terminal dock and splits, the in-app code viewer and editor.
order: 12
updated: 2026-08-21
---

*What* the screens show is in the [Screen Tour](/wiki/en/screens). This page is about **how you arrange and drive them**.

## Tabs and windows

One tab per project. Same feel as a browser.

| Key | Action |
|---|---|
| `⌘T` | New project tab |
| `⌘W` | Close tab |
| `⇧⌘N` | New window |
| `⌘P` | Switch project (sidebar popover) |

- **Each tab has its own state** — read entries in project A and keep a terminal open in B without interference
- **Tabs you haven't visited load lazily** — opening a window doesn't initialize N projects at once
- **A dot appears when an agent is working in a background tab**, so it's visible while you're in another project

:::tip
Multiple windows let you put projects side by side on a monitor. Windows are independent too, so heavy indexing in one doesn't affect the other.
:::

## Living in the menu bar

Turn these on in Settings → Appearance → Menu bar.

- **Show menu bar icon** — a status icon in the top bar that animates while an agent session is alive. Click it for a Today popover
- **Closing the window minimizes to the menu bar** — the app survives so session detection and recording continue. Quit via right-click on the tray icon → Quit
- **Hide Dock icon while resident** — disappears from the Dock while minimized
- **New entry notifications** — a macOS notification when an agent leaves an entry. Capped at 3 per 10 seconds when they arrive in bursts (backfills, say)

:::note
The app has to be alive to keep observing. "Minimize to the menu bar" is the compromise that gets the window out of the way while observation continues.
:::

## Terminal

A **real shell** rooted in the project folder. Two shapes:

- **Full screen** — `⌘0`
- **Dock** — `⌘J`, overlaid on any screen. Good for typing commands while reading an entry

The dock cycles position **bottom → left → right** (the reposition button), and the **detach button** turns it into a separate window containing only the terminal — with the shell intact.

### Sessions and splits

These apply when focus is inside the terminal:

| Key | Action |
|---|---|
| `⌘T` | New session (tab) |
| `⌘W` | Close pane |
| `⌘D` | Split horizontally · `⇧⌘D` split vertically |
| `⌘F` | Search scrollback (`Enter` next · `⇧Enter` previous · `Esc` close) |
| `⌘L` | Clear screen |
| `⌘+` / `⌘−` | Font size · `⇧⌘0` to reset |

Session tabs are **renamed by double-clicking**.

:::warn
`⌘T` and `⌘W` exist both globally (project tabs) and in the terminal (sessions and panes). The terminal only wins **when focus is inside it** — even with the dock overlaid on another screen, `⌘F` won't open terminal search while you're reading an entry.
:::

:::note
`⌘L` clears the screen because the global command palette claims `⌘K` first. The shell's own `Ctrl+L` still works as normal.
:::

### Terminal font size is separate

It's set in px, **independently** of the app-wide scale (Settings → Appearance → Text size), because a terminal is a fixed-width grid where px is more precise than a percentage. The value applies to the terminal screen, the dock, and detached windows alike.

## Code screen

Where you **view and edit** files inside the app. Open a file from the tree on the left, edit on the right, save.

- **Jump in** — "Open in Code" from code search or code map results brings you straight here
- **Filter** — narrow the tree by filename from the input above it
- **Unsaved marker** — edited files are marked **Modified**
- **Open in external editor** — hand serious editing to your usual editor

The limits are explicit:

| Situation | Behavior |
|---|---|
| Over 2MB | Won't open |
| Binary | Says it can't be previewed |
| Too many files | Shows part of the tree |
| Too many unsaved files | Evicts the oldest edit and tells you |
| An open file disappears from disk | Tells you |

### Wiring an external editor

Set the command template in Settings → Appearance → External editor. `%path` is replaced with the absolute path.

```
code "%path"          VS Code
cursor "%path"        Cursor
subl "%path"          Sublime Text
```

:::warn
macOS GUI apps don't inherit your shell's `PATH`. If `code` alone doesn't work, use an absolute path — e.g. `/usr/local/bin/code "%path"`.
:::

## Next steps

- Themes, text size, API keys, indexing → [Settings](/wiki/en/settings)
- The full key list → [Shortcuts](/wiki/en/shortcuts)
