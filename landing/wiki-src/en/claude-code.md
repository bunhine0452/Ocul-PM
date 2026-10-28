---
title: Claude Code
desc: Where Claude Code in your terminal meets Ocul-PM — the rules file, the plugin (hook bridge · MCP tools), and the app's screens.
order: 9
updated: 2026-10-28
---

With Ocul-PM, Claude Code runs **in your own terminal**. The screen that ran Claude Code inside the app (ACP) was removed on 2026-10-28 — the app's place is to turn what `claude` does in your terminal into **a record, evidence and a plan**.

| Where | What it does | Install |
|---|---|---|
| **Rules file** `AGENTS.md` | Tells the agent to write a journal entry after every unit of work, and to state a done condition and a check command before code | Planted when you add a project |
| **Plugin** `oculpm` | Hook bridge (session start/stop) · MCP journaling tools · skills — recording becomes **structure**, not a rule | Two lines below |
| **The app** | Entries appear on screen within seconds, with their diff; the next session picks up where you left off | Just read |

## Install the plugin

AGENTS.md rules alone will produce entries, but only **as far as the model follows them** — it can forget at the end of a long session. With the plugin installed, a hook judges each session as it ends, and if code changed without an entry it blocks the turn once and asks for one.

Two lines inside `claude` in your terminal:

```
/plugin marketplace add bunhine0452/Ocul-PM
/plugin install oculpm@oculpm
```

:::tip
The same two lines sit under **Settings → ocul-pm → Integrations** in the app, with a copy button. The MCP snippet for Claude Desktop is there too.
:::

Once installed:

- **Hook bridge** — at session start it ships the active plan's open items, done condition and check command plus the last three entries into the starting context; at the end it judges whether the session recorded.
- **7 MCP tools** — `journal_search` · `journal_read` · `journal_write` · `plan_status` · `plan_update` · `plan_create` · `project_init`
- **Skills** — `/oculpm:next` (one loop on the next open item) · `/oculpm:redteam` (run the claims, report only counterexamples) · `/oculpm:inception` (seed a new design)

Everything is configured globally under `~/.claude`, so it works **in every project**. You can start with the plugin alone — records accumulate as `.oculpm/` markdown, and the app reads them whenever you install it. Details on the [plugin page](/plugin).

## What the app hands to your terminal

- **Planner ▶Run** — copies the item's prompt (with the done condition and check command) to the **clipboard**. Paste it into `claude` and press Enter.
- **Today → "Resume with this context"** — copies the resume prompt built from the remaining plan and the last entries.

You are always the one who sends — the app has no way to type into your terminal.

## Summary — what do I install?

- **Claude Code in a terminal** → the two lines above. Skip them and sessions may go unrecorded.
- **Claude Desktop too** → copy the MCP snippet from Settings → ocul-pm → Integrations.
- **Codex · Cursor · Gemini CLI** → [Other agents](/wiki/en/agents).
