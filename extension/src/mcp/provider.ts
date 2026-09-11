// MCP 서버 정의 공급자 — VS Code(≥1.101)의 Copilot 에이전트 모드가 우리
// `oculpm-mcp` 를 보게 한다. 추적 폴더마다 정의 하나(`oculpm (<폴더>)`),
// 바이너리가 없으면 **0개**(오류 아님 → 읽기 전용과 같은 강등). Cursor 등
// `vscode.lm` 이 없는 포크에서는 등록 자체를 건너뛴다(`{#ag-cursor}` 가 다른 길).
import * as vscode from "vscode";
import { trackedFolders } from "../tree/workspace";
import { definitionsFor, DEFAULT_AGENT_ID, PROVIDER_ID } from "./providerModel";

export function hasMcpProviderApi(): boolean {
  const lm = (vscode as unknown as { lm?: { registerMcpServerDefinitionProvider?: unknown } }).lm;
  return typeof lm?.registerMcpServerDefinitionProvider === "function";
}

export interface McpProviderHandle {
  fire: () => void;
  /** 테스트용 — 지금 공급할 정의 목록 (VS Code 에는 목록을 읽는 API 가 없다). */
  provide: () => Promise<vscode.McpStdioServerDefinition[]>;
}

export function registerMcpProvider(context: vscode.ExtensionContext, binaryPath: () => string | null): McpProviderHandle | null {
  if (!hasMcpProviderApi()) {
    return null;
  }
  const changed = new vscode.EventEmitter<void>();
  const provider: vscode.McpServerDefinitionProvider<vscode.McpStdioServerDefinition> = {
    onDidChangeMcpServerDefinitions: changed.event,
    async provideMcpServerDefinitions() {
      const agentId = vscode.workspace.getConfiguration("oculpm").get<string>("mcpAgentId")?.trim() || DEFAULT_AGENT_ID;
      return definitionsFor(binaryPath(), await trackedFolders(), agentId).map((d) => {
        const def = new vscode.McpStdioServerDefinition(d.label, d.command, d.args, d.env);
        // cwd 는 생성자 인자가 아니라 필드 — 루트에서 띄워 서버의 conflicting_tracked_root 가드와 맞춘다.
        def.cwd = vscode.Uri.file(d.cwd);
        return def;
      });
    },
  };
  context.subscriptions.push(
    changed,
    vscode.lm.registerMcpServerDefinitionProvider(PROVIDER_ID, provider),
    vscode.workspace.onDidChangeWorkspaceFolders(() => changed.fire()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("oculpm.mcpAgentId") || e.affectsConfiguration("oculpm.mcpBinaryPath")) {
        changed.fire();
      }
    }),
  );
  return {
    fire: () => changed.fire(),
    provide: async () => (await provider.provideMcpServerDefinitions(new vscode.CancellationTokenSource().token)) ?? [],
  };
}
