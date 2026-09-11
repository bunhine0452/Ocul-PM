// `vscode://oculpm.ocul-pm/open?entry=<절대경로>` — 앱의 '편집기로 열기'
// (`oculpm_open_entry_in_editor`, src-tauri/src/vscode_ext.rs)가 보낸다.
// 열 수 있는 것은 **열린 워크스페이스 폴더 안의 `.oculpm/journal/**/*.md`** 뿐 —
// URI 하나로 임의 파일이 열리는 길을 두지 않는다. 그 프로젝트가 이 창에 없으면
// 폴더를 열 것을 제안한다.
import * as path from "node:path";
import * as vscode from "vscode";
import type { JournalNode } from "./tree/journalTree";
import { resolveEntryTarget } from "./uriHandlerModel";

export function parseOpenUri(uri: vscode.Uri): string | null {
  if (uri.path !== "/open") {
    return null;
  }
  const entry = new URLSearchParams(uri.query).get("entry");
  return entry && entry.trim() !== "" ? entry : null;
}

export function registerUriHandler(
  context: vscode.ExtensionContext,
  journalView: vscode.TreeView<JournalNode>,
): (entryAbs: string) => Promise<boolean> {
  /** 절대경로의 일지를 미리보기로 열고 트리에서 선택. 대상 밖이면 false. */
  const openEntry = async (entry: string): Promise<boolean> => {
    const roots = (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === "file").map((f) => f.uri.fsPath);
    const target = resolveEntryTarget(entry, roots);
    if (!target) {
      // 안내는 기다리지 않는다 — 버튼 있는 메시지는 사용자가 닫을 때까지 resolve 되지
      // 않아, 여기서 await 하면 호출자(테스트·URI 큐)가 그만큼 멈춘다.
      void vscode.window
        .showWarningMessage("이 창에 열려 있지 않은 프로젝트의 일지입니다.", "프로젝트 폴더 열기")
        .then((pick) => {
          if (pick) {
            const projectRoot = entry.split(`${path.sep}.oculpm${path.sep}`)[0];
            return vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(projectRoot), { forceNewWindow: false });
          }
          return undefined;
        });
      return false;
    }
    const node: JournalNode = { kind: "entry", root: target.root, file: target.file };
    await vscode.commands.executeCommand("markdown.showPreview", vscode.Uri.file(target.file.absPath));
    try {
      await journalView.reveal(node, { select: true, focus: true, expand: true });
    } catch {
      // 트리가 아직 그 날짜를 안 보여주면(7일 밖) 미리보기만으로 충분하다.
    }
    return true;
  };
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      async handleUri(uri) {
        const entry = parseOpenUri(uri);
        if (entry) {
          await openEntry(entry);
        }
      },
    }),
  );
  return openEntry;
}
