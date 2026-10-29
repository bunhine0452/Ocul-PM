---
title: Getting started
desc: From installing Ocul to your first work-journal entry — five minutes of setup.
order: 1
updated: 2026-10-29
---

## Install

1. Grab the file for your OS from [GitHub Releases](https://github.com/bunhine0452/Ocul-PM/releases/latest) — the macOS (Apple Silicon) `.dmg`, or the Windows x64 · Linux x64 beta.
2. The macOS build is signed with an Apple Developer ID and notarized, so it **opens without warnings**. If the one-time "downloaded from the internet" prompt appears, click Open.
3. Later versions update from inside the app (Settings → Data → "Check for updates" checks by hand).

No account to create — the app opens straight into the **start window**.

## Pick a folder and turn recording on

On first launch a four-page "Getting started" guide appears (what it does · five screens · connecting an agent · getting the feel). Close it and you're in the start window — recent projects and **Open folder**. Pick a folder and turn recording on, and two things appear in the project:

- `.oculpm/` — the folder where entries and plans accumulate (all markdown)
- `AGENTS.md` — the recording rules that tell your agent "write an entry when you finish · the verdict comes from something that isn't you"

Pick a project in the start window and **that window becomes the project** (one window = one project).

:::note
`AGENTS.md` is read natively by most agents — Claude Code, Codex, Gemini CLI and more. In a project that has it, an agent starts writing entries with no extra setup.
:::

## Check the first entry

Ask your agent in the terminal to do anything. Within seconds of it finishing:

- a new entry appears in **Work Journal** (⌘2)
- it shows up under "Done today" on **Today** (⌘1) — and if its verification section has no command evidence, it lands in "Finished without verification"
- **Diff** (⌘4) shows that change line by line

If no entry appears, see the first item in [Troubleshooting](/wiki/en/troubleshooting).

## Next steps

- Mostly terminal Claude Code? → install the plugin from [Claude Code](/wiki/en/claude-code). Recording goes from "if the model remembers" to automatic, and the next conversation inherits the plan and its last verdict.
- Starting a new feature area? → run `/oculpm:inception` in the terminal — it builds a plan whose first item is a check command that is red right now.
- Curious where data lives? → [Data & file layout](/wiki/en/data)
