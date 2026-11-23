---
title: Settings
desc: One status table — "To fix" on top, then agents · this project · appearance · app.
order: 13
updated: 2026-11-15
---

Open it with `⌘,`. In 4.0 Settings is **one page** — the twelve 3.x tabs (LLM · indexing · automation · diagnostics …) went with their features. A **"To fix N"** line on top gathers what needs a hand (a missing or old plugin · a rules file that's behind · a new app version …), and clicking an item goes to its section. When nothing needs fixing, the line isn't there.

| Section | What |
|---|---|
| **Agents** | Whether the Claude Code plugin is installed, whether it is really attached to this project (off · only in other projects · app not found), a "Journals not arriving" diagnosis, one-click recording-tool (MCP) registration for Cursor and Gemini CLI, and whether the installed version is older than the app. Copy the install or update command. The **Claude Code theme** row is the app keeping a file (`~/.claude/themes/ocul.json`) that matches Claude Code's colours to the Ocul terminal; you pick it with `/theme` inside Claude. The Codex row shows only on a machine with Codex, and "Direct MCP registration" is the workaround for running without the plugin or with a plugin older than 4.12 (since 4.12 the plugin's MCP starts on Windows too, so with both on every tool shows up twice). "Check again" in the section header asks again. Cursor · Gemini CLI record through the rules file (`AGENTS.md`) alone, so there is nothing to connect |
| **This project** | The rules-file (`AGENTS.md`) version ("Update" when a newer one ships with the app, "Turn on recording" when recording is off), where the `.oculpm` folder lives, and the cache's "Rebuild from scratch" (rebuilds this project's cache from the journal files in the folder) |
| **Appearance** | Theme (System · Light · Dark), text size, app icon (macOS) |
| **App** | Language (한국어 · English), Keep awake (only while Claude works), Open files in (Auto · VS Code · Cursor · Default app · Custom), Updates (the app version and "Check for updates"), log folder, cache size and "Compact" |

## There is no AI inside the app

The 4.0 app calls no LLM — there are no API key, model or fallback settings. Ask the agent in your terminal for summaries or reports; it reads past entries through the MCP tools (`journal_search` · `journal_read`). API-key entries 3.x left in the keychain are neither read nor deleted by the app.

## Updates

The app checks on its own, and an update notification appears when a new version exists. "Check for updates" on the Updates row under App checks by hand, and when a new version exists, "Install … and restart" does the rest. If you installed the Linux deb, grab the next `.deb` from the releases page instead of updating in-app. When the latest release has no build for your OS, it says so — that is not an error.

## Next steps

- Rules files and adapters → [Other agents](/wiki/en/agents)
- Where data is stored → [Data & file layout](/wiki/en/data)
