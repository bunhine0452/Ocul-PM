import { useCallback, useEffect, useRef, useState } from "react";
import { Toolbar } from "@/components/Toolbar";
import {
  FileCode2,
  ExternalLinkIcon,
  GitBranchIcon,
  CheckMark,
  Loader,
  TriangleAlert,
  TargetIcon,
} from "@/components/Icons";
import { commands, type DiffResult, type ChangeGroup } from "@/lib/bindings";
import { useWorkspace, type ChangeOp, type DiffMode } from "@/contexts/WorkspaceContext";
import { useSettings } from "@/contexts/SettingsContext";
import { toast } from "@/lib/toast";
import { PatchView } from "./PatchView";
import { langFromPath } from "./diffParse";

// Final UI Update (ui_v2) — 변경 diff 전용 화면 (02-screen-specs §3). Wraps the
// EXISTING diff pipeline: file list = WorkspaceContext.recentChanges (Watcher
// buffer), body = commands.computeDiff, rendering = PatchView (which owns the
// markup over diffParse's pure classifyDiffLines/groupIntoHunks/pairDiffLines, so
// the Lite-W6 PR6.x safety-net tests keep covering the parsers). The mockup
// .diff-screen 2-pane shell replaces the side-panel layout. flag-off
// LocalDiffView untouched.

const DIFF_MAX_BYTES = 64 * 1024;

function badgeLetter(op: ChangeOp): "A" | "M" | "D" {
  return op;
}

/** Month/day for a change-group header (entries may span days). */
function groupDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
}

interface DiffScreenV2Props {
  projectId: number;
  /** Absolute project root — required by commands.openInEditor. */
  projectRoot: string | null;
  branch: string | null;
  /** Jump to a journal entry (path relative to the journal root). Dogfooding #3. */
  onOpenEntry?: (relativePath: string) => void;
}

