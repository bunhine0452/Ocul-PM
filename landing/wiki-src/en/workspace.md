---
title: Windows · projects · external editor
desc: One window = one project — moving between projects and the external editor files open in.
order: 12
updated: 2026-10-29
---

*What* each screen shows is in the [Screens tour](/wiki/en/screens). This page is about **how you lay them out and run them**.

## One window = one project

Since 4.0 one window holds one project. The 3.x Chrome-style tabs, tear-off and menu-bar tray are gone; your OS switches between project windows (⌘` · Mission Control).

| Key | Action |
|---|---|
| `⌘O` | Recent projects — picking one opens its window, or brings it forward if it is already open |
| `⇧⌘N` | New window — a **start window** with no project |
| `⌘W` | Close window |
| `⌥⌘1` – `⌥⌘9` | Straight to an open project window (`Alt+1` – `Alt+9` on Windows · Linux) |

- Pick a project in the start window and **that window becomes the project**
- The window title is the project name, so the window switcher tells them apart
- Click the project name (▾) in the top bar to see "Your turn · New · N running" per project — you know whether Claude finished in a background window without opening it
- Each project remembers its own screen and filters
- **On macOS the app stays alive after the last window closes**, and a Dock click opens one again. Windows · Linux quit when the last window closes
- An update restart brings each window back with the project it had open

:::note
Watching (entries · changes) continues as long as the app is alive. On macOS the app stays alive with every window closed, so watching carries on.
:::

## Opening files — the external editor

The in-app editor and terminal were removed on 2026-10-28. "Open" on Diff and in an entry's detail hands the file to the editor you already use. In the command template `%path` becomes the absolute path and `%line` the line number — the default is VS Code.

```
code "%path"          VS Code (default)
cursor "%path"        Cursor
subl "%path"          Sublime Text
```

:::warn
macOS GUI apps don't inherit your shell's `PATH`. If `code` doesn't open, it needs an absolute path — e.g. `/usr/local/bin/code "%path"`.
:::

## Next steps

- Display and data settings → [Settings](/wiki/en/settings)
- Every shortcut → [Shortcuts](/wiki/en/shortcuts)
