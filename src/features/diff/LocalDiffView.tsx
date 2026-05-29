/**
 * LocalDiffView — local diff browser for Watcher-observed changes
 * (Lite-W6 PR6.3, replacing the retired session-comparison modal).
 *
 * Spec: docs/Lite-update/05-index-comparison.md §2.
 *
 * Layout (renders inside the Workspace SidePanel — no modal, no overlay):
 *
 *   ┌─ 변경된 파일 ─ M개 ──────────────────────────┐
 *   │ [↻ 부분 reindex]   [unified ▾]              │
 *   ├──────────────────────────────────────────────┤
 *   │ ● LocalDiff…  M                              │
 *   │ ● diff.rs   A                                │
 *   ├──────────────────────────────────────────────┤
 *   │  12  import { useEffect } …                   │
 *   │  13- type Mode = "unified";                   │
 *   │  13+ type Mode = "unified" | "split";          │
 *   └──────────────────────────────────────────────┘
 *
 * Behaviour:
 *   - File list = `recentChanges` (Watcher-observed). Click picks a file.
 *   - Selected file's diff comes from `commands.computeDiff` — git path uses
 *     `git diff HEAD --`, non-git returns `SnapshotsUnavailable` (PR6.1 is
 *     deferred to 1.1, so we just render a placeholder).
 *   - The reindex button calls `commands.reindexPaths` for the *changed* set
 *     to refresh embeddings / AST so search hits reflect the new state.
 *
 * Out of scope (PR6.4 / PR6.5):
 *   - FileTree-dot click handoff (PR6.4) — for now the surface is reachable
 *     via ⌘B + SidePanel mode toggle + CommandPalette entry.
 *   - side-by-side rendering — PR6.5 (wide-viewport polish).
 *   - read/unread checkmarks — PR6.5.
 *   - "AI 에게 이 변경 설명" — PR6.5.
 */

import { useCallback, useEffect, useState } from "react";
import {
  commands,
  type DiffResult,
  type LocalDiffReindexReport,
} from "@/lib/bindings";
import {
  useWorkspace,
  type ChangeOp,
  type RecentChange,
} from "@/contexts/WorkspaceContext";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw } from "@/components/Icons";

const DIFF_MAX_BYTES = 64 * 1024;

interface LocalDiffViewProps {
  projectId: number;
}

