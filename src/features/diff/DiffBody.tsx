/**
 * diff 본문 한 장 — 바이너리 카드 · 기준선 없는 신규 파일 · 삭제된 파일 ·
 * 평범한 패치까지, 「무엇을 보여줄 수 있는가」의 분기를 한 곳에 모은다.
 *
 * `DiffScreenV2` 에서 그대로 분리했다 (분할 라운드, 플랜 `v3-release`
 * {#planner-diff-split}). 실제 줄 렌더는 계속 `PatchView` 가 갖고, 그 아래
 * 순수 파서(`diffParse`)도 그대로다 — Lite-W6 PR6.x 안전망 테스트가 계속
 * 같은 함수를 문다.
 */

import { EmptyState } from "@/components/EmptyState";
import { GitBranchIcon } from "@/components/Icons";
import { useT } from "@/i18n";
import type { DiffResult } from "@/lib/bindings";
import type { DiffMode } from "@/contexts/WorkspaceContext";
import { BinaryFileView } from "./BinaryFileView";
import type { DiffBaseline } from "./changeList";
import { langFromPath } from "./diffParse";
import { PatchView } from "./PatchView";

interface DiffBodyProps {
  result: DiffResult;
  mode: DiffMode;
  newFilePatch: string | null;
  newFileError: string | null;
  deleted: boolean;
  baseline: DiffBaseline;
  projectId: number;
}

export function DiffBody({
  result,
  mode,
  newFilePatch,
  newFileError,
  deleted,
  baseline,
  projectId,
}: DiffBodyProps) {
  const { t } = useT();
  // 이미지/기타 바이너리 — 텍스트 diff 대신 파일 카드(+이미지 프리뷰).
  if (result.source.source === "binary") {
    return (
      <BinaryFileView
        projectId={projectId}
        path={result.path}
        isImage={result.source.is_image}
        oldSize={result.source.old_size}
        newSize={result.source.new_size}
        baseline={baseline}
      />
    );
  }
  if (result.source.source === "snapshots_unavailable") {
    // A deleted file with no baseline — nothing to diff, but don't error.
    if (deleted) {
      return (
        <EmptyState align="start" style={{ padding: 16 }}>
          {t("diff.fileDeleted")}
          <br />
          <span className="text-muted-foreground" style={{ fontSize: "var(--fs-3)" }}>
            {t("diff.noBaseline")}
          </span>
        </EmptyState>
      );
    }
    // No baseline yet — render the file's whole content as additions so the
    // user sees the change immediately (untracked / never-indexed file).
    if (newFilePatch == null) {
      return (
        <EmptyState align="start" style={{ padding: 16 }}>
          {newFileError ? (
            <>
              {t("diff.readFailed")}
              <br />
              <span className="text-muted-foreground" style={{ fontSize: "var(--fs-3)" }}>
                {newFileError}
              </span>
            </>
          ) : (
            t("diff.readingFile")
          )}
        </EmptyState>
      );
    }
    return (
      <div>
        <PatchView patch={newFilePatch} mode={mode} lang={langFromPath(result.path)} />
        <div className="diff-foot">
          <GitBranchIcon size={13} />
          {t("diff.newFileNote")}
        </div>
      </div>
    );
  }
  const patch = result.source.patch;
  const isSnapshot = result.source.source === "snapshot";
  if (!patch.trim()) {
    return (
      <EmptyState align="start" style={{ padding: 16 }}>
        {t("diff.noChanges", { base: isSnapshot ? t("diff.baseSnapshot") : t("diff.baseHead") })}
      </EmptyState>
    );
  }
  return (
    <div>
      <PatchView patch={patch} mode={mode} lang={langFromPath(result.path)} />
      <div className="diff-foot">
        <GitBranchIcon size={13} />
        {baseline === "last_commit"
          ? t("diff.footerLastCommit")
          : t("diff.footerWorking", { base: isSnapshot ? t("diff.baseSnapshotLong") : t("diff.baseHeadLong") })}
      </div>
    </div>
  );
}
