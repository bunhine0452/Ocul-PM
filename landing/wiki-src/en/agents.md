---
title: Other Agents
desc: Cursor, Gemini CLI, Copilot, Windsurf, Cline, Zed, aider, Antigravity — how one AGENTS.md drives them all, plus the Skills & Rules hub.
order: 10
updated: 2026-09-15
---

Ocul-PM isn't Claude Code only. **Any agent that reads `AGENTS.md`** can leave entries, and for agents that don't, a thin delegating stub is placed in their own rules file.

## Why AGENTS.md is the center

Adding a project creates `AGENTS.md` at the root. The **entire body** of the journaling rules lives there — when to record, where files go and what they're named, what the frontmatter needs.

Claude Code, Codex CLI, Gemini CLI and many others read this file **natively**. That's how the rules arrive with no extra install.

:::note
Originally the rules only lived in `.oculpm/agents/_template.md`, and dogfooding showed external LLMs don't go read that file on their own. So the root `AGENTS.md` became the primary surface, and other adapters were reduced to stubs pointing at `@AGENTS.md`.
:::

## Supported rules files

Toggle these in Settings → ocul-pm → Agents. Turning one on creates the file at that path and keeps it updated as rules change.

| Agent | Rules file |
|---|---|
| Shared (Claude Code, Codex CLI, …) | `AGENTS.md` |
| Claude Code | `.claude/CLAUDE.md` |
| Cursor | `.cursor/rules/ocul-pm.mdc` |
| Gemini CLI | `GEMINI.md` |
| GitHub Copilot | `.github/copilot-instructions.md` |
| Windsurf | `.windsurf/rules/ocul-pm.md` |
| Cline | `.clinerules/ocul-pm.md` |
| Zed | `.rules` |
| aider | `CONVENTIONS.md` |
| Antigravity | `.agent/rules/ocul-pm.md` |

## Your own content is preserved

