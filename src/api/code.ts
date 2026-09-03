// 트리 파일 조작 커맨드 래퍼 (만들기·이름 바꾸기/옮기기·삭제).
//
// `call` 을 지나므로 화면은 `catch (e)` 하나면 되고, 오류는 `tError` 로 한
// 모양이 된다 (완성도 라운드 #error-convention). `codeHistory.ts` 와 같은 규격.
import { commands, type CodePathResult } from "@/lib/bindings";
import { call } from "./invoke";

export type { CodePathResult };

export const codeFileApi = {
  /** 빈 파일 하나. 중간 폴더는 따라 생긴다. */
  create: (projectId: number, relPath: string): Promise<CodePathResult> =>
    call("code_create", commands.codeCreate(projectId, relPath)),

  mkdir: (projectId: number, relPath: string): Promise<CodePathResult> =>
    call("code_mkdir", commands.codeMkdir(projectId, relPath)),

  /**
   * 이름 바꾸기 **겸** 옮기기 — 둘은 같은 연산이다 (목적지 경로가 다를 뿐).
   * 옮긴 것이 폴더였는지는 응답이 알려 준다 — 트리 캐시가 낡았을 수 있어
   * 프런트의 판단을 믿지 않는다.
   */
  rename: (projectId: number, fromRel: string, toRel: string): Promise<CodePathResult> =>
    call("code_rename", commands.codeRename(projectId, fromRel, toRel)),

  /** OS 휴지통으로 보낸다 — 영구 삭제가 아니다. */
  delete: (projectId: number, relPath: string): Promise<null> =>
    call("code_delete", commands.codeDelete(projectId, relPath)),
};
