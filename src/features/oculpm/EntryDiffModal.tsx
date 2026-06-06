import { useEffect, useMemo, useState } from "react";
import { FileCode2, X } from "@/components/Icons";
import { oculpmApi, OculpmApiError } from "@/api/oculpm";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { PatchView } from "@/features/diff/PatchView";
import type { EntryFileDiff, JournalEntrySummary } from "@/lib/bindings";

// Final UI Update (ui_v2) — 작업 일지 "그 시점의 변경" 열람 모달.
//
// Unlike the 변경 diff 화면 (which recomputes git/snapshot diffs *live* and so
// loses a change once it's committed), this reads the per-file patches the
// watcher PERSISTED when the entry was first indexed (oculpm_get_entry_diffs →
// oculpm::entry_diffs sidecar). So a file's recorded change is openable anytime,
// even after further edits / commits. Going-forward only: entries written before
// this feature, non-git projects, or entries authored after committing render as
// "기록된 변경 없음". Rendering reuses the shared PatchView (same markup as the
// diff screen).

interface EntryDiffModalProps {
  projectId: number;
  entry: JournalEntrySummary;
  /** The file chip the user clicked — pre-selected if it has a recorded diff. */
  initialFile: string | null;
  onClose: () => void;
}

export function EntryDiffModal({ projectId, entry, initialFile, onClose }: EntryDiffModalProps) {
  const { state } = useWorkspace();
  const diffMode = state.diffMode;
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
        className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
        aria-label={`${entry.title || entry.slug} 변경 기록`}
      >
        <header className="px-5 py-3 border-b border-border flex items-center gap-2 shrink-0">
          <FileCode2 className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-bold flex-1 truncate">
            {entry.title || entry.slug} <span className="text-muted-foreground font-normal">— 변경 기록</span>
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            title="닫기 (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

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
                  {d.path.split("/").pop()}
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
                (이 기능 적용 전 일지이거나, git 저장소가 아니거나, 커밋 후 작성된 경우)
              </span>
            </div>
          ) : active ? (
            <div>
              <div className="hunk-head">{active.path}</div>
              <PatchView patch={active.patch} mode={diffMode} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
