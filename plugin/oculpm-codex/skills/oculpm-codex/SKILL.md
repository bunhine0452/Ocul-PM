---
name: oculpm-codex
description: Use ocul-pm journals and planners from Codex without relying on Claude-only plugin variables.
---

# ocul-pm for Codex

Use this skill in a project that has `.oculpm/`.

- Prefer the `oculpm` MCP tools when they are available.
- If no MCP tools are available, follow the repository's `AGENTS.md` journal and planner rules directly.
- Register the MCP server through ocul-pm Settings → Integration → Codex MCP server. It writes one entry in Codex's `config.toml` and never touches Claude settings. The entry carries no `--root`: `~/.codex/config.toml` is machine-wide, so the project is decided by the folder the session opened in. Never add `--root` there by hand — a pinned root sends journals from every other project to that one path.
- Do not use Claude-specific variables such as `CLAUDE_PLUGIN_ROOT` or `CLAUDE_PROJECT_DIR` in Codex configuration.
- When Claude Code is also installed, leave its plugin, hooks, and `.mcp.json` registration independent. Both agents may use the same `.oculpm/` journal and planner files.
- This plugin ships hooks in `hooks/hooks.json`, not as a manifest field: Codex rejects a `hooks` field in a marketplace plugin manifest but reads that file by convention. Session markers, the journal delivery gate, and the plan-context injection all come from it, and the scripts resolve the project from the hook payload's `cwd` rather than `CLAUDE_PROJECT_DIR`.
- Codex asks once whether to trust a plugin's hooks. Decline it and the plugin still works as skills, but session markers and the delivery gate stay silent — nothing else reports that, so answer the prompt deliberately.
