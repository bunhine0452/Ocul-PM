import { useEffect, useMemo, useState } from "react";
import { FileCode2, X, Bot, Clock } from "@/components/Icons";
import { oculpmApi, OculpmApiError } from "@/api/oculpm";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { PatchView } from "@/features/diff/PatchView";
import { Markdown } from "@/components/Markdown";
import { TriggerBadge } from "./triggerMeta";
import { agentLabel } from "@/features/today/agentColor";
import { mapFileOpToChangeOp } from "@/contexts/WorkspaceContext";
import type { EntryFileDiff, JournalEntry, JournalEntrySummary } from "@/lib/bindings";

// Final UI Update (ui_v2) — 작업 일지 항목의 풍부한 열람 모달.
//
// Dogfooding 2026-06-07: the journal card no longer shows per-file chips; the
// whole card opens THIS modal, which is now the entry's detail view. Two panes:
//  • 좌 — 서술(narrative): 메타 + 변경된 파일 목록(op 배지·경로 구분) + 일지 본문
//    (추가기능/동작흐름/검증/메모 섹션) 을 Markdown 으로 렌더.
//  • 우 — diff: 기록된 파일 탭 + 그 시점에 PERSIST 된 unified-diff (PatchView).
//
// Unlike the 변경 diff 화면 (which recomputes git/snapshot diffs *live*), the diff
// here is read from the per-file patches the watcher saved when the entry was
// first indexed (oculpm::entry_diffs), so a change is openable anytime — even
// after commits. Each pane is its own bounded scroll region, so a large file no
// longer clips the modal header.

interface EntryDiffModalProps {
  projectId: number;
  entry: JournalEntrySummary;
  /** The file the user clicked — pre-selected if it has a recorded diff. */
  initialFile: string | null;
  onClose: () => void;
}

/** HH:MM from an ISO 8601 created_at string. */
function timeLabel(createdAt: string): string {
  const m = /T(\d{2}:\d{2})/.exec(createdAt);
  return m ? m[1] : "";
}

/**
 * Minimal distinguishing label per path: just the basename, unless two paths
 * share a basename (e.g. `adelie/config.py` vs `adelie/commands/config.py`),
 * in which case enough trailing segments are kept to disambiguate. Dogfooding #5.
 */
function disambiguateLabels(paths: string[]): Record<string, string> {
  const byBase = new Map<string, string[]>();
  for (const p of paths) {
    const base = p.split("/").pop() ?? p;
    const list = byBase.get(base) ?? [];
    list.push(p);
    byBase.set(base, list);
  }
  const out: Record<string, string> = {};
  for (const [base, group] of byBase) {
    if (group.length === 1) {
      out[group[0]] = base;
      continue;
    }
    for (const p of group) {
      const twoSeg = p.split("/").slice(-2).join("/");
      const collides = group.filter((q) => q.split("/").slice(-2).join("/") === twoSeg).length > 1;
      out[p] = collides ? p : twoSeg;
    }
  }
  return out;
}

