import { useCallback, useState } from "react";

import { Toolbar } from "@/components/Toolbar";
import { ErrorCard } from "@/components/ErrorCard";
import { SkeletonList } from "@/components/ui/Skeleton";
import { Download, GitBranchIcon } from "@/components/Icons";
import { oculpmApi } from "@/api/oculpm";
import { toast } from "@/lib/toast";
import { useT } from "@/i18n";
import { CommitsPanel, EntriesPanel, FilesPanel, PlanPanel, wd } from "./BranchPanels";
import { useBranchStory } from "./useBranchStory";

// 「브랜치의 이야기」 (v3-surface {#branch-story-view}).
//
// **왜 화면인가.** 이 저장소의 기록 축은 날짜 + 타입 폴더다. 그래서 "이번
// 브랜치에서 무엇을 했나" 를 물으면 답이 없었다 — 일지는 날짜로, 커밋은 git
// 으로, 플랜은 또 따로 흩어져 있었다. 여기는 그 셋을 **브랜치 하나의 좌표**로
// 다시 읽는 자리다.
//
// **무엇을 저장하지 않는가.** 아무것도. 귀속은 질의 시점의 파생이다 — 브랜치는
// 리베이스·머지로 움직이는 좌표라, 저장한 값은 곧 거짓이 된다
// (`oculpm/index/branch.rs` 모듈 주석).
//
// **행이 이유를 말한다.** 일지마다 "왜 이 브랜치에 붙었는가"(파일 자체 / 파일
// 겹침)를 함께 그린다. 파생 판정을 근거 없이 단정하면 그건 원장에 대한
// 거짓말이 된다.
export function BranchScreenV2({
  projectId,
  active,
  onOpenJournal,
  onOpenFile,
}: {
  projectId: number;
  active: boolean;
  /** 일지 상대 경로로 작업 일지 화면을 연다. */
  onOpenJournal: (relativePath: string) => void;
  /** 프로젝트 상대 파일 경로로 코드 화면을 연다. */
  onOpenFile: (path: string) => void;
}) {
  const { t } = useT();
  const { branches, story, picked, loading, error, pick, reload } = useBranchStory(projectId, active);
  const [exporting, setExporting] = useState(false);

  const exportDigest = useCallback(async () => {
    if (exporting || !story) return;
    setExporting(true);
    try {
      const path = await oculpmApi.branchExportDigest(projectId, story.branch, story.base);
      // null = 사용자가 취소 → 조용히 지나간다.
      if (path) toast.info(t("branch.exported", { path }));
    } catch (e) {
      toast.destructive(t("branch.exportFailed", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setExporting(false);
    }
  }, [exporting, story, projectId, t]);

  const recordRate =
    story && story.files.length > 0
      ? Math.round((story.recorded_files / story.files.length) * 100)
      : null;

  const sub = story
    ? t("branch.sub", {
        base: story.base ?? "—",
        since: wd(story.since_workday),
        until: wd(story.until_workday),
      })
    : undefined;

  const empty =
    !!story && story.commits.length === 0 && story.entries.length === 0 && story.files.length === 0;

  return (
    <>
      <Toolbar title={t("nav.branch")} sub={sub}>
        {branches.length > 0 ? (
          // 툴바 안이라 폭을 좁힌다 — `.set-input` 의 기본 220px 는 이 자리에서
          // 액션 묶음을 밀어 낸다.
          <select
            className="set-input"
            style={{ minWidth: 0, maxWidth: 220, height: 26 }}
            aria-label={t("branch.pick")}
            value={picked ?? story?.branch ?? ""}
            onChange={(e) => pick(e.target.value || null)}
          >
            {branches.map((b) => (
              <option key={b.name} value={b.name}>
                {b.is_current ? `● ${b.name}` : b.name}
              </option>
            ))}
          </select>
        ) : null}
        <button type="button" className="btn sm" disabled={!story || exporting} onClick={() => void exportDigest()}>
          <Download size={14} /> {t("branch.export")}
        </button>
      </Toolbar>

      <div className="scroll">
        <div className="page fade-in">
          {error ? <ErrorCard title={t("branch.loadFailed")} error={error} onRetry={reload} /> : null}
          {loading && !story ? <SkeletonList rows={4} height={76} /> : null}

          {story ? (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-4 gap-3">
                <Stat label={t("branch.stat.commits")} value={story.commits.length} />
                <Stat label={t("branch.stat.entries")} value={story.entries.length} />
                <Stat label={t("branch.stat.files")} value={story.files.length} />
                <Stat
                  label={t("branch.stat.recorded")}
                  value={recordRate == null ? "—" : `${recordRate}%`}
                  sub={
                    recordRate == null
                      ? undefined
                      : t("branch.stat.recordedSub", { n: story.recorded_files, total: story.files.length })
                  }
                />
              </div>

              {story.truncated ? (
                <div className="card card-pad text-sm text-muted-foreground">{t("branch.truncated")}</div>
              ) : null}

              {empty ? (
                <div className="empty-hint">
                  <GitBranchIcon size={18} aria-hidden />
                  <div style={{ marginTop: 8 }}>{t("branch.empty")}</div>
                </div>
              ) : null}

              {story.entries.length > 0 ? (
                <EntriesPanel entries={story.entries} onOpen={onOpenJournal} />
              ) : null}
              {story.plan_items.length > 0 ? <PlanPanel items={story.plan_items} /> : null}
              {story.commits.length > 0 ? <CommitsPanel commits={story.commits} /> : null}
              {story.files.length > 0 ? <FilesPanel files={story.files} onOpen={onOpenFile} /> : null}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  // 회고·Today 와 같은 물체다 (`.stat`). 숫자에 색을 칠하지 않는다.
  return (
    <div className="stat">
      <div className="stat-top">{label}</div>
      <div className="stat-val">{value}</div>
      {sub ? <div className="stat-sub">{sub}</div> : null}
    </div>
  );
}
