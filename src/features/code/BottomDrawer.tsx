import { Button } from "@/components/ui/button";
import { X, Terminal as TerminalIcon, GitBranch, Database } from "@/components/Icons";
import { TerminalPanel } from "@/features/terminal/TerminalPanel";
import { GitPanel } from "@/features/git/GitPanel";
import { useWorkspace, type BottomDrawerTab } from "@/contexts/WorkspaceContext";

// MASTER-GUIDE §5.6 — Code 화면 하단의 통합 드로워.
//   - Terminal: 기존 TerminalPanel (PiP 제거됨, Detach window 만 유지)
//   - Git: 기존 GitPanel (Changelog 탭 W4 에서 별도 화면으로 승격됨)
//   - Problems: LSP diagnostics — 후속 구현. 현 placeholder.
//
// `bottomDrawerOpen` / `bottomDrawerTab` 은 WorkspaceContext 가 보유.
// ⌘J 단축키로 열기/닫기 — `useGlobalShortcuts` 가 처리.

interface BottomDrawerProps {
  activeProjectId: number | null;
  projectRoot: string | null;
}

const TABS: Array<{ id: BottomDrawerTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "terminal", label: "Terminal", icon: TerminalIcon },
  { id: "git", label: "Git", icon: GitBranch },
  { id: "problems", label: "Problems", icon: Database },
];

export function BottomDrawer({ activeProjectId, projectRoot }: BottomDrawerProps) {
  const { state, setState } = useWorkspace();
  const { bottomDrawerOpen: open, bottomDrawerTab: tab } = state;

  function setTab(id: BottomDrawerTab) {
    setState((prev) => ({ ...prev, bottomDrawerTab: id, bottomDrawerOpen: true }));
  }
  function close() {
    setState((prev) => ({ ...prev, bottomDrawerOpen: false }));
  }

  return (
    <div
      className={`border-t border-border bg-secondary/15 transition-all duration-200 flex flex-col shrink-0 overflow-hidden ${
        open ? "h-72" : "h-9"
      }`}
    >
      {/* Tab bar — visible whether the drawer is collapsed or expanded.
          Clicking a tab while collapsed opens it directly to that tab. */}
      <div className="h-9 border-b border-border/60 flex items-center px-2 shrink-0 select-none">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = open && tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => (active ? close() : setTab(t.id))}
              className={`h-7 px-2.5 rounded-md text-[11px] font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                active
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
        <kbd className="ml-auto text-[10px] text-muted-foreground/70 font-mono mr-1">⌘J</kbd>
        {open && (
          <Button variant="ghost" size="sm" onClick={close} title="닫기 (⌘J)">
            <X className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>

      {open && (
        <div className="flex-1 min-h-0 overflow-hidden">
          {tab === "terminal" && (
            <TerminalPanel
              projectRoot={projectRoot}
              isPip={false}
              onTogglePip={() => {}}
              activeTab="terminal"
            />
          )}
          {tab === "git" && activeProjectId !== null && (
            <GitPanel projectId={activeProjectId} />
          )}
          {tab === "git" && activeProjectId === null && (
            <Placeholder text="프로젝트를 선택해주세요." />
          )}
          {tab === "problems" && (
            <Placeholder text="Problems — LSP 진단 통합은 후속 PR 입니다." />
          )}
        </div>
      )}
    </div>
  );
}

function Placeholder({ text }: { text: string }) {
  return (
    <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
      {text}
    </div>
  );
}
