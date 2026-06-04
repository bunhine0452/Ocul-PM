import { useCallback, useEffect, useRef, useState } from "react";
import { Toolbar } from "@/components/Toolbar";
import {
  FileCode2,
  ExternalLinkIcon,
  GitBranchIcon,
  CheckMark,
  Loader,
  TriangleAlert,
} from "@/components/Icons";
import { commands, type DiffResult } from "@/lib/bindings";
import { useWorkspace, type ChangeOp, type DiffMode } from "@/contexts/WorkspaceContext";
import { useSettings } from "@/contexts/SettingsContext";
import { toast } from "@/lib/toast";
import {
  classifyDiffLines,
  groupIntoHunks,
  pairDiffLines,
  type DiffLine,
} from "./diffParse";

// Final UI Update (ui_v2) — 변경 diff 전용 화면 (02-screen-specs §3). Wraps the
// EXISTING diff pipeline: file list = WorkspaceContext.recentChanges (Watcher
// buffer), body = commands.computeDiff, parsing = LocalDiffView's pure
// classifyDiffLines/groupIntoHunks/pairDiffLines (imported UNCHANGED so the
// Lite-W6 PR6.x safety-net tests keep covering them). The mockup .diff-screen
// 2-pane shell replaces the side-panel layout. flag-off LocalDiffView untouched.

const DIFF_MAX_BYTES = 64 * 1024;

function badgeLetter(op: ChangeOp): "A" | "M" | "D" {
  return op;
}

interface DiffScreenV2Props {
  projectId: number;
  /** Absolute project root — required by commands.openInEditor. */
  projectRoot: string | null;
  branch: string | null;
}

export function DiffScreenV2({ projectId, projectRoot, branch }: DiffScreenV2Props) {
  const { state, setState, markRecentChangeRead } = useWorkspace();
  const { recentChanges, diffActivePath, diffReadPaths, diffMode } = state;
  const { settings } = useSettings();

  // Selected file. Seed from diffActivePath (the journal-card → diff handoff
  // parked by PR-UI 3), else the most recent change.
  const [selected, setSelected] = useState<string | null>(diffActivePath);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const consumedHandoff = useRef(false);

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
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    commands
      .computeDiff(projectId, selected, DIFF_MAX_BYTES)
      .then((res) => {
        if (cancelled) return;
        if (res.status === "ok") setDiff(res.data);
        else {
          setDiff(null);
          setError(res.error);
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
          {/* Left: file list */}
          <div className="diff-files">
            <div className="diff-files-head">변경된 파일</div>
            {recentChanges
              .slice()
              .reverse()
              .map((c) => {
                const isReviewed = diffReadPaths.includes(c.path);
                return (
                  <button
                    type="button"
                    key={c.path}
                    className={"dfile" + (c.path === selected ? " active" : "")}
                    onClick={() => setSelected(c.path)}
                    aria-current={c.path === selected ? "true" : undefined}
                  >
                    <span className={"dstatus " + badgeLetter(c.op)}>{c.op}</span>
                    <span className="dfile-name">{c.path}</span>
                    {isReviewed ? (
                      <span className="dfile-read" title="검토 완료">
                        <CheckMark size={12} />
                      </span>
                    ) : null}
                  </button>
                );
              })}
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
                <DiffBody result={diff} mode={diffMode} />
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

function DiffBody({ result, mode }: { result: DiffResult; mode: DiffMode }) {
  if (result.source.source === "snapshots_unavailable") {
    return (
      <div className="empty-hint" style={{ textAlign: "left", padding: 16 }}>
        아직 baseline 이 없어요. 이 파일은 인덱싱된 적이 없어 비교 대상을 만들 수
        없습니다. 부분 reindex 후 이후 변경부터 diff 가 표시됩니다.
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
  const hunks = groupIntoHunks(classifyDiffLines(patch));

  return (
    <div>
      {hunks.map((h, hi) => (
        <Hunk key={hi} header={h.header?.text ?? null} lines={h.lines} mode={mode} />
      ))}
      <div className="diff-foot">
        <GitBranchIcon size={13} />
        이 diff는 {isSnapshot ? "로컬 스냅샷" : "git HEAD"} 기준입니다. 커밋 전 변경분을 검증하세요.
      </div>
    </div>
  );
}

function Hunk({
  header,
  lines,
  mode,
}: {
  header: string | null;
  lines: DiffLine[];
  mode: DiffMode;
}) {
  // The hunk's leading line is the @@ header itself (groupIntoHunks keeps it
  // in `lines`); render the body lines after it. Skip header/hunk-kind lines
  // in the row grid since the .hunk-head shows the @@ context.
  const body = lines.filter((l) => l.kind !== "hunk" && l.kind !== "header");
  return (
    <div>
      {header ? <div className="hunk-head">{header}</div> : null}
      {mode === "split" ? <SplitRows lines={body} /> : <UnifiedRows lines={body} />}
    </div>
  );
}

function UnifiedRows({ lines }: { lines: DiffLine[] }) {
  // Single gutter: additions show the new-side number, deletions the old-side,
  // context advances both and shows the new number. The actual base offsets
  // come from the @@ header, which we don't parse here — these are 1-based
  // within the hunk, matching the mockup's per-hunk numbering.
  let oldNo = 0;
  let newNo = 0;
  return (
    <>
      {lines.map((l, i) => {
        if (l.kind === "addition") {
          newNo++;
          return (
            <div className="dl add" key={i}>
              <span className="dl-gut">{newNo}</span>
              <span className="dl-x">{l.text || " "}</span>
            </div>
          );
        }
        if (l.kind === "deletion") {
          oldNo++;
          return (
            <div className="dl del" key={i}>
              <span className="dl-gut">{oldNo}</span>
              <span className="dl-x">{l.text || " "}</span>
            </div>
          );
        }
        oldNo++;
        newNo++;
        return (
          <div className="dl" key={i}>
            <span className="dl-gut">{newNo}</span>
            <span className="dl-x">{l.text || " "}</span>
          </div>
        );
      })}
    </>
  );
}

function SplitRows({ lines }: { lines: DiffLine[] }) {
  const rows = pairDiffLines(lines);
  return (
    <>
      {rows.map((row, i) => (
        <div className="dl split" key={i}>
          <span className="dl-gut">{row.left ? "·" : ""}</span>
          <span
            className={"dl-x" + (row.left ? "" : " empty")}
            style={
              row.left?.kind === "deletion"
                ? { background: "var(--diff-del-bg)", color: "var(--diff-del-text)" }
                : undefined
            }
          >
            {row.left ? row.left.text || " " : ""}
          </span>
          <span className="dl-gut">{row.right ? "·" : ""}</span>
          <span
            className={"dl-x" + (row.right ? "" : " empty")}
            style={
              row.right?.kind === "addition"
                ? { background: "var(--diff-add-bg)", color: "var(--diff-add-text)" }
                : undefined
            }
          >
            {row.right ? row.right.text || " " : ""}
          </span>
        </div>
      ))}
    </>
  );
}
