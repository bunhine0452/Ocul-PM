---
title: Claude Code
desc: In-app Claude Code vs terminal Claude Code, installing the plugin (hook bridge), and why /plugin and /mcp don't work in-app.
order: 8
updated: 2026-08-21
---

There are **two** ways to use Claude Code with Ocul-PM. Understand the split and everything else follows.

| | In-app Claude Code (sidebar) | Terminal Claude Code |
|---|---|---|
| How it runs | ACP (Agent Client Protocol) | The CLI as-is |
| Journaling | **Automatic** — built-in MCP tools attached to the session | AGENTS.md rules (automatic once the plugin is installed) |
| `/plugin` `/mcp` `/login` | **Not available** (see below) | Available |
| Login | Reuses credentials from a one-time terminal login | Run `claude` and log in |

## In-app Claude Code — records with no setup

The **Claude Code** screen in the sidebar runs the real `claude` inside the app. Two things are handled for you:

- **ocul-pm's recording tools (MCP)** are attached to every session — the agent can call `journal_write` and update the planner
- the project's **AGENTS.md rules** tell it to record when work is done

So **as long as you work in the app, there's nothing to install.** You just wait out the few minutes on first launch while the adapter is installed (npm, pinned version).

:::warn
The app has no login screen. On a machine that has never logged into Claude Code, run `claude` in a terminal first and log in — the app reuses those credentials. (You can open one right from the terminal button in the toolbar.)
:::

## Why don't `/plugin` and `/mcp` work in-app?

In-app Claude Code talks over a protocol called ACP. That protocol carries **agent work** — prompts, tool calls, approvals — but it cannot carry **interactive commands the CLI draws on its own screen (TUI)** like `/plugin`, `/mcp`, `/login`, `/remote-control`. Their UI exists only in a terminal.

So the app provides an **escape hatch**: the terminal button at the top right of the Claude Code screen opens a real `claude` in the same project. Run CLI-only commands there. (Type `/remote-control` and the app forwards you to the terminal automatically.)

## Terminal Claude Code — install the plugin

If you mostly use Claude Code in a terminal, the situation is different. AGENTS.md rules alone will produce entries, but only **as far as the model follows them** — it can forget at the end of a long session. Installing the **oculpm plugin** attaches a hook bridge so recording becomes **structural** rather than a matter of rules.

Two lines inside `claude` in your terminal:

```
/plugin marketplace add bunhine0452/Ocul-PM
/plugin install oculpm@oculpm
```

:::tip
These are also in the app under **Settings → ocul-pm → Integration** with copy buttons. The MCP snippet for Claude Desktop is copied from the same place.
:::

Once installed you get:

- **Hook bridge** — official hooks wired so a record is left when a session ends
- **5 MCP tools** — `journal_write` · `plan_status` · `plan_update` · `plan_create` · `project_init`
- **5 skills** — workflow skills like `/oculpm:standup` and `/oculpm:next`

Everything is configured globally under `~/.claude`, so it works **in every project**. You can even use the plugin before the app — records pile up as `.oculpm/` markdown, and the app reads them whenever you install it. More on the [plugin page](/plugin).

## Summary — what do I need to install?

- **In-app only** → nothing. Just confirm you're logged in.
- **Terminal too** → the two lines above. Skip it and terminal sessions may go unrecorded.
- **Claude Desktop as well** → copy the MCP snippet from Settings → ocul-pm → Integration.
