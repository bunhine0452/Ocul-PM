---
title: Other agents
desc: Codex, Cursor, Gemini CLI, Copilot, Windsurf, Cline, Zed, aider, Antigravity — how one AGENTS.md drives them, the rules-file list, and support tiers.
order: 10
updated: 2026-10-29
---

Ocul-PM isn't Claude Code–only. **Any agent that reads `AGENTS.md`** can write entries, and for agents that don't read it, a thin delegating stub goes into their own rules file.

## Why AGENTS.md is the center

Turning recording on creates `AGENTS.md` at the root. It holds **the whole body** of the recording rules — when to record, where and under what name, what the frontmatter needs, and the working discipline (template v20: done conditions as outcomes · the verdict comes from something that isn't you · raw material and an expert's tools · hard numeric goals are normal · record failures too).

Claude Code, Codex, Gemini CLI and many more read this file **natively**, so the rules reach them with no extra install.

:::note
Originally the rules only lived in `.oculpm/agents/_template.md`, and dogfooding showed outside LLMs never read that file on their own. So the root `AGENTS.md` became the primary surface, and the other adapters shrank to stubs pointing at `@AGENTS.md`.
:::

## Supported rules files

`AGENTS.md` is always planted when you turn recording on. The others are switched on through the `[agents] active` list in the project's `.oculpm/config.toml` (e.g. `["agents-md", "cursor"]`) — the file appears at its path and is refreshed whenever the rules change. The 4.0 Settings page has no per-adapter switches.

| Agent | Rules file |
|---|---|
| Shared (Claude Code · Codex CLI etc.) | `AGENTS.md` |
| Claude Code | `.claude/CLAUDE.md` |
| Cursor | `.cursor/rules/ocul-pm.mdc` |
| Gemini CLI | `GEMINI.md` |
| GitHub Copilot | `.github/copilot-instructions.md` |
| Windsurf | `.windsurf/rules/ocul-pm.md` |
| Cline | `.clinerules/ocul-pm.md` |
| Zed | `.rules` |
| aider | `CONVENTIONS.md` |
| Antigravity | `.agent/rules/ocul-pm.md` |

## What you wrote is kept

Some rules files are **files you write in too** — `AGENTS.md`, `.claude/CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, `CONVENTIONS.md`, `.rules`.

In those, the app **owns only the block between markers**:

```
<!-- oculpm:begin v1 -->
… rules the app manages …
<!-- oculpm:end -->
```

Whatever you write **outside** the block survives every rules update. Your coding conventions and the app's recording rules can live in one file.

:::warn
By contrast `.cursor/rules/ocul-pm.mdc` · `.windsurf/rules/ocul-pm.md` · `.clinerules/ocul-pm.md` · `.agent/rules/ocul-pm.md` are app-only files and are **overwritten whole.** Don't put personal rules there.
:::

## Editing the master rules

To change the wording itself, edit `.oculpm/agents/_template.md`. It's the master; save it and every adapter you've switched on picks it up — change one place and Cursor and Claude Code both get the new rules.

To give one agent different wording, put a file for it under `.oculpm/agents/per-agent/`. The template's language is set by `[agents] template_language` (`ko` · `en`) in `config.toml`.

## When the rules are out of date

An app update can raise the rules spec (template version). When Settings → **This project** shows something like "v19 — new v20" on the rules-file row, press **"Update"**.

## Support tiers

"Writes entries" comes in different strengths. The tiers are read from code — the rules-file adapter table, the MCP registrars, the hooks. (The in-app tier 4 went with its screens on 2026-10-28; one-click MCP registration for Claude Desktop went in 4.0.)

| Tier | Meaning |
|---|---|
| **1 · Rules-compatible** | The app only writes the rules file that agent reads. Entries get written as far as the model obeys it |
| **2 · Structured journaling** | The agent can call the `oculpm` MCP server's tools (`journal_write` · `plan_update` …). The plugin registers the server (Claude Code) or walks you through it (Codex) |
| **3 · Session observation** | Session start/stop arrive through hooks, and conversations that ended without an entry are flagged (the Stop delivery gate · `sessions.json`) |

| Agent | Tier | What it does | Verified |
|---|---|---|---|
| Claude Code | **3 Session observation** | the oculpm plugin (hooks · MCP tools · commands) · `AGENTS.md` + `.claude/CLAUDE.md` block | v3.0.0 · 2026-09-11 |
| Codex | **3 Session observation** | the Codex plugin (hooks · guidance for the `~/.codex/config.toml` MCP registration) · `AGENTS.md` (native) | v2.37.0 · 2026-09-03 |
| Gemini CLI | 1 Rules-compatible | `AGENTS.md` + `GEMINI.md` block | — |
| Cursor | 1 Rules-compatible | `.cursor/rules/ocul-pm.mdc` | — |
| GitHub Copilot | 1 Rules-compatible | `.github/copilot-instructions.md` block | — (shipped v2.0.0) |
| Windsurf | 1 Rules-compatible | `.windsurf/rules/ocul-pm.md` | — (shipped v2.0.0) |
| Cline | 1 Rules-compatible | `.clinerules/ocul-pm.md` | — (shipped v2.0.0) |
| aider | 1 Rules-compatible | `CONVENTIONS.md` block | — (shipped v2.0.0) |
| Zed | 1 Rules-compatible | `.rules` block | — (shipped v2.0.0) |
| Antigravity | 1 Rules-compatible | `.agent/rules/ocul-pm.md` | — (shipped v1.11.0) |
| pi | 1 Rules-compatible | `AGENTS.md` only | — (shipped v1.11.0) |

**Verified** is the latest evidence in the repository's `CHANGELOG.md` and work journal that the tier **actually ran** (app version · date). `—` means the code exists but there's no on-device record; "shipped" in parentheses is the version the CHANGELOG lists.

:::note
The evidence in the table comes from the macOS build. Windows · Linux are a beta — on Windows the Claude Code plugin's hooks run but its MCP server doesn't start, so the agent writes the files directly by the recording spec.
:::

On tier 1, glance at **[unrecorded changes](/wiki/en/journal)** on Today now and then. Anything missed shows up there.

:::tip
On Claude Code, installing the plugin makes the biggest difference — two lines in [Claude Code](/wiki/en/claude-code).
:::

## Mixing several agents

No problem. Each entry's frontmatter records `agent.id` and the model name, so you can tell later who did what.

## Skills live in the plugin

The 3.x Skills & Rules screen (skill editing · recommended-skill installs · firing badges · rules hub) was removed in 4.0 — it had become a Claude Code settings manager, and the plugin now carries the skills. Skills and rules you already have in `.claude/skills/` · `.claude/rules/` are still read by Claude Code, and the app doesn't touch them. The plugin's commands and tools are in [Claude Code](/wiki/en/claude-code).

## Next steps

- On Claude Code → [Claude Code](/wiki/en/claude-code)
- Checking that the rules are working → unrecorded changes, in [Work Journal](/wiki/en/journal)
