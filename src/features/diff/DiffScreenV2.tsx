import { EmptyState } from "@/components/EmptyState";
import { ErrorCard } from "@/components/ErrorCard";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useCallback } from "react";
import { Toolbar } from "@/components/Toolbar";
import { FileCode2, ExternalLinkIcon, GitBranchIcon, CheckMark, Loader, ShieldCheck } from "@/components/Icons";
import { commands } from "@/lib/bindings";
import { useWorkspace, type DiffMode } from "@/contexts/WorkspaceContext";
import { useSettings } from "@/contexts/SettingsContext";
import { toast } from "@/lib/toast";
import { requestAgentContext } from "@/lib/agentContextNav";
import { ruleGlobsFromPaths } from "@/lib/promoteSeed";
import { DiffFileList } from "./DiffFileList";
import { DiffBody } from "./DiffBody";
import type { DiffBaseline } from "./changeList";
import { useDiffChanges } from "./useDiffChanges";
import { useDiffFile } from "./useDiffFile";
import { useDiffSearch } from "./useDiffSearch";
import { useT } from "@/i18n";

// Final UI Update (ui_v2) — 변경 diff 전용 화면 (02-screen-specs §3). Wraps the
// EXISTING diff pipeline: file list = git uncommitted changes (persistent,
// commands.gitUncommittedChanges) merged with WorkspaceContext.recentChanges
// (the live Watcher buffer) — Bug 1 fix so the list survives app restarts /
// project switches instead of depending on the session-only watcher. body =
// commands.computeDiff, rendering = PatchView (which owns the markup over
// diffParse's pure classifyDiffLines/groupIntoHunks/pairDiffLines, so the
// Lite-W6 PR6.x safety-net tests keep covering the parsers). The mockup
// .diff-screen 2-pane shell replaces the side-panel layout. flag-off
// LocalDiffView untouched.
//
// 이 파일은 **배치와 화면 동작**만 갖는다 (분할 라운드 {#planner-diff-split}):
// 목록·기준선은 `useDiffChanges`, 고른 파일 한 장은 `useDiffFile`, `/`·n·N
// 검색은 `useDiffSearch`, 본문 분기는 `DiffBody` 가 소유한다.

interface DiffScreenV2Props {
  projectId: number;
  /** Absolute project root — required by commands.openInEditor. */
  projectRoot: string | null;
  branch: string | null;
  /** Jump to a journal entry (path relative to the journal root). Dogfooding #3. */
  onOpenEntry?: (relativePath: string) => void;
}

