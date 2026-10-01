// git 커맨드 래퍼 — 화면은 `commands` 를 직접 만지지 않는다 (`lint:bindings`).
//
// `call` 을 지나므로 호출부는 `catch` 하나면 되고, 오류는 `tError` 로 한 모양이
// 된다 (완성도 라운드 #error-convention). 2026-09-11 편집기 IDE 라운드에서
// 트리·탭의 git 상태 장식(`features/code/gitDecor`)이 첫 손님으로 열었고,
// 2026-10-01 `{#api-facades}` 에서 Today·diff·편집기 거터·AI 맥락의 git 읽기가
// 전부 여기로 왔다. 전부 로컬 git 이다 — 네트워크도 토큰도 없다.
import {
  commands,
  type GitChange,
  type GitCommit,
  type GitGraphCommit,
  type GitHeadStatusBrief,
  type GitLineChange,
  type GitRepoStatus,
} from "@/lib/bindings";
import { call } from "./invoke";

export type { GitChange };

/** 마지막 커밋과 그 커밋이 건드린 파일 — diff 화면의 「직전 커밋」 기준선. */
export interface LastCommitChanges {
  sha: string;
  short_sha: string;
  subject: string;
  changes: GitChange[];
}

export const gitApi = {
  /**
   * 미커밋 변경 전부 (staged + unstaged + untracked) — `status --porcelain` 을
   * 프로젝트 기준 경로로 되돌린 것. 비-git 프로젝트는 빈 배열이다.
   */
  uncommittedChanges: (projectId: number): Promise<GitChange[]> =>
    call("git_uncommitted_changes", commands.gitUncommittedChanges(projectId)),

  /** 마지막 커밋의 변경 목록. 커밋이 아직 없으면 `null`, git 이 아니면 거절한다. */
  lastCommitChanges: (projectId: number): Promise<LastCommitChanges | null> =>
    call("git_last_commit_changes", commands.gitLastCommitChanges(projectId)),

  /** 레인 그래프용 커밋 목록 (최신순 `limit` 개). git 이 아니면 거절한다. */
  graph: (projectId: number, limit: number): Promise<GitGraphCommit[]> =>
    call("git_graph", commands.gitGraph(projectId, limit)),

  /** 브랜치·원격·변경 수. */
  status: (projectId: number): Promise<GitRepoStatus> =>
    call("git_status", commands.gitStatus(projectId)),

  /** 최근 커밋 `limit` 개 (최신순). */
  log: (projectId: number, limit: number): Promise<GitCommit[]> =>
    call("git_log", commands.gitLog(projectId, limit)),

  /** Today 감시 위젯의 짧은 HEAD 요약. */
  headStatusBrief: (projectId: number): Promise<GitHeadStatusBrief> =>
    call("git_head_status_brief", commands.gitHeadStatusBrief(projectId)),

  /** 편집 중인 **버퍼**를 HEAD 와 견준 줄 변경 — 편집기 거터. */
  lineChanges: (projectId: number, relPath: string, text: string): Promise<GitLineChange[]> =>
    call("git_line_changes", commands.gitLineChanges(projectId, relPath, text)),
};
