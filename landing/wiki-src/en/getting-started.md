---
title: Getting Started
desc: From installing Ocul-PM to your first work journal entry — about five minutes of setup.
order: 1
updated: 2026-08-21
---

## Install

1. Grab the `.dmg` from [GitHub Releases](https://github.com/bunhine0452/Ocul-PM/releases/latest) and drop it in Applications. macOS (Apple Silicon) only.
2. If macOS shows a confirmation dialog on first launch, click **Open**.
3. After that the app updates itself (Settings → Updates also has a manual check).

There's no account to create — open the app and you're at the start screen.

## Add a project and start tracking

On the start screen, **Open an existing folder** and pick a folder with code in it. Tracking starts immediately, and two things appear inside the project:

- `.oculpm/` — where journal entries, plans, and discussions accumulate (all markdown)
- `AGENTS.md` — the journaling rules that tell agents "write an entry when you finish a unit of work"

:::note
`AGENTS.md` is a file most agents read natively — Claude Code, Codex CLI, Gemini CLI, and others. When an agent works in a project that has one, it starts leaving entries with no further setup.
:::

## See your first entry

Give an agent any task — in the app's Claude Code screen or in your terminal. When it finishes:

- a new entry shows up in **Work Journal** (`⌘2`)
- it lands in the flow on **Today** (`⌘1`)
- and you can read the change line by line in **Changes** (`⌘5`)

Nothing showing up? Start with the first item in [Troubleshooting](/wiki/en/troubleshooting).

## Next steps

- Mostly use Claude Code in a terminal? → install the plugin (hook bridge) from [Claude Code](/wiki/en/claude-code). Journaling goes from "whatever the model remembers to do" to automatic.
- Curious where and how data is stored? → [Data & File Layout](/wiki/en/data)
- Want the lay of the land first? → [Screen Tour](/wiki/en/screens)