Some of these are files **you write in too** — `AGENTS.md`, `.claude/CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, `CONVENTIONS.md`, `.rules`.

In those, the app **owns only the marked block**:

```
<!-- oculpm:begin v1 -->
… app-managed rules …
<!-- oculpm:end -->
```

Anything **outside** the block survives a rules refresh. Your coding conventions and the app's journaling rules can share one file.

:::warn
By contrast `.cursor/rules/ocul-pm.mdc`, `.windsurf/rules/ocul-pm.md`, `.clinerules/ocul-pm.md`, and `.agent/rules/ocul-pm.md` are app-owned files and are **overwritten wholesale**. Don't put personal rules at those paths.
:::

## Editing the rules themselves

To change the wording, edit `.oculpm/agents/_template.md`. That's the master; saving propagates to every adapter you've enabled — fix it once and Cursor and Claude Code both get the new rules.

To give one agent different wording, put a file for it under `.oculpm/agents/per-agent/`.

## When the rules go stale

App updates can raise the rules spec. **Resend rules** in Settings → ocul-pm → Agents reinstalls the current spec. The detect button narrows the list to agents that appear to be in use in this project.

## Support tiers

"Leaves entries" comes in different strengths. The tiers are read from code — the rules-file adapter table, the MCP registrars, the hooks, the ACP adapters.

| Tier | What it means |
|---|---|
| **1 · Rules-compatible** | The app only writes the rules file that agent reads. Journals get written as far as the model obeys it |
| **2 · Structured journaling** | The agent can call the `oculpm` MCP server's tools (`journal_write` · `plan_update` …) and the app registers that server for it |
| **3 · Session observation** | The app receives session start/stop through hooks and flags conversations that ended without a journal (the Stop delivery gate · `sessions.json`) |
| **4 · In-app** | The agent runs inside the app (Agent Client Protocol) — tool approvals and output arrive as conversation cards and the journaling tools are attached to the session directly |

| Agent | Tier | What the app does | Verified |
|---|---|---|---|
| Claude Code | **4 In-app** | Runs in-app · hooks (plugin or `.claude/settings.local.json`) · `.mcp.json` MCP registration · `AGENTS.md` + `.claude/CLAUDE.md` block | v3.0.0 · 2026-09-11 |
| Codex | **4 In-app** | Runs in-app · Codex plugin hooks · `~/.codex/config.toml` MCP registration · `AGENTS.md` (native) | v2.37.0 · 2026-09-03 |
| Claude Desktop | **2 Structured journaling** | MCP server registered in `claude_desktop_config.json` — no hooks, no rules file | — (shipped v2.2.0 · no live-connection record) |
| Gemini CLI | 1 Rules-compatible | `AGENTS.md` + `GEMINI.md` block | — |
| Cursor | 1 Rules-compatible | `.cursor/rules/ocul-pm.mdc` | — |
| GitHub Copilot | 1 Rules-compatible | `.github/copilot-instructions.md` block | — (shipped v2.0.0) |
| Windsurf | 1 Rules-compatible | `.windsurf/rules/ocul-pm.md` | — (shipped v2.0.0) |
| Cline | 1 Rules-compatible | `.clinerules/ocul-pm.md` | — (shipped v2.0.0) |
| aider | 1 Rules-compatible | `CONVENTIONS.md` block | — (shipped v2.0.0) |
| Zed | 1 Rules-compatible | `.rules` block | — (shipped v2.0.0) |
| Antigravity | 1 Rules-compatible | `.agent/rules/ocul-pm.md` | — (shipped v1.11.0) |
| pi | 1 Rules-compatible | `AGENTS.md` only | — (shipped v1.11.0) |

**Verified** is the latest evidence in the repository's `CHANGELOG.md` and work journals that the tier **actually ran** (app version · date). `—` means the code exists but there is no on-device record; "shipped" in parentheses is the version the CHANGELOG lists the feature under.

:::note
A CLI started in the built-in terminal (`claude` · `codex` · `gemini` · `cursor-agent` · `aider` …) is caught by shell integration for **start and stop only**. There is no missing-journal verdict, so that is not tier 3. Not yet seen on a real machine — a live Claude Desktop connection, Codex's tool-approval → file-change flow end to end, and the VS Code extension exposing MCP tools to Copilot agent mode and Cursor — did not raise a tier even though the code exists. Official builds are macOS Apple Silicon only.
:::

On tier 1, check the **[honesty audit](/wiki/en/journal)** on Today now and then. Anything missed shows up there.

:::tip
If you use Claude Code, installing the plugin makes the biggest difference — two lines, in [Claude Code](/wiki/en/claude-code).
:::

## Mixing several agents

No problem. Each entry's frontmatter records `agent.id` and the model name, so you can tell later who did what. The Today screen's **Agent contributions** card shows the distribution.

## Skills & Rules hub

The **Skills & Rules** screen in the sidebar is where you work all of the above from inside the app. It has five tabs.

### Skills

One `SKILL.md` file is one skill. Agents **invoke skills on their own** based on the `description` in the frontmatter — which is why writing a good description matters.

- **Project / Global** — keep it to this project (`.claude/skills/`) or make it available everywhere (`~/.claude/skills/`). You can copy between them
- **Disable** — moves it to `.claude/skills/.disabled/` so it isn't loaded. **The file is not deleted**
- **Edit** — change it in the app and save with `⌘S`
- **New skill** — start from an empty one

### Shop

Install curated skills that build verification habits with one click — things like `self-audit`, which makes agents check their own work.

### Rules

Toggle the per-adapter rules files covered above, and edit the master.

### Hooks

Claude Code hook integration. **With hooks on, session start and end are recorded from real signals instead of heuristics** — rather than the app guessing "files went quiet, must be done," the agent says so.

:::note
The **auto journal draft** at session end (which costs money) and MCP tool registration are managed in Settings → ocul-pm → Integration, not this tab.
:::

### Plugin

Shows what the plugin installs — the list of commands, tools, and skills.

## Next steps

- Using Claude Code → [Claude Code](/wiki/en/claude-code)
- Checking that the rules are working → the honesty audit in [Work Journal](/wiki/en/journal)
