// git 커맨드 래퍼 — 화면은 `commands` 를 직접 만지지 않는다 (`lint:bindings`).
//
// `call` 을 지나므로 호출부는 `catch` 하나면 되고, 오류는 `tError` 로 한 모양이
// 된다 (완성도 라운드 #error-convention). 2026-09-11 편집기 IDE 라운드에서
// 트리·탭의 git 상태 장식(`features/code/gitDecor`)이 첫 손님으로 열었다.
import { commands, type GitChange } from "@/lib/bindings";
import { call } from "./invoke";

export type { GitChange };

export const gitApi = {
  /**
   * 미커밋 변경 전부 (staged + unstaged + untracked) — `status --porcelain` 을
   * 프로젝트 기준 경로로 되돌린 것. 비-git 프로젝트는 빈 배열이다.
   */
  uncommittedChanges: (projectId: number): Promise<GitChange[]> =>
    call("git_uncommitted_changes", commands.gitUncommittedChanges(projectId)),
};
