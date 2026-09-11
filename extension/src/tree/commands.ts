// 트리 커맨드 — 전부 읽기(READ_COMMANDS). 일지는 내장 마크다운 미리보기로 열고,
// 편집기로 여는 것은 인라인 버튼(트리엔 ⌥클릭 구분이 없다). '앱에서 열기'는
// `oculpm://open` 딥링크 — 앱 쪽 확인 시트가 받는다(deeplink.rs).
import * as vscode from "vscode";
import { buildOpenDeepLink } from "../deeplink";
import type { JournalNode } from "./journalTree";
import type { PlanNode } from "./planTree";

type Node = JournalNode | PlanNode;

function fileOf(node: Node | undefined): { abs: string; root: string } | null {
  if (!node) {
    return null;
  }
  if (node.kind === "entry") {
    return { abs: node.file.absPath, root: node.root };
  }
  if (node.kind === "plan" || node.kind === "phase" || node.kind === "item") {
    return { abs: node.file.absPath, root: node.root };
  }
  return null;
}

export function registerTreeCommands(context: vscode.ExtensionContext, refresh: () => void): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("ocul-pm.refresh", refresh),
    vscode.commands.registerCommand("ocul-pm.journal.open", async (node?: Node) => {
      const f = fileOf(node);
      if (f) {
        await vscode.commands.executeCommand("markdown.showPreview", vscode.Uri.file(f.abs));
      }
    }),
    vscode.commands.registerCommand("ocul-pm.openInEditor", async (node?: Node) => {
      const f = fileOf(node);
      if (f) {
        await vscode.window.showTextDocument(vscode.Uri.file(f.abs), { preview: true });
      }
    }),
    vscode.commands.registerCommand("ocul-pm.openInApp", async (node?: Node) => {
      const f = fileOf(node);
      const root = f?.root ?? (await firstRoot());
      if (root) {
        await vscode.env.openExternal(vscode.Uri.parse(buildOpenDeepLink(root, f?.abs), true));
      }
    }),
    vscode.commands.registerCommand("ocul-pm.copyPath", async (node?: Node) => {
      const f = fileOf(node);
      if (f) {
        await vscode.env.clipboard.writeText(vscode.workspace.asRelativePath(f.abs, false));
        vscode.window.setStatusBarMessage("경로를 복사했습니다", 2000);
      }
    }),
  );
}

async function firstRoot(): Promise<string | undefined> {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}
