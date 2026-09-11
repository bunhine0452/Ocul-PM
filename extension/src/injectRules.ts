// '기록 규칙 주입' — 추적 프로젝트에 AGENTS.md 등 활성 어댑터 규칙 파일을 쓰거나
// 보완한다. 확장은 템플릿 복사본을 갖지 않는다: `oculpm-mcp` 의 `project_init`
// 이 이미 추적 중인 프로젝트에서 **ensure 시맨틱**(누락분만, `sync_active` 호출)
// 이라 앱의 AGENTS.md 동기와 같은 함수 → 바이트 동일. 사용자가 누른 커맨드라
// `confirm: true` 의 뜻("사용자가 명시적으로 확인")이 그대로 성립한다.
import * as path from "node:path";
import * as vscode from "vscode";
import type { OculpmMcpClient } from "./mcp/client";
import { isTracked } from "./oculpm/store";

interface InitResult {
  initialized: boolean;
  root: string;
  adapters_synced: number;
  note: string;
}

export async function injectRules(clientFor: (root: string) => OculpmMcpClient | null, root: string): Promise<InitResult | null> {
  if (!(await isTracked(root))) {
    void vscode.window.showWarningMessage("추적 대상이 아닌 폴더입니다 — 먼저 Ocul-PM 앱에서 프로젝트를 추가하세요.");
    return null;
  }
  const client = clientFor(root);
  if (!client) {
    void vscode.window.showWarningMessage("읽기 전용 — Ocul-PM 앱의 oculpm-mcp 를 찾지 못했습니다.");
    return null;
  }
  const ok = await vscode.window.showWarningMessage(
    `${path.basename(root)} 에 기록 규칙 파일(AGENTS.md 등, .oculpm/config.toml 의 활성 에이전트 기준)을 쓰거나 보완합니다.`,
    { modal: true },
    "주입",
  );
  if (ok !== "주입") {
    return null;
  }
  const r = await client.callTool<InitResult>("project_init", { confirm: true });
  void vscode.window.showInformationMessage(`규칙 파일 ${r.adapters_synced}개 어댑터 동기 완료 — ${r.note}`);
  return r;
}

export async function pickRoot(): Promise<string | undefined> {
  const folders = (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === "file");
  if (folders.length <= 1) {
    return folders[0]?.uri.fsPath;
  }
  const pick = await vscode.window.showQuickPick(folders.map((f) => ({ label: f.name, description: f.uri.fsPath })), { placeHolder: "규칙을 주입할 프로젝트" });
  return pick?.description;
}
