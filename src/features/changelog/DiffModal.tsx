import { useEffect, useMemo } from "react";
import { X, Copy, FileDiff } from "@/components/Icons";
import { Button } from "@/components/ui/button";
import type { ChangelogFileEntry } from "@/lib/bindings";

// MASTER-GUIDE §5.5 — "파일별 변경 행 클릭 → diff modal (라인 단위)".
//
// We render a unified diff with line-level coloring (additions = green,
// deletions = red, context = neutral). Hunk headers (`@@ -1,5 +1,5 @@`)
// are dimmed so the eye can find the next change quickly.
//
// No syntax highlighting yet — diff_patch arrives as raw unified-diff text
// (often truncated to 64KB per file, see `MAX_DIFF_BYTES` on the backend),
// and per-line tokenisation belongs in a follow-up (W7 polish).

interface DiffModalProps {
  file: ChangelogFileEntry | null;
  onClose: () => void;
}

export function DiffModal({ file, onClose }: DiffModalProps) {
  // Esc closes — matches the Settings/Palette overlays.
  useEffect(() => {
    if (!file) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [file, onClose]);

  const lines = useMemo(() => parseDiff(file?.diff_patch ?? null), [file?.diff_patch]);

  if (!file) return null;

  return (
    <div
      className="fixed inset-0 z-[95] bg-background/70 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-150">
        <header className="px-5 py-3 border-b border-border flex items-center gap-3 shrink-0">
          <FileDiff className="w-4 h-4 text-muted-foreground shrink-0" />
          <code className="font-mono text-xs flex-1 truncate" title={file.file_path}>
            {file.file_path}
          </code>
          <span className="text-[11px] tabular-nums text-muted-foreground shrink-0">
            +{file.lines_added} / -{file.lines_removed}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">
            {file.change_type}
          </span>
          {file.diff_patch && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigator.clipboard.writeText(file.diff_patch ?? "")}
              title="diff 전체 복사"
            >
              <Copy className="w-3.5 h-3.5" />
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onClose} title="닫기 (Esc)">
            <X className="w-4 h-4" />
          </Button>
        </header>

        {file.per_file_summary && (
          <div className="px-5 py-2.5 bg-secondary/30 border-b border-border text-xs text-muted-foreground shrink-0">
            {file.per_file_summary}
          </div>
        )}

        <div className="flex-1 overflow-auto scrollbar-thin font-mono text-[11px] leading-[1.55]">
          {lines.length === 0 ? (
            <EmptyDiff change_type={file.change_type} />
          ) : (
            <table className="w-full border-collapse">
              <tbody>
                {lines.map((line, i) => (
                  <DiffRow key={i} line={line} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Parsing ───────────────────────────────────────────────────────────

type DiffLineKind = "add" | "del" | "ctx" | "hunk" | "meta";
interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

function parseDiff(raw: string | null): DiffLine[] {
  if (!raw) return [];
  const out: DiffLine[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("@@")) out.push({ kind: "hunk", text: line });
    // The leading `+`/`-` markers `+++`/`---` are file headers, not diff lines.
    else if (line.startsWith("+++") || line.startsWith("---")) out.push({ kind: "meta", text: line });
    else if (line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("new file") || line.startsWith("deleted file"))
      out.push({ kind: "meta", text: line });
    else if (line.startsWith("+")) out.push({ kind: "add", text: line });
    else if (line.startsWith("-")) out.push({ kind: "del", text: line });
    else out.push({ kind: "ctx", text: line });
  }
  return out;
}

// ─── Row rendering ─────────────────────────────────────────────────────

function DiffRow({ line }: { line: DiffLine }) {
  const cls: Record<DiffLineKind, string> = {
    add: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    del: "bg-red-500/10 text-red-700 dark:text-red-300",
    ctx: "text-foreground/80",
    hunk: "bg-secondary/40 text-muted-foreground font-semibold",
    meta: "text-muted-foreground/70 italic",
  };
  const marker: Record<DiffLineKind, string> = {
    add: "+",
    del: "−",
    ctx: " ",
    hunk: " ",
    meta: " ",
  };

  // Strip the leading +/- since we render our own marker column.
  const body =
    line.kind === "add" || line.kind === "del" ? line.text.slice(1) : line.text;

  return (
    <tr className={cls[line.kind]}>
      <td className="w-6 select-none text-center text-muted-foreground/70 align-top">
        {marker[line.kind]}
      </td>
      <td className="px-2 whitespace-pre-wrap break-all align-top">{body}</td>
    </tr>
  );
}

function EmptyDiff({ change_type }: { change_type: string }) {
  let hint = "diff 본문이 비어있습니다.";
  if (change_type === "deleted") hint = "파일이 삭제되어 본문이 없습니다.";
  else if (change_type === "created") hint = "신규 파일 — 전체 내용이 added 로 표시되어야 합니다.";
  return (
    <div className="p-6 text-xs text-muted-foreground text-center">{hint}</div>
  );
}
