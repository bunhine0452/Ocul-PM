---
title: Windows, Tabs, External Editor
desc: Running several projects at once, living in the menu bar, and opening files in your own editor.
order: 12
updated: 2026-10-28
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

- **Each tab has its own state** — read entries in project A and keep the planner open in B without interference
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

## Opening files — your own editor

The in-app editor and terminal were removed on 2026-10-28. "Open file" on search results and on the Branch screen hands the file to the editor you already use.

### Wiring an external editor

Set the command template in Settings → Appearance → External editor. `%path` is replaced with the absolute path and `%line` with the line number.

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