export function DiffScreenV2({ projectId, projectRoot, branch, onOpenEntry }: DiffScreenV2Props) {
  const { state, setState, markRecentChangeRead } = useWorkspace();
  const { recentChanges, diffActivePath, diffReadPaths, diffMode } = state;
  const { settings } = useSettings();

  // Selected file. Seed from diffActivePath (the journal-card → diff handoff
  // parked by PR-UI 3), else the most recent change.
  const [selected, setSelected] = useState<string | null>(diffActivePath);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  // For a file with no git/snapshot baseline (untracked/new), the whole file
  // content rendered as an all-additions patch — so changes show immediately
  // instead of the "no baseline" prompt.
  const [newFilePatch, setNewFilePatch] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const consumedHandoff = useRef(false);
  // Latest recentChanges for use inside the fetch effect (which only depends on
  // projectId/selected) — lets us know a file's op (e.g. "D" = deleted) without
  // re-running the fetch on every watcher push.
  const recentChangesRef = useRef(recentChanges);
  recentChangesRef.current = recentChanges;

  // Dogfooding #3 — group the changed files by the journal entry (and linked
  // plan items) that recorded them. `null` until loaded / on error → the file
  // list falls back to the flat view.
  const [groups, setGroups] = useState<ChangeGroup[] | null>(null);
  const pathKey = recentChanges.map((c) => c.path).join("\n");
  useEffect(() => {
    if (recentChangesRef.current.length === 0) {
      setGroups(null);
      return;
    }
    let cancelled = false;
    const paths = recentChangesRef.current.map((c) => c.path);
    commands
      .oculpmGroupChanges(projectId, paths)
      .then((res) => {
        if (!cancelled) setGroups(res.status === "ok" ? res.data : null);
      })
      .catch(() => {
        if (!cancelled) setGroups(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, pathKey]);

  // Consume the one-shot diffActivePath handoff once, then clear it so a
  // later manual pick doesn't snap back. Mirrors LocalDiffView's diffTarget.
  useEffect(() => {
    if (consumedHandoff.current) return;
    consumedHandoff.current = true;
    if (diffActivePath) {
      setSelected(diffActivePath);
      setState((prev) => ({ ...prev, diffActivePath: null }));
    }
  }, [diffActivePath, setState]);

  // Default selection → most recent change; keep the pick if still present.
  useEffect(() => {
    if (recentChanges.length === 0) {
      setSelected(null);
      return;
    }
    setSelected((prev) => {
      if (prev && recentChanges.some((c) => c.path === prev)) return prev;
      return recentChanges[recentChanges.length - 1].path;
    });
  }, [recentChanges]);

  // Fetch diff for the selected file (cancel-safe).
  useEffect(() => {
    if (!selected) {
      setDiff(null);
      setNewFilePatch(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNewFilePatch(null);
    commands
      .computeDiff(projectId, selected, DIFF_MAX_BYTES)
      .then(async (res) => {
        if (cancelled) return;
        if (res.status !== "ok") {
          setDiff(null);
          setError(res.error);
          return;
        }
        setDiff(res.data);
        // No git/snapshot baseline (untracked or never-indexed file). Read the
        // file and show its whole content as additions, so the change is
        // visible right away instead of the "no baseline" prompt. A *deleted*
        // file has no disk content to read (and no baseline) — skip the read so
        // we don't trip "Failed to read … No such file"; DiffBody renders a
        // deleted-file notice instead.
        if (res.data.source.source === "snapshots_unavailable") {
          const op = recentChangesRef.current.find((c) => c.path === selected)?.op;
          if (op === "D") {
            setNewFilePatch(null);
          } else {
            const fileRes = await commands.readProjectFile(projectId, selected);
            if (cancelled) return;
            setNewFilePatch(
              fileRes.status === "ok"
                ? fileRes.data.split("\n").map((l) => "+" + l).join("\n")
                : null,
            );
          }
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setDiff(null);
          setError(String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, selected]);

  // Mark the change read once its body renders (mirrors LocalDiffView).
  useEffect(() => {
    if (!selected || loading || error || !diff) return;
    markRecentChangeRead(selected);
  }, [selected, diff, loading, error, markRecentChangeRead]);

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
      for (const c of prev.recentChanges) merged.add(c.path);
      return merged.size === prev.diffReadPaths.length
        ? prev
        : { ...prev, diffReadPaths: [...merged] };
    });
  }, [setState]);

  const onOpenEditor = useCallback(async () => {
    if (!selected || !projectRoot) return;
    const res = await commands.openInEditor(
      projectRoot,
      selected,
      settings.externalEditorCommand,
    );
    if (res.status === "error") toast.destructive(`에디터 열기 실패: ${res.error}`);
  }, [projectRoot, selected, settings.externalEditorCommand]);

  const cur = recentChanges.find((c) => c.path === selected) ?? null;
  const reviewed = selected ? diffReadPaths.includes(selected) : false;
  const allReviewed =
    recentChanges.length > 0 && recentChanges.every((c) => diffReadPaths.includes(c.path));

  // One file row in the left list (shared by the grouped + flat renders).
  const renderFile = (path: string) => {
    const op: ChangeOp = recentChanges.find((c) => c.path === path)?.op ?? "M";
    const isReviewed = diffReadPaths.includes(path);
    return (
      <button
        type="button"
        key={path}
        className={"dfile" + (path === selected ? " active" : "")}
        onClick={() => setSelected(path)}
        aria-current={path === selected ? "true" : undefined}
      >
        <span className={"dstatus " + badgeLetter(op)}>{op}</span>
        <span className="dfile-name">{path}</span>
        {isReviewed ? (
          <span className="dfile-read" title="검토 완료">
            <CheckMark size={12} />
          </span>
        ) : null}
      </button>
    );
  };

  return (
    <>
      <Toolbar
        title="변경 diff"
        sub={
          <span>
            {branch ? <span className="mono">{branch}</span> : null}
            {branch ? " · " : ""}
            {recentChanges.length}개 파일 변경
          </span>
        }
      >
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
              {m === "unified" ? "통합" : "분할"}
            </button>
          ))}
        </div>
        <button
          className="btn ghost"
          onClick={onMarkAllReviewed}
          disabled={recentChanges.length === 0 || allReviewed}
          title="변경된 모든 파일을 검토 완료로 표시"
        >
          <CheckMark size={15} /> 모두 검토 완료
        </button>
        <button
          className="btn primary"
          onClick={onMarkReviewed}
          disabled={!selected || reviewed}
        >
          <CheckMark size={15} /> {reviewed ? "검토함" : "검토 완료"}
        </button>
      </Toolbar>

      {recentChanges.length === 0 ? (
        <div className="scroll">
          <div className="page fade-in">
            <div className="empty-hint">
              이 브랜치엔 아직 변경이 없어요. 외부 LLM 이 파일을 수정하면
              Watcher 가 감지해 여기에 표시합니다.
            </div>
          </div>
        </div>
      ) : (
        <div className="diff-screen">
          {/* Left: file list — grouped by the journal entry / plan that
              recorded each change (Dogfooding #3), with a flat fallback. */}
          <div className="diff-files">
            <div className="diff-files-head">변경된 파일</div>
            {groups
              ? groups.map((g) => (
                  <div className="diff-group" key={g.entry_path ?? "__untracked"}>
                    <div className="diff-group-head">
                      {g.entry_path ? (
                        <button
                          type="button"
                          className="diff-group-title"
                          onClick={() => onOpenEntry?.(g.entry_path!)}
                          disabled={!onOpenEntry}
                          title={g.entry_title ?? g.entry_path}
                        >
                          {g.entry_title || g.entry_path}
                        </button>
                      ) : (
                        <span className="diff-group-title muted">미기록 변경</span>
                      )}
                      {g.created_at ? (
                        <span className="diff-group-time">{groupDate(g.created_at)}</span>
                      ) : null}
                    </div>
                    {g.plan_refs.length > 0 ? (
                      <div className="diff-group-plans">
                        {g.plan_refs.map((pr) => (
                          <span
                            className="tag"
                            key={pr.plan_id + "/" + pr.item_title}
                            title={`${pr.plan_title} · ${pr.item_title}`}
                          >
                            <TargetIcon size={10} /> {pr.plan_title}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {g.files.map((p) => renderFile(p))}
                  </div>
                ))
              : recentChanges
                  .slice()
                  .reverse()
                  .map((c) => renderFile(c.path))}
          </div>

          {/* Right: diff body */}
          <div className="diff-main">
            <div className="diff-bar">
              <FileCode2 size={15} color="var(--text-2)" />
              <span className="fname">{selected ?? "—"}</span>
              {cur ? (
                <span className="chip" style={{ height: 20 }}>
                  {cur.op === "A" ? "새 파일" : cur.op === "D" ? "삭제됨" : "수정됨"}
                </span>
              ) : null}
              <span style={{ flex: 1 }} />
              <button
                className="iconbtn"
                title="에디터에서 열기"
                onClick={onOpenEditor}
                disabled={!selected}
                aria-label="에디터에서 열기"
              >
                <ExternalLinkIcon size={15} />
              </button>
            </div>

            <div className="diff-code">
              {loading ? (
                <div className="empty-hint">
                  <Loader size={14} /> diff 계산 중…
                </div>
              ) : error ? (
                <div
                  className="empty-hint"
                  style={{ color: "var(--t-bug)", textAlign: "left", padding: 16 }}
                >
                  <TriangleAlert size={14} /> {error}
                </div>
              ) : diff ? (
                <DiffBody
                  result={diff}
                  mode={diffMode}
                  newFilePatch={newFilePatch}
                  deleted={cur?.op === "D"}
                />
              ) : (
                <div className="empty-hint">왼쪽에서 파일을 선택하세요.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── diff body — reuses LocalDiffView's pure parsers, renders mockup .dl rows ──

function DiffBody({
  result,
  mode,
  newFilePatch,
  deleted,
}: {
  result: DiffResult;
  mode: DiffMode;
  newFilePatch: string | null;
  deleted: boolean;
}) {
  if (result.source.source === "snapshots_unavailable") {
    // A deleted file with no baseline — nothing to diff, but don't error.
    if (deleted) {
      return (
        <div className="empty-hint" style={{ textAlign: "left", padding: 16 }}>
          이 파일은 삭제되었습니다.
          <br />
          <span className="text-muted-foreground" style={{ fontSize: 11 }}>
            (기록된 이전 내용이 없어 변경 내용을 표시할 수 없어요)
          </span>
        </div>
      );
    }
    // No baseline yet — render the file's whole content as additions so the
    // user sees the change immediately (untracked / never-indexed file).
    if (newFilePatch == null) {
      return (
        <div className="empty-hint" style={{ textAlign: "left", padding: 16 }}>
          파일을 읽는 중…
        </div>
      );
    }
    return (
      <div>
        <PatchView patch={newFilePatch} mode={mode} lang={langFromPath(result.path)} />
        <div className="diff-foot">
          <GitBranchIcon size={13} />
          아직 baseline 이 없는 새 파일이라 전체 내용을 표시합니다. (git 커밋 또는
          인덱싱 후엔 변경분만 표시)
        </div>
      </div>
    );
  }
  const patch = result.source.patch;
  const isSnapshot = result.source.source === "snapshot";
  if (!patch.trim()) {
    return (
      <div className="empty-hint" style={{ textAlign: "left", padding: 16 }}>
        변경 사항 없음 ({isSnapshot ? "스냅샷" : "HEAD"} 과 동일).
      </div>
    );
  }
  return (
    <div>
      <PatchView patch={patch} mode={mode} lang={langFromPath(result.path)} />
      <div className="diff-foot">
        <GitBranchIcon size={13} />
        이 diff는 {isSnapshot ? "로컬 스냅샷" : "git HEAD"} 기준입니다. 커밋 전 변경분을 검증하세요.
      </div>
    </div>
  );
}
