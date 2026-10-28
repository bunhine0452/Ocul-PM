---
title: Settings
desc: Settings on one page — agent connections · this project · display · data.
order: 13
updated: 2026-10-29
---

Open it with `⌘,`. In 4.0 Settings is **one page** — the twelve 3.x tabs (LLM · indexing · automation · diagnostics …) went with their features.

| Section | What |
|---|---|
| **Agent connections** | Whether the Claude Code plugin and Codex are installed, and whether the installed version is older than the app. Copy the install or update command. Cursor · Gemini CLI record through the rules file (`AGENTS.md`) alone, so there is nothing to connect |
| **This project** | The rules-file version ("Update" when a newer one ships with the app), "Turn on recording" when it is off, and the project folder's location |
| **Display** | Language (한국어 · English), appearance (system · light · dark), text size |
| **Data** | Cache size and "Compact", "Rebuild from scratch" (rebuilds this project's cache from the entry files), app version · check for updates, log folder |

## There is no AI inside the app

The 4.0 app calls no LLM — there are no API key, model or fallback settings. Ask the agent in your terminal for summaries or reports; it reads past entries through the MCP tools (`journal_search` · `journal_read`). API-key entries 3.x left in the keychain are neither read nor deleted by the app.

## Updates

The app checks on its own. "Check for updates" in Data checks by hand, and when a new version exists, "Install … and restart" does the rest. If you installed the Linux deb, grab the next `.deb` from the releases page instead of updating in-app. When the latest release has no build for your OS, it says so — that is not an error.

## Next steps

- Rules files and adapters → [Other agents](/wiki/en/agents)
- Where data is stored → [Data & file layout](/wiki/en/data)
