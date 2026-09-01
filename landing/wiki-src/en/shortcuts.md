---
title: Shortcuts
desc: Navigation, tabs and windows, the terminal dock, and Claude Code screen keys.
order: 16
updated: 2026-08-21
---

`⌘` numbers come from the sidebar order automatically — what each screen does is in the [Screen Tour](/wiki/en/screens).

## Anywhere

| Key | Action |
|---|---|
| `⌘K` | Command palette — navigate, plus search entry, plan, discussion, and doc titles |
| `⌘1`–`⌘9`, `⌘0` | Jump to a screen, in sidebar order (`⌘1` Today … `⌘9` Docs, `⌘0` Terminal) |
| `⌘P` | Switch project |
| `⌘J` | Toggle the terminal dock — from any screen |
| `⌘\` | Agent panel |
| `⌘,` | Settings |

## Tabs and windows

| Key | Action |
|---|---|
| `⌘T` | New project tab |
| `⌘W` | Close tab (on the Claude Code screen, session tabs first) |
| `⇧⌘N` | New window |

## Claude Code screen

| Key | Action |
|---|---|
| `⏎` | Send · `⇧⏎` newline |
| `Esc` | Interrupt the running turn |
| `⇧Tab` | Cycle permission mode (manual → auto-accept edits → plan → auto) |
| `↑` / `↓` | Recall previous prompts (in an empty input) |
| `@` | File mention autocomplete · `/` slash commands |
| `←` / `→` | Move between session tabs (when a tab has focus) |

## Terminal

These only fire **when focus is inside the terminal** — with the dock overlaid on another screen, `⌘F` won't open scrollback search while you're reading an entry.

| Key | Action |
|---|---|
| `⌘T` | New session (tab) |
| `⌘W` | Close pane |
| `⌘D` / `⇧⌘D` | Split horizontally / vertically |
| `⌘F` | Search scrollback — `Enter` next · `⇧Enter` previous · `Esc` close |
| `⌘L` | Clear screen (`⌘K` is taken by the palette) |
| `⌘+` / `⌘−` | Font size · `⇧⌘0` to reset |
| Double-click | Rename a session tab |
| Reposition button | Cycle dock position — bottom → left → right |
| Detach button | Move to a separate terminal-only window (shell preserved) |

:::note
`⌘T` and `⌘W` exist both globally (project tabs) and in the terminal (sessions and panes). Which one fires depends on where focus is.
:::
