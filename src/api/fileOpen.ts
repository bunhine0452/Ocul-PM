// 프로젝트 파일을 **앱 밖에서** 여는 세 가지 (2026-09-07).
//
// 터미널 출력의 `파일:줄` 을 ⌘클릭하면 뜨는 선택 팝오버가 쓴다. 셋 다 같은
// 경로 가드를 지난다 — 터미널이 뱉은 문자열은 신뢰할 수 없으므로 백엔드가
// `secure_join` 으로 프로젝트 루트 안쪽인지 다시 판정하고, 거절 사유가 그대로
// `ApiError` 로 올라온다 (조용히 아무 일도 안 일어나면 왜 안 되는지 알 수 없다).
import { commands } from "@/lib/bindings";
import { call } from "./invoke";

export const fileOpenApi = {
  /** 외부 편집기 — 설정의 명령 템플릿(`%path`/`%line`)을 셸로 실행한다. */
  inExternalEditor: (
    projectRoot: string,
    relPath: string,
    editorCmd: string,
    line: number | null,
  ): Promise<null> =>
    call("open_in_editor", commands.openInEditor(projectRoot, relPath, editorCmd, line)),

  /** 파일 탐색기에서 선택된 채로 (macOS: Finder). */
  reveal: (projectRoot: string, relPath: string): Promise<null> =>
    call("reveal_in_file_manager", commands.revealInFileManager(projectRoot, relPath)),

  /** 빠른 미리보기 — macOS Quick Look. 다른 OS 에서는 사유와 함께 거절된다. */
  quickLook: (projectRoot: string, relPath: string): Promise<null> =>
    call("quick_look_file", commands.quickLookFile(projectRoot, relPath)),
};
