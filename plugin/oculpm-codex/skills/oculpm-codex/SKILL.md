---
name: oculpm-codex
description: Use ocul-pm journals and planners from Codex without relying on Claude-only plugin variables.
---

# ocul-pm for Codex

Use this skill in a project that has `.oculpm/`.

- Prefer the `oculpm` MCP tools when they are available.
- If no MCP tools are available, follow the repository's `AGENTS.md` journal and planner rules directly.
- Register the MCP server through ocul-pm Settings → Integration → Codex MCP server. That writes only Codex's `config.toml` entry for the current project; it does not modify Claude settings.
- Do not use Claude-specific variables such as `CLAUDE_PLUGIN_ROOT` or `CLAUDE_PROJECT_DIR` in Codex configuration.
- When Claude Code is also installed, leave its plugin, hooks, and `.mcp.json` registration independent. Both agents may use the same `.oculpm/` journal and planner files.
