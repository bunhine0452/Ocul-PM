/**
 * diff 본문 한 장 — 바이너리 카드 · 기준본 없는 새 파일 · 삭제된 파일 ·
 * 평범한 패치까지, 「무엇을 보여줄 수 있는가」의 분기를 한 곳에 모은다.
 *
 * `DiffScreenV2` 에서 그대로 분리했다 (분할 라운드, 플랜 `v3-release`
 * {#planner-diff-split}). 실제 줄 렌더는 계속 `PatchView` 가 갖고, 그 아래
 * 순수 파서(`diffParse`)도 그대로다 — Lite-W6 PR6.x 안전망 테스트가 계속
 * 같은 함수를 문다. 같은 결과로 다시 그려질 때는 건너뛴다(memo) — 워처 이벤트마다 목록이 새로 와도
 * 본문은 그대로다 (11-15 #diff-perf).
 */

import { memo } from "react";

import { EmptyState } from "@/components/EmptyState";
import { GitBranchIcon } from "@/components/Icons";
import { useT } from "@/i18n";
import type { DiffResult } from "@/lib/bindings";
import type { DiffMode } from "@/contexts/WorkspaceContext";
import { BinaryFileView } from "./BinaryFileView";
import type { DiffBaseline } from "./changeList";
import { langFromPath } from "./diffParse";
import { PatchView, type PatchNotes } from "./PatchView";

interface DiffBodyProps {
  result: DiffResult;
  mode: DiffMode;
  deleted: boolean;
  baseline: DiffBaseline;
  projectId: number;
  /** 줄 메모를 켠다 — 변경 화면만. */
  notes?: PatchNotes | null;
  /** 이 본문을 공백 무시로 읽었다 — git 패치가 통째로 비었으면 「공백만 바뀌었어요」. */
  ignoreWhitespace?: boolean;
  /** 새 쪽 줄 번호 ⌘클릭 — 편집기에서 그 줄. */
  onOpenLine?: (line: number) => void;
  /** 잘린 diff 의 「편집기에서 열기」. */
  onOpenEditor?: () => void;
}

export const DiffBody = memo(function DiffBody({
  result,
  mode,
  deleted,
  baseline,
  projectId,
  notes = null,
  ignoreWhitespace = false,
  onOpenLine,
  onOpenEditor,
}: DiffBodyProps) {
  const { t } = useT();
  const src = result.source;
  // 이미지/기타 바이너리 — 텍스트 diff 대신 파일 카드(+이미지 프리뷰).
  if (src.source === "binary") {
    return (
      <BinaryFileView
        projectId={projectId}
        path={result.path}
        isImage={src.is_image}
        oldSize={src.old_size}
        newSize={src.new_size}
        baseline={baseline}
      />
    );
  }
  if (src.source === "snapshots_unavailable") {
    // 기준본도 디스크의 파일도 없다 — 지워진 신규 파일. 보여 줄 것은 없지만 오류도 아니다.
    return (
      <EmptyState align="start" density="compact">
        {deleted ? t("diff.fileDeleted") : t("diff.noBaseline")}
      </EmptyState>
    );
  }
  // 덩이가 없으면 바뀐 줄이 없다 — 왜 없는지를 맞게 말한다. 「공백만」 은 공백 무시로 읽은 git 패치가 통째로
  // 빈 때뿐이다(백엔드는 공백까지 보면 바뀐 추적 파일에만 그 답을 준다. 스냅샷 · 새 파일 갈래엔 공백 무시가
  // 걸리지 않는다). 기준본 없는 빈 새 파일(`__init__.py` · `.gitkeep`)은 「커밋과 같아요」 가 아니다.
  if (!/^@@/m.test(src.patch)) {
    const empty =
      src.source === "new_file"
        ? t("diff.emptyNewFile")
        : ignoreWhitespace && src.source === "git" && src.patch.trim() === ""
          ? t("diff.onlyWhitespace")
          : t("diff.noChanges", { base: src.source === "snapshot" ? t("diff.baseSnapshot") : t("diff.baseHead") });
    return (
      <EmptyState align="start" density="compact">
        {empty}
      </EmptyState>
    );
  }
  const foot =
    src.source === "new_file"
      ? t("diff.newFileNote")
      : baseline === "last_commit"
        ? t("diff.footerLastCommit")
        : src.source === "snapshot"
          ? t("diff.footerSnapshot")
          : t("diff.footerWorking");
  return (
    <div>
      <PatchView
        patch={src.patch}
        mode={mode}
        lang={langFromPath(result.path)}
        notes={notes}
        cut={result.truncated ?? null}
        onOpenLine={onOpenLine}
        onOpenEditor={onOpenEditor}
      />
      <div className="diff-foot">
        <GitBranchIcon size={13} />
        {foot}
      </div>
    </div>
  );
});
