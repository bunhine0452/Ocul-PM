# Ocul-PM for VS Code

Work journals and the planner that [Ocul-PM](https://oculpm.com) keeps in your project's `.oculpm/` directory — shown beside your code in VS Code.

- **Local-first, zero network.** The extension only reads markdown files under `.oculpm/`. Nothing leaves your machine.
- **Writes go through the app.** Toggling planner items or letting an agent write a journal uses the `oculpm-mcp` binary shipped with the Ocul-PM desktop app. Without the app the extension runs read-only.
- **Agents see the tools.** On VS Code ≥ 1.101 the extension registers `oculpm-mcp` as an MCP server so Copilot agent mode can call `journal_write` / `plan_update`.

## What you get

- **Sidebar** — *오늘 일지* (last 7 days, today expanded) and *활성 플랜* (plan → phase → item, glyphs as icons). Click an entry for the markdown preview; the tree refreshes within a second of an agent writing.
- **Checkboxes** — leaf plan items toggle `[ ]`↔`[x]` through `oculpm-mcp` (`plan_status` → `plan_update` with the plan's hash), so plan-log rows, locked plans and concurrent edits are handled by the app's own rules.
- **MCP for agents** — on VS Code ≥ 1.101 the extension registers `oculpm-mcp` per workspace folder; Cursor and other forks without that API get a command that merges our entry into `.cursor/mcp.json`.
- **Round trip** — `Ocul-PM: 웹사이트 열기`, "Open in Ocul-PM" (deep link), and the app's "Open in editor" lands on the entry in this sidebar.

### Commands

| Command | Title |
|---|---|
| `ocul-pm.openWebsite` | 웹사이트 열기 |
| `ocul-pm.rescanBinary` | oculpm-mcp 다시 찾기 |
| `ocul-pm.refresh` | 새로고침 |
| `ocul-pm.journal.open` | 미리보기로 열기 |
| `ocul-pm.openInEditor` | 편집기로 열기 |
| `ocul-pm.openInApp` | Ocul-PM 에서 열기 |
| `ocul-pm.copyPath` | 경로 복사 |
| `ocul-pm.injectRules` | 기록 규칙 주입 (AGENTS.md 등) |
| `ocul-pm.registerCursorMcp` | Cursor 에 MCP 서버 등록 (.cursor/mcp.json) |

### Settings

| Setting | Default | Meaning |
|---|---|---|
| `oculpm.mcpBinaryPath` | `""` | Explicit path to `oculpm-mcp`; empty = look inside `/Applications/Ocul-PM.app` then `~/Applications/Ocul-PM.app`. |
| `oculpm.mcpAgentId` | `copilot` | `agent.id` written into entries created by agents through the registered MCP server. |

## Requirements

- VS Code 1.101+ (or a VS Code-based editor installed from Open VSX)
- [Ocul-PM](https://oculpm.com) desktop app for write features (macOS)

## Development

```bash
cd extension
pnpm install
pnpm compile      # typecheck + lint + esbuild
pnpm test         # @vscode/test-cli (downloads a VS Code build into .vscode-test/)
```

Open `extension/` in VS Code and press F5 to launch an Extension Development Host.
