import { useCallback, useEffect, useState } from "react";

import { commands, type GitHeadStatusBrief } from "@/lib/bindings";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { GitBranch } from "./Icons";

/**
 * GitBranchChip — TitleBar mini indicator for the current git branch +
 * uncommitted line count. Lite-W6 PR7 Part 1 mounted this here against the
 * backend `git_head_status_brief` wrapper added in PR5. Part 2 adds the
 * "click → open Terminal in split mode" behaviour so the user can run
 * `git status` (or anything else) directly without leaving the activeView.
 *
 * Rendered states:
 *   - `null` projectId → nothing (no project selected)
 *   - non-git project → muted "(no git)" badge (still clickable so the user
 *     can drop into Terminal anyway)
 *   - git project → branch name + amber +N if uncommitted > 0
 *   - loading / error → the previous successful read stays visible so the
 *     chip doesn't flicker; errors collapse to a muted "(git error)".
 */
export function GitBranchChip({ projectId }: { projectId: number | null }) {
  const { setState: setWorkspaceState } = useWorkspace();
  const [state, setState] = useState<GitHeadStatusBrief | null>(null);
  const [errored, setErrored] = useState(false);

  const refresh = useCallback(async () => {
    if (projectId == null) {
      setState(null);
      setErrored(false);
      return;
    }
    const res = await commands.gitHeadStatusBrief(projectId);
    if (res.status === "ok") {
      setState(res.data);
      setErrored(false);
    } else {
      setErrored(true);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Cheap revalidation on focus — the user might have just committed in a
  // terminal and would expect the +N to drop without reopening the project.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [refresh]);

  if (projectId == null) return null;

  // PR7 Part 2: clicking the chip surfaces the Terminal in split mode and
  // refreshes the brief so the badge resyncs after the user runs a command.
  const openTerminalSplit = () => {
    setWorkspaceState((p) => ({ ...p, layoutMode: "split" }));
    void refresh();
  };

  if (errored) {
    return (
      <ChipShell
        title="git_head_status_brief 호출 실패 — 클릭으로 Terminal 열기"
        onClick={openTerminalSplit}
      >
        <GitBranch className="w-3 h-3" />
        <span className="text-muted-foreground">(git error)</span>
      </ChipShell>
    );
  }

  if (state == null) {
    return (
      <ChipShell title="git 상태 불러오는 중…">
        <GitBranch className="w-3 h-3 opacity-60" />
      </ChipShell>
    );
  }

  if (!state.is_git_repo) {
    return (
      <ChipShell
        title="git 저장소가 아님 — 클릭으로 Terminal 열기"
        onClick={openTerminalSplit}
      >
        <GitBranch className="w-3 h-3 opacity-60" />
        <span className="text-muted-foreground">(no git)</span>
      </ChipShell>
    );
  }

  const branchLabel = state.head_branch ?? "(detached)";
  const uncommitted = state.uncommitted;

  return (
    <ChipShell
      title={
        uncommitted > 0
          ? `${branchLabel} · ${uncommitted}개 미커밋 — 클릭으로 Terminal 열기`
          : `${branchLabel} · 클린 — 클릭으로 Terminal 열기`
      }
      onClick={openTerminalSplit}
    >
      <GitBranch className="w-3 h-3" />
      <span className="font-mono">{branchLabel}</span>
      {uncommitted > 0 && (
        // The "+N" badge re-uses the destructive accent so the chip can be
        // scanned at a glance without expanding the meaning of the
        // foreground colour token.
        <span
          className="ml-0.5 text-[10px] font-bold text-destructive"
          aria-label={`${uncommitted}개 미커밋`}
        >
          +{uncommitted}
        </span>
      )}
    </ChipShell>
  );
}

function ChipShell({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  const interactive = onClick != null;
  const className =
    "inline-flex items-center gap-1 px-2 h-6 rounded-md text-[11px] font-medium border border-border/60 bg-secondary/40 text-foreground/80 transition-colors";
  if (interactive) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        className={`${className} hover:bg-accent/50 cursor-pointer`}
      >
        {children}
      </button>
    );
  }
  return (
    <span title={title} className={className}>
      {children}
    </span>
  );
}