export function EntryDiffModal({ projectId, entry, initialFile, onClose }: EntryDiffModalProps) {
  const { state } = useWorkspace();
  const diffMode = state.diffMode;
  const [detail, setDetail] = useState<JournalEntry | null>(null);
  const [diffs, setDiffs] = useState<EntryFileDiff[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(initialFile);

  // Esc closes (mirrors ClarifyDialog).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Entry detail (body_markdown + files_touched) for the narrative pane.
  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    oculpmApi
      .getJournalEntry(projectId, entry.relative_path)
      .then((d) => {
        if (!cancelled && d) setDetail(d);
      })
      .catch(() => {
        /* narrative is best-effort; the diff pane still renders */
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, entry.relative_path]);

  // Recorded per-file diffs for the diff pane.
  useEffect(() => {
    let cancelled = false;
    setDiffs(null);
    setError(null);
    oculpmApi
      .getEntryDiffs(projectId, entry.relative_path)
      .then((d) => {
        if (!cancelled) setDiffs(d);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof OculpmApiError ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, entry.relative_path]);

  const files = detail?.frontmatter.files_touched ?? [];
  const recorded = useMemo(() => new Set((diffs ?? []).map((d) => d.path)), [diffs]);

  // One label map over every path we render (files_touched ∪ recorded diffs).
  const labels = useMemo(() => {
    const all = new Set<string>([...files.map((f) => f.path), ...(diffs ?? []).map((d) => d.path)]);
    return disambiguateLabels([...all]);
  }, [files, diffs]);

  // Active file: the clicked one if it was recorded, else the first recorded.
  const active = useMemo(() => {
    if (!diffs || diffs.length === 0) return null;
    return diffs.find((d) => d.path === selected) ?? diffs[0];
  }, [diffs, selected]);

  return (
    <div
      className="fixed inset-0 z-[85] bg-background/70 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-5xl max-h-[85vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
        aria-label={`${entry.title || entry.slug} 변경 기록`}
      >
        <header className="px-5 py-3 border-b border-border flex items-center gap-2 shrink-0">
          <FileCode2 className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-bold flex-1 truncate">
            {entry.title || entry.slug}{" "}
            <span className="text-muted-foreground font-normal">— 변경 기록</span>
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            title="닫기 (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 min-h-0 flex">
          {/* ── Left: narrative ── */}
          <aside className="w-[38%] max-w-[440px] shrink-0 border-r border-border overflow-auto p-4 flex flex-col gap-4">
            <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
              <TriggerBadge type={entry.type} />
              <span className="inline-flex items-center gap-1">
                <Bot size={13} /> {agentLabel(entry.agent_id)}
              </span>
              {timeLabel(entry.created_at) ? (
                <span className="inline-flex items-center gap-1">
                  <Clock size={12} /> {timeLabel(entry.created_at)}
                </span>
              ) : null}
            </div>

            {entry.tags.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {entry.tags.map((t) => (
                  <span className="tag" key={t}>
                    {t}
                  </span>
                ))}
              </div>
            ) : null}

            {files.length > 0 ? (
              <div>
                <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                  변경된 파일 {files.length}
                </div>
                <div className="flex flex-col gap-0.5">
                  {files.map((f) => {
                    const op = mapFileOpToChangeOp(f.op);
                    const hasDiff = recorded.has(f.path);
                    return (
                      <button
                        key={f.path}
                        type="button"
                        onClick={() => hasDiff && setSelected(f.path)}
                        disabled={!hasDiff}
                        title={f.path}
                        className={`flex items-center gap-2 text-xs rounded-md px-1.5 py-1 text-left ${
                          hasDiff
                            ? "hover:bg-accent/50 cursor-pointer"
                            : "cursor-default opacity-80"
                        } ${active?.path === f.path ? "bg-accent/60" : ""}`}
                      >
                        <span className={"dstatus " + op}>{op}</span>
                        <span className="font-mono truncate flex-1">{labels[f.path] ?? f.path}</span>
                        {!hasDiff ? (
                          <span className="text-[10px] text-muted-foreground shrink-0">
                            {f.op === "delete" ? "삭제됨" : "기록없음"}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="entry-narrative text-[13px] leading-relaxed min-w-0">
              {detail == null ? (
                <span className="text-muted-foreground text-xs">불러오는 중…</span>
              ) : detail.body_markdown.trim() ? (
                <Markdown>{detail.body_markdown}</Markdown>
              ) : (
                <span className="text-muted-foreground text-xs">본문 내용이 없어요.</span>
              )}
            </div>
          </aside>

          {/* ── Right: diff ── */}
          <section className="flex-1 min-w-0 flex flex-col">
            {diffs && diffs.length > 0 ? (
              <div className="px-4 py-2 border-b border-border flex flex-wrap gap-1.5 shrink-0">
                {diffs.map((d) => {
                  const isActive = active?.path === d.path;
                  return (
                    <button
                      key={d.path}
                      type="button"
                      onClick={() => setSelected(d.path)}
                      className={`px-2.5 py-1 rounded-md text-xs font-mono border transition-colors cursor-pointer ${
                        isActive
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border text-muted-foreground hover:text-foreground hover:bg-accent/40"
                      }`}
                      title={d.path}
                    >
                      {labels[d.path] ?? d.path.split("/").pop()}
                    </button>
                  );
                })}
              </div>
            ) : null}

            <div className="diff-code flex-1 min-h-0">
              {error ? (
                <div className="empty-hint" style={{ textAlign: "left", padding: 16 }}>
                  변경 기록을 불러오지 못했어요: {error}
                </div>
              ) : diffs == null ? (
                <div className="empty-hint" style={{ textAlign: "left", padding: 16 }}>
                  불러오는 중…
                </div>
              ) : diffs.length === 0 ? (
                <div className="empty-hint" style={{ textAlign: "left", padding: 16 }}>
                  이 일지에는 기록된 변경이 없어요.
                  <br />
                  <span className="text-muted-foreground" style={{ fontSize: 11 }}>
                    (이 기능 적용 전 일지이거나, git 저장소가 아니거나, 커밋 후 작성된 경우 — 왼쪽
                    서술로 변경 맥락을 확인하세요)
                  </span>
                </div>
              ) : active ? (
                <div>
                  <div className="hunk-head">{active.path}</div>
                  <PatchView patch={active.patch} mode={diffMode} />
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
