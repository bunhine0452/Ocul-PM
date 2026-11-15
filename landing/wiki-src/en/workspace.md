---
title: Windows · projects · external editor
desc: One window = one project — moving between projects and the external editor files open in.
order: 12
updated: 2026-11-15
---

*What* each screen shows is in the [Screens tour](/wiki/en/screens). This page is about **how you lay them out and run them**.

## One window = one project

Since 4.0 one window holds one project. The 3.x Chrome-style tabs, tear-off and menu-bar tray are gone; your OS switches between project windows (⌘` · Mission Control).

| Key | Action |
|---|---|
| `⌘O` | Recent projects — type to filter; picking one opens its window, or brings it forward if it is already open |
| `⇧⌘N` | New window — a **start window** with no project |
| `⌘W` | Close window — in the terminal with several sessions, the selected session first |
| `⌥Tab` | Recent window — tap for the previous one, hold for the list in most-recent order (Ctrl+backtick on Windows · Linux) |
| `⌥⌘1` – `⌥⌘9` | Straight to a project window in most-recent order — the current window has no number (`Alt+1` – `Alt+9` on Windows · Linux) |

- Pick a project in the start window and **that window becomes the project**
- The window title is the project name, so the window switcher tells them apart
- Click the project name (▾) in the top bar and each project shows its most urgent state as one chip — "N waiting" · "Check failed" · "New" (Claude finished or stopped since you last looked at that window) · "N running" · "Open" (open in another window). Waiting projects come first, then those whose check command failed, so you know how Claude is doing in a background window without opening it. The current project's row says "This window"; the others carry their `⌥⌘` number at the end
- Each project remembers its own screen and filters
- **On macOS the app stays alive after the last window closes**, and a Dock click opens one again. Windows · Linux quit when the last window closes
- An update restart brings each window back with the project it had open

:::note
Watching (entries · changes) continues as long as the app is alive. On macOS the app stays alive with every window closed, so watching carries on.
:::

## Opening files — the external editor

The in-app editor was removed on 2026-10-28 (the terminal came back, smaller, on 10-29). Opening a file from Diff, the terminal or a journal entry hands it to the editor chosen under **Open files in** in Settings → App — Auto (finds what's installed: VS Code, then Cursor, else the default app) · VS Code · Cursor · Default app · Custom. VS Code · Cursor open the file at the line regardless of your shell's `PATH`. Custom is a shell command template: `%path` becomes the absolute path and `%line` the line number.

```
code -g "%path:%line"   VS Code as a shell command
subl "%path"            Sublime Text
```

:::warn
macOS GUI apps don't inherit your shell's `PATH`. If a custom command doesn't open, it needs an absolute path — e.g. `/usr/local/bin/subl "%path"`.
:::

## Next steps

- Appearance and app settings → [Settings](/wiki/en/settings)
- Every shortcut → [Shortcuts](/wiki/en/shortcuts)