export function DiffScreenV2({ projectId, projectRoot, branch, onOpenEntry }: DiffScreenV2Props) {
  const { t } = useT();
  const { state, setState } = useWorkspace();
  const { diffReadPaths, diffMode } = state;
  const { settings } = useSettings();

  const list = useDiffChanges(projectId);
  const { changes, baseline, lastCommit, lastCommitChanges, workingChanges } = list;
  const file = useDiffFile(projectId, changes, baseline);
  const { selected, diff } = file;
  const search = useDiffSearch(projectId, selected, diffMode, diff);

  const setMode = (mode: DiffMode) =>
    setState((prev) => ({ ...prev, diffMode: mode }));

  // "검토 완료" — push the current file into diffReadPaths (deduped).
  const onMarkReviewed = useCallback(() => {
    if (!selected) return;
    setState((prev) =>
      prev.diffReadPaths.includes(selected)
        ? prev
        : { ...prev, diffReadPaths: [...prev.diffReadPaths, selected] },
    );
  }, [selected, setState]);

  // "모두 검토 완료" — mark every changed file reviewed at once (dogfooding #4).
  const onMarkAllReviewed = useCallback(() => {
    setState((prev) => {
      const merged = new Set(prev.diffReadPaths);
      for (const c of changes) merged.add(c.path);
      return merged.size === prev.diffReadPaths.length
        ? prev
        : { ...prev, diffReadPaths: [...merged] };
    });
  }, [setState, changes]);

  const onOpenEditor = useCallback(async () => {
    if (!selected || !projectRoot) return;
    const res = await commands.openInEditor(projectRoot, selected, settings.externalEditorCommand, null);
    if (res.status === "error") toast.destructive(t("diff.editorFailed", { error: res.error }));
  }, [projectRoot, selected, settings.externalEditorCommand, t]);

  const onOpenAffected = useCallback(
    async (path: string) => {
      if (!projectRoot) return;
      const res = await commands.openInEditor(projectRoot, path, settings.externalEditorCommand, null);
      if (res.status === "error") toast.destructive(t("diff.editorFailed", { error: res.error }));
    },
    [projectRoot, settings.externalEditorCommand, t],
  );

  const reviewed = selected ? diffReadPaths.includes(selected) : false;
  const allReviewed =
    changes.length > 0 && changes.every((c) => diffReadPaths.includes(c.path));

  return (
    <>
      <Toolbar
        title={t("nav.diff")}
        sub={
          <span>
            {baseline === "last_commit" ? (
              <>
                {t("diff.lastCommit")} <span className="mono">{lastCommit?.short_sha}</span>
                {lastCommit?.subject ? ` · ${lastCommit.subject}` : ""}
              </>
            ) : (
              <>
                {branch ? <span className="mono">{branch}</span> : null}
                {branch ? " · " : ""}
                {t("diff.uncommittedFiles", { n: changes.length })}
              </>
            )}
          </span>
        }
      >
        {lastCommitChanges.length > 0 ? (
          <div className="diff-mode-toggle" title={t("diff.modeTitle")}>
            {(
              [
                ["working", `${t("diff.modeWorking")}${workingChanges.length ? ` ${workingChanges.length}` : ""}`],
                ["last_commit", t("diff.lastCommit")],
              ] as [DiffBaseline, string][]
            ).map(([b, label]) => (
              <button
                key={b}
                type="button"
                className="btn ghost sm"
                style={{
                  background: baseline === b ? "var(--accent-soft)" : "transparent",
                  color: baseline === b ? "var(--accent-text)" : "var(--text-2)",
                }}
                onClick={() => list.pinBaseline(b)}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
        <div className="diff-mode-toggle">
          {(["unified", "split"] as DiffMode[]).map((m) => (
            <button
              key={m}
              type="button"
              className="btn ghost sm"
              style={{
                background: diffMode === m ? "var(--accent-soft)" : "transparent",
                color: diffMode === m ? "var(--accent-text)" : "var(--text-2)",
              }}
              onClick={() => setMode(m)}
            >
              {m === "unified" ? t("diff.viewUnified") : t("diff.viewSplit")}
            </button>
          ))}
        </div>
        <button
          className="btn ghost"
          onClick={() =>
            requestAgentContext({
              kind: "createRule",
              seed: {
                paths: ruleGlobsFromPaths(changes.map((c) => c.path)),
                body: t("ctx.promote.seedFrom", {
                  source: changes.map((c) => `\`${c.path}\``).slice(0, 8).join(", "),
                }),
              },
            })
          }
          disabled={changes.length === 0}
          title={t("ctx.promote.ruleTitle")}
        >
          <ShieldCheck size={15} /> {t("ctx.promote.diffRule")}
        </button>
        <button
          className="btn ghost"
          onClick={onMarkAllReviewed}
          disabled={changes.length === 0 || allReviewed}
          title={t("diff.markAllTitle")}
        >
          <CheckMark size={15} /> {t("diff.markAll")}
        </button>
        <button
          className="btn primary"
          onClick={onMarkReviewed}
          disabled={!selected || reviewed}
        >
          <CheckMark size={15} /> {reviewed ? t("diff.isReviewed") : t("diff.reviewed")}
        </button>
      </Toolbar>

      {changes.length === 0 ? (
        <div className="scroll">
          <div className={"page" + (list.listLoading ? "" : " fade-in")}>
            {/* 세 상태를 가른다: 아직 모름 / 못 물어봄 / 정말 없음. */}
            {list.listLoading ? (
              <SkeletonList rows={4} height={44} />
            ) : list.listError ? (
              <ErrorCard title={t("diff.listFailed")} error={list.listError} onRetry={list.retryList} />
            ) : (
              /* 직전 커밋으로 가는 길을 글이 아니라 버튼으로 (v3-surface). */
              <EmptyState
                density="rich"
                icon={GitBranchIcon}
                title={t("diff.emptyTitle")}
                actions={
                  list.hasLastCommit ? (
                    <button className="btn primary sm" onClick={() => list.pinBaseline("last_commit")}>
                      {t("diff.lastCommit")}
                    </button>
                  ) : null
                }
              >
                {list.hasLastCommit ? t("diff.emptyWorking") : t("diff.emptyBranch")}
              </EmptyState>
            )}
          </div>
        </div>
      ) : (
        <div className="diff-screen">
          {/* Left: file list — grouped by the journal entry / plan that
              recorded each change (Dogfooding #3), with a flat fallback.
              접힘 · 필터 · 경로 접기는 DiffFileList 가 소유한다. */}
          <DiffFileList
            changes={changes}
            groups={list.groups}
            selected={selected}
            reviewedPaths={diffReadPaths}
            impact={list.impact}
            onSelect={file.select}
            onOpenEntry={onOpenEntry}
            onToggleVerified={(path, next) => void list.toggleVerified(path, next)}
            onOpenAffected={onOpenAffected}
          />

          {/* Right: diff body */}
          <div className="diff-main">
            {list.enrichError ? (
              <ErrorCard
                title={t("diff.enrichFailed")}
                error={list.enrichError}
                onRetry={list.retryEnrich}
                style={{ margin: 12 }}
              />
            ) : null}
            <div className="diff-bar">
              <FileCode2 size={15} color="var(--text-2)" />
              <span className="fname">{selected ?? "—"}</span>
              {file.current ? (
                <span className="chip" style={{ height: 20 }}>
                  {file.current.op === "A"
                    ? t("diff.opAdded")
                    : file.current.op === "D"
                      ? t("diff.opDeleted")
                      : t("diff.opModified")}
                </span>
              ) : null}
              {file.stats ? (
                <span className="diff-stat" title={t("diff.statsTitle")}>
                  <span className="add">+{file.stats.add}</span>
                  <span className="del">−{file.stats.del}</span>
                </span>
              ) : null}
              <span style={{ flex: 1 }} />
              {/* v2 U8 — in-diff 검색. Enter/n=다음, Shift+Enter/N=이전, Esc=해제 */}
              <div className="diff-search">
                <input
                  ref={search.searchInputRef}
                  value={search.query}
                  onChange={(e) => search.setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      search.jumpMatch(e.shiftKey ? -1 : 1);
                    } else if (e.key === "Escape") {
                      search.setQuery("");
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  placeholder={t("diff.searchPlaceholder")}
                  aria-label={t("diff.searchAria")}
                  spellCheck={false}
                />
                {search.matchPos ? (
                  <span className="diff-search-count">
                    {search.matchPos.total === 0
                      ? t("diff.noMatches")
                      : `${search.matchPos.idx}/${search.matchPos.total}`}
                  </span>
                ) : null}
              </div>
              <button
                className="iconbtn"
                title={t("diff.openEditor")}
                onClick={onOpenEditor}
                disabled={!selected}
                aria-label={t("diff.openEditor")}
              >
                <ExternalLinkIcon size={15} />
              </button>
            </div>

            <div className="diff-code" ref={search.diffCodeRef}>
              {file.loading ? (
                <EmptyState>
                  <Loader size={15} /> {t("diff.computing")}
                </EmptyState>
              ) : file.error ? (
                // 「다시 시도」 버튼이 안 그려지고 있었다 — ErrorCard 는 onRetry 가
                // 있어야 버튼을 낸다.
                <ErrorCard title={t("diff.failed")} error={file.error} style={{ margin: 16 }}
                  onRetry={file.retry} />
              ) : diff ? (
                <DiffBody
                  result={diff}
                  mode={diffMode}
                  newFilePatch={file.newFilePatch}
                  newFileError={file.newFileError}
                  deleted={file.current?.op === "D"}
                  baseline={baseline}
                  projectId={projectId}
                />
              ) : (
                <EmptyState>{t("diff.pickFile")}</EmptyState>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
