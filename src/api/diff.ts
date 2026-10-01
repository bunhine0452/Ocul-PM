// 변경 diff 화면의 커맨드 래퍼 (2026-10-01 `{#api-facades}`).
//
// 파일 한 장의 diff·이진 미리보기, 그리고 목록을 일지·플랜으로 묶고 영향 범위를
// 재는 두 보강 조회. `call` 을 지나므로 호출부는 `catch` 하나면 되고 오류는
// `tError(toAppError(e))` 로 한 모양이 된다.
import {
  commands,
  type BinaryPreview,
  type ChangeGroup,
  type DiffResult,
  type ImpactReport,
} from "@/lib/bindings";
import { call } from "./invoke";

/** `null` = 작업 트리 기준(스냅숏·HEAD), `"last_commit"` = 직전 커밋 기준. */
export type DiffBaselineArg = "last_commit" | null;

export const diffApi = {
  /** 한 파일의 diff. `maxBytes` 를 넘는 본문은 잘린다. */
  compute: (
    projectId: number,
    path: string,
    maxBytes: number,
    baseline: DiffBaselineArg,
  ): Promise<DiffResult> =>
    call("compute_diff", commands.computeDiff(projectId, path, maxBytes, baseline)),

  /** 이미지 같은 이진 파일의 전후 미리보기. */
  binaryPreview: (projectId: number, path: string, baseline: DiffBaselineArg): Promise<BinaryPreview> =>
    call("diff_binary_preview", commands.diffBinaryPreview(projectId, path, baseline)),

  /** 변경 파일들을 그것을 기록한 일지·플랜으로 묶는다. */
  groupChanges: (projectId: number, paths: string[]): Promise<ChangeGroup[]> =>
    call("oculpm_group_changes", commands.oculpmGroupChanges(projectId, paths)),

  /** 변경 파일들에서 역방향으로 닿는 파일 (코드 그래프 BFS). */
  changeImpact: (projectId: number, changedPaths: string[]): Promise<ImpactReport> =>
    call("get_change_impact", commands.getChangeImpact(projectId, changedPaths)),
};
