// 로컬 히스토리 커맨드 래퍼 (docs/20260902_vscode-borrows/06-local-history.md).
//
// `call` 을 지나므로 화면은 `catch (e)` 하나면 되고, 오류는 `tError` 로 한
// 모양이 된다 (완성도 라운드 #error-convention).
import { commands, type CodeHistoryVersion, type CodeWriteOutcome } from "@/lib/bindings";
import { call } from "./invoke";

export type { CodeHistoryVersion };

export const codeHistoryApi = {
  /** 이 파일의 판 목록 — 최신순. 히스토리가 없으면 빈 배열. */
  list: (projectId: number, relPath: string): Promise<CodeHistoryVersion[]> =>
    call("code_history_list", commands.codeHistoryList(projectId, relPath)),

  /** 그 판의 내용. 정리돼 사라졌으면 거절한다. */
  read: (projectId: number, relPath: string, ts: string): Promise<string> =>
    call("code_history_read", commands.codeHistoryRead(projectId, relPath, ts)),

  /** 그 판을 지금 파일에 쓴다 — `code_write` 와 같은 낙관적 잠금을 통과한다. */
  restore: (
    projectId: number,
    relPath: string,
    ts: string,
    baseHash: string,
  ): Promise<CodeWriteOutcome> =>
    call("code_history_restore", commands.codeHistoryRestore(projectId, relPath, ts, baseHash)),

  /** 이 파일의 판 전부 삭제. */
  forget: (projectId: number, relPath: string): Promise<null> =>
    call("code_history_forget", commands.codeHistoryForget(projectId, relPath)),

  /** 지금 쓰는 용량 (바이트). */
  usage: (projectId: number): Promise<number> =>
    call("code_history_usage", commands.codeHistoryUsage(projectId)),

  /** 프로젝트의 판 전부 삭제. */
  clear: (projectId: number): Promise<null> =>
    call("code_history_clear", commands.codeHistoryClear(projectId)),
};
