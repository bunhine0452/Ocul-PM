import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { isTracked } from "../oculpm/store";
import { mergeCursorMcpJson } from "./mcpJson";

export const CURSOR_AGENT_ID = "cursor";

/** 옵인 커맨드 — 파싱 불가 파일은 에러 토스트만, 절대 덮어쓰지 않는다. */
export async function registerCursorMcp(binary: string | null, root: string): Promise<void> {
  if (binary === null) {
    void vscode.window.showWarningMessage("읽기 전용 — Ocul-PM 앱의 oculpm-mcp 를 찾지 못했습니다.");
    return;
  }
  if (!(await isTracked(root))) {
    void vscode.window.showWarningMessage("추적 대상이 아닌 폴더입니다 — 먼저 Ocul-PM 앱에서 프로젝트를 추가하세요.");
    return;
  }
  const file = path.join(root, ".cursor", "mcp.json");
  const ok = await vscode.window.showWarningMessage(
    `${path.basename(root)}/.cursor/mcp.json 에 oculpm 서버를 등록합니다. 바이너리 경로는 이 머신 것이라, 파일을 커밋하면 팀원 머신에서는 경로가 다를 수 있습니다.`,
    { modal: true },
    "등록",
  );
  if (ok !== "등록") {
    return;
  }
  let raw: string | null = null;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    raw = null;
  }
  const out = mergeCursorMcpJson(raw, { binary, root, agentId: CURSOR_AGENT_ID });
  if (out.kind === "error") {
    void vscode.window.showErrorMessage(out.message);
    return;
  }
  if (out.kind === "unchanged") {
    vscode.window.setStatusBarMessage("Ocul-PM: 이미 등록되어 있습니다", 3000);
    return;
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, out.text, "utf8");
  void vscode.window.showInformationMessage(`.cursor/mcp.json ${out.created ? "생성" : "갱신"} — Cursor 를 다시 열면 oculpm 도구가 보입니다.`);
}