export function LocalDiffView({ projectId }: LocalDiffViewProps) {
  const { state, clearRecentChanges } = useWorkspace();
  const { recentChanges } = state;

  // Pin the picked path locally — when the user clears the buffer or the
  // watcher pushes a new change, we keep them on the file they last opened
  // unless it falls out of the buffer entirely.
  const [selected, setSelected] = useState<string | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);

  const [reindexing, setReindexing] = useState(false);

  // Default the picked file to the most recent change. We reverse iterate so
  // the user lands on what they were just doing.
  useEffect(() => {
    if (recentChanges.length === 0) {
      setSelected(null);
      return;
    }
    const stillPresent =
      selected && recentChanges.some((c) => c.path === selected);
    if (!stillPresent) {
      setSelected(recentChanges[recentChanges.length - 1].path);
    }
  }, [recentChanges, selected]);

  // Fetch the diff every time the selected file changes. Cancel-safe so a
  // rapid pick-pick-pick doesn't leak previous results into the panel.
  useEffect(() => {
    if (!selected) {
      setDiff(null);
      setDiffError(null);
      return;
    }
    let cancelled = false;
    setDiffLoading(true);
    setDiffError(null);
    commands
      .computeDiff(projectId, selected, DIFF_MAX_BYTES)
      .then((res) => {
        if (cancelled) return;
        if (res.status === "ok") {
          setDiff(res.data);
        } else {
          setDiff(null);
          setDiffError(res.error);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setDiff(null);
          setDiffError(String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setDiffLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, selected]);

  const onReindex = useCallback(async () => {
    if (recentChanges.length === 0) return;
    setReindexing(true);
    const paths = Array.from(new Set(recentChanges.map((c) => c.path)));
    try {
      const res = await commands.reindexPaths(projectId, paths);
      if (res.status === "ok") {
        const r: LocalDiffReindexReport = res.data;
        toast.info(
          `재인덱스 완료: ${r.indexed.length} 파일 (${r.elapsed_ms} ms, embeddings ${r.embeddings_updated})`,
        );
      } else {
        toast.destructive(`재인덱스 실패: ${res.error}`);
      }
    } finally {
      setReindexing(false);
    }
  }, [projectId, recentChanges]);

  if (recentChanges.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 py-10 text-center text-xs text-muted-foreground select-none">
        <p className="font-medium mb-1">변경 없음</p>
        <p className="opacity-80">
          외부 LLM 이 파일을 수정하면 Watcher 가 감지하고 여기에 표시합니다.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header — context label + reindex + clear */}
      <div className="px-3 py-2 border-b border-border/80 shrink-0 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            변경된 파일 — {recentChanges.length}개
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={onReindex}
            disabled={reindexing}
            className="h-6 px-2 text-[10px] font-bold flex-1"
            title="변경된 파일 부분 reindex (chunk + AST + embeddings)"
          >
            {reindexing ? (
              <Loader2 className="w-2.5 h-2.5 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="w-2.5 h-2.5 mr-1" />
            )}
            부분 reindex
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={clearRecentChanges}
            className="h-6 px-2 text-[10px]"
            title="변경 목록 비우기 (baseline reset)"
          >
            비우기
          </Button>
        </div>
      </div>

      {/* File list — top section, capped height so the diff body always gets
          breathing room. */}
      <ul
        className="overflow-y-auto border-b border-border/60 scrollbar-thin"
        style={{ maxHeight: "30%" }}
      >
        {recentChanges
          .slice()
          .reverse()
          .map((c) => (
            <FileRow
              key={c.path}
              change={c}
              active={selected === c.path}
              onClick={() => setSelected(c.path)}
            />
          ))}
      </ul>

      {/* Diff body */}
      <div className="flex-1 overflow-y-auto bg-secondary/10 scrollbar-thin">
        {diffLoading ? (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
            diff 계산 중…
          </div>
        ) : diffError ? (
          <div className="p-3 text-xs text-destructive font-mono whitespace-pre-wrap">
            {diffError}
          </div>
        ) : diff ? (
          <DiffBody result={diff} />
        ) : selected ? (
          <div className="p-3 text-xs text-muted-foreground">
            파일을 선택했지만 결과가 없습니다.
          </div>
        ) : (
          <div className="p-3 text-xs text-muted-foreground">
            왼쪽에서 파일을 선택하세요.
          </div>
        )}
      </div>
    </div>
  );
}

function FileRow({
  change,
  active,
  onClick,
}: {
  change: RecentChange;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        onClick={onClick}
        className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors text-left cursor-pointer ${
          active
            ? "bg-primary/15 text-foreground font-medium"
            : "text-foreground/80 hover:bg-accent/40"
        }`}
      >
        <span
          aria-hidden
          className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
            active ? "bg-primary" : "bg-primary/60"
          }`}
        />
        <span className="truncate font-mono text-[11px]">{change.path}</span>
        <span
          className={`ml-auto text-[10px] font-bold tracking-wider shrink-0 ${badgeColor(
            change.op,
          )}`}
        >
          {change.op}
        </span>
      </button>
    </li>
  );
}

function badgeColor(op: ChangeOp): string {
  switch (op) {
    case "A":
      return "text-emerald-600 dark:text-emerald-400";
    case "M":
      return "text-amber-600 dark:text-amber-400";
    case "D":
      return "text-destructive";
  }
}

function DiffBody({ result }: { result: DiffResult }) {
  if (result.source.source === "snapshots_unavailable") {
    return (
      <div className="p-3 text-xs text-muted-foreground space-y-1">
        <p className="font-medium text-foreground/80">git 저장소가 아닙니다.</p>
        <p>
          비-git 프로젝트의 diff 는 1.1 에서 도입되는 file_snapshots fallback
          으로 지원됩니다. 1.0 은 git 저장소에 한해 diff 를 제공합니다.
        </p>
      </div>
    );
  }

  const patch = result.source.patch;
  if (!patch.trim()) {
    return (
      <div className="p-3 text-xs text-muted-foreground">
        변경 사항 없음 (HEAD 와 동일).
      </div>
    );
  }
  const lines = classifyDiffLines(patch);
  return (
    <pre className="p-3 text-[11px] font-mono leading-relaxed whitespace-pre-wrap">
      {lines.map((line, i) => (
        <span
          key={i}
          className={`block px-1 ${diffLineClass(line.kind)}`}
        >
          {line.text || " "}
        </span>
      ))}
    </pre>
  );
}

export type DiffLineKind =
  | "header"
  | "hunk"
  | "addition"
  | "deletion"
  | "context";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

/**
 * Classify each line of a git unified diff. Exported (pure) for unit
 * testing of the renderer's coloring rules.
 */
export function classifyDiffLines(patch: string): DiffLine[] {
  return patch.split("\n").map((text): DiffLine => {
    if (text.startsWith("diff --git ")) return { kind: "header", text };
    if (
      text.startsWith("index ") ||
      text.startsWith("--- ") ||
      text.startsWith("+++ ")
    ) {
      return { kind: "header", text };
    }
    if (text.startsWith("@@")) return { kind: "hunk", text };
    if (text.startsWith("+")) return { kind: "addition", text };
    if (text.startsWith("-")) return { kind: "deletion", text };
    return { kind: "context", text };
  });
}

function diffLineClass(kind: DiffLineKind): string {
  switch (kind) {
    case "header":
      return "text-muted-foreground/80 italic";
    case "hunk":
      return "text-primary/80 font-semibold bg-primary/5";
    case "addition":
      return "text-emerald-700 dark:text-emerald-300 bg-emerald-500/10";
    case "deletion":
      return "text-rose-700 dark:text-rose-300 bg-rose-500/10";
    case "context":
      return "text-foreground/70";
  }
}
