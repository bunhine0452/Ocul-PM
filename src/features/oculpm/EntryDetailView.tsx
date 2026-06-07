import { useEffect, useMemo, useState } from "react";
import { Toolbar } from "@/components/Toolbar";
import { ArrowLeft, Bot, Clock, GitCompareArrows } from "@/components/Icons";
import { oculpmApi, OculpmApiError } from "@/api/oculpm";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { PatchView } from "@/features/diff/PatchView";
import { Markdown } from "@/components/Markdown";
import { TriggerBadge } from "./triggerMeta";
import { agentLabel } from "@/features/today/agentColor";
import { mapFileOpToChangeOp } from "@/contexts/WorkspaceContext";
import type { EntryFileDiff, JournalEntry, JournalEntrySummary } from "@/lib/bindings";

// 작업 일지 항목의 풍부한 열람 — 전용 화면(마스터-디테일). Dogfooding 2026-06-07:
// 모달(오버레이) 대신 콘텐츠 영역을 가득 채우는 디테일 뷰로 교체. 좌 pane 은
// 메타 + 변경 파일 목록(op 배지·경로 구분) + 일지 서술(body_markdown), 우 pane 은
// 그 시점에 기록된 unified-diff(PatchView). 서술의 첫 줄(제목)은 헤더와 중복되므로
// 제거한다.

interface EntryDetailViewProps {
  projectId: number;
  entry: JournalEntrySummary;
  onBack: () => void;
  /** Jump to the LIVE 변경 diff 화면 for this entry. */
  onOpenDiff: (entry: JournalEntrySummary) => void;
}

/** HH:MM from an ISO 8601 created_at string. */
function timeLabel(createdAt: string): string {
  const m = /T(\d{2}:\d{2})/.exec(createdAt);
  return m ? m[1] : "";
}

/**
 * Minimal distinguishing label per path: basename, unless two paths share a
 * basename (e.g. `adelie/config.py` vs `adelie/commands/config.py`), in which
 * case enough trailing segments are kept to disambiguate. Dogfooding #5.
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

/**
 * The journal body's first non-blank line is the entry title (with a `[ ]`/`[x]`
 * or `#` marker). The header already shows the title, so drop that line from the
 * narrative to avoid the duplicate. Only strips when it actually matches.
 */
function stripLeadingTitle(body: string, title: string): string {
  const lines = body.split("\n");
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (i >= lines.length) return body;
  const first = lines[i]
    .replace(/^#{1,6}\s*/, "")
    .replace(/^[-*]\s*/, "")
    .replace(/^\[[ xX]\]\s*/, "")
    .trim();
  if (first !== title.trim()) return body;
  const rest = lines.slice(i + 1);
  while (rest.length && rest[0].trim() === "") rest.shift();
  return rest.join("\n");
}

export function EntryDetailView({ projectId, entry, onBack, onOpenDiff }: EntryDetailViewProps) {
  const { state } = useWorkspace();
  const diffMode = state.diffMode;
  const [detail, setDetail] = useState<JournalEntry | null>(null);
  const [diffs, setDiffs] = useState<EntryFileDiff[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  // Esc → back to the list.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onBack();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    oculpmApi
      .getJournalEntry(projectId, entry.relative_path)
      .then((d) => {
        if (!cancelled && d) setDetail(d);
      })
      .catch(() => {
        /* narrative is best-effort */
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, entry.relative_path]);

  useEffect(() => {
    let cancelled = false;
    setDiffs(null);
    setError(null);
    setSelected(null);
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
  const labels = useMemo(() => {
    const all = new Set<string>([...files.map((f) => f.path), ...(diffs ?? []).map((d) => d.path)]);
    return disambiguateLabels([...all]);
  }, [files, diffs]);

  const active = useMemo(() => {
    if (!diffs || diffs.length === 0) return null;
    return diffs.find((d) => d.path === selected) ?? diffs[0];
  }, [diffs, selected]);

  const narrative = useMemo(
    () => (detail ? stripLeadingTitle(detail.body_markdown, entry.title || entry.slug) : ""),
    [detail, entry.title, entry.slug],
  );

  return (
    <>
      <Toolbar
        leading={
          <button type="button" className="iconbtn" onClick={onBack} aria-label="목록으로" title="목록으로 (Esc)">
            <ArrowLeft size={17} />
          </button>
        }
        title={entry.title || entry.slug}
        sub={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <TriggerBadge type={entry.type} />
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Bot size={12} /> {agentLabel(entry.agent_id)}
            </span>
            {timeLabel(entry.created_at) ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Clock size={11} /> {timeLabel(entry.created_at)}
              </span>
            ) : null}
          </span>
        }
      >
        <button className="btn ghost" onClick={() => onOpenDiff(entry)} title="변경 diff 화면에서 열기">
          <GitCompareArrows size={15} /> 변경 diff 화면
        </button>
      </Toolbar>

      <div className="entry-detail">
        {/* Left: meta + changed-file list + narrative */}
        <aside className="entry-detail-side">
          {entry.tags.length > 0 ? (
            <div className="flex flex-wrap gap-1" style={{ marginBottom: 14 }}>
              {entry.tags.map((t) => (
                <span className="tag" key={t}>
                  {t}
                </span>
              ))}
            </div>
          ) : null}

          {files.length > 0 ? (
            <div style={{ marginBottom: 16 }}>
              <div className="diff-files-head" style={{ padding: "0 0 8px" }}>
                변경된 파일 {files.length}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
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
                      className={"dfile" + (active?.path === f.path ? " active" : "")}
                      style={{ cursor: hasDiff ? "pointer" : "default", opacity: hasDiff ? 1 : 0.75 }}
                    >
                      <span className={"dstatus " + op}>{op}</span>
                      <span className="dfile-name">{labels[f.path] ?? f.path}</span>
                      {!hasDiff ? (
                        <span style={{ fontSize: 10, color: "var(--text-3)", flex: "none" }}>
                          {f.op === "delete" ? "삭제됨" : "기록없음"}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="entry-narrative">
            {detail == null ? (
              <span className="text-muted-foreground" style={{ fontSize: 12 }}>
                불러오는 중…
              </span>
            ) : narrative.trim() ? (
              <Markdown>{narrative}</Markdown>
            ) : (
              <span className="text-muted-foreground" style={{ fontSize: 12 }}>
                추가 서술이 없어요.
              </span>
            )}
          </div>
        </aside>

        {/* Right: recorded diff */}
        <section className="entry-detail-main">
          {diffs && diffs.length > 0 ? (
            <div className="entry-detail-tabs">
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

          <div className="diff-code">
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
    </>
  );
}
