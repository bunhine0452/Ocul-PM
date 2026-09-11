// `.oculpm/{journal,planner}/**/*.md` 워처 → 트리 갱신. 폴더 단위 RelativePattern
// 이라 `index/**`(앱 관리 캐시, 재구축 때 수백 파일이 한꺼번에 바뀐다)는 글롭에
// 아예 들어오지 않는다. 100ms 디바운스 — journal_write 한 번이 create+change
// 두세 이벤트로 오는 것을 한 번의 refresh 로 접는다.
//
// 추적 여부와 무관하게 **모든 폴더**를 건다: 앱에서 프로젝트를 추가해 첫 일지가
// 생기면 그 create 이벤트가 곧 "추적 시작" 신호라 재시작 없이 Welcome 뷰가
// 트리로 바뀐다(트리가 refresh 때 `trackedFolders` 를 다시 센다). 디렉터리 생성
// 이벤트에 기대는 마커 워처는 실측에서 안 왔다 — 파일 이벤트만 믿는다.
import * as vscode from "vscode";

export const DEBOUNCE_MS = 100;
export const CONTENT_GLOB = ".oculpm/{journal,planner}/**/*.md";

export function startWatching(context: vscode.ExtensionContext, refresh: () => void): void {
  let perFolder: vscode.Disposable[] = [];
  let timer: NodeJS.Timeout | undefined;
  const kick = () => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = undefined;
      refresh();
    }, DEBOUNCE_MS);
  };

  const arm = () => {
    for (const d of perFolder) {
      d.dispose();
    }
    perFolder = [];
    for (const f of vscode.workspace.workspaceFolders ?? []) {
      if (f.uri.scheme !== "file") {
        continue;
      }
      const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(f, CONTENT_GLOB));
      w.onDidCreate(kick);
      w.onDidChange(kick);
      w.onDidDelete(kick);
      perFolder.push(w);
    }
  };

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      arm();
      kick();
    }),
    {
      dispose: () => {
        for (const d of perFolder) {
          d.dispose();
        }
        if (timer) {
          clearTimeout(timer);
        }
      },
    },
  );
  arm();
}
