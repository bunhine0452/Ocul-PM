import { useEffect } from "react";
import { Toolbar } from "@/components/Toolbar";
import { SquareTerminal, Bot, Activity, Plus, X } from "@/components/Icons";
import { commands } from "@/lib/bindings";
import { useWorkspace, type TerminalTab } from "@/contexts/WorkspaceContext";
import { TerminalInstance } from "./TerminalInstance";

// Final UI Update (ui_v2) — 터미널 화면 (02-screen-specs §6). Mockup
// .term-wrap/.term-tabs/.term-screen visuals + the PTY wiring extracted from
// the legacy TerminalPanel (startPtySession / writeToPty / resizePty /
// killPtySession + listen pty-data). flag-off TerminalPanel/TerminalDock
// untouched. Tabs persist in WorkspaceContext.terminalTabs (PTY handles are
// volatile — re-spawned on mount).

function newTabId(): string {
  return Math.random().toString(36).slice(2, 10);
}

interface TerminalScreenV2Props {
  projectRoot: string | null;
}

export function TerminalScreenV2({ projectRoot }: TerminalScreenV2Props) {
  const { state, setState } = useWorkspace();
  const { terminalTabs, terminalActiveId } = state;

  // Ensure at least one tab exists.
  useEffect(() => {
    if (terminalTabs.length === 0) {
      const id = newTabId();
      const tab: TerminalTab = {
        id,
        label: "zsh",
        shell: "zsh",
        cwd: projectRoot ?? "",
      };
      setState((prev) => ({
        ...prev,
        terminalTabs: [tab],
        terminalActiveId: id,
      }));
    } else if (terminalActiveId == null || !terminalTabs.some((t) => t.id === terminalActiveId)) {
      setState((prev) => ({ ...prev, terminalActiveId: terminalTabs[0].id }));
    }
  }, [terminalTabs, terminalActiveId, projectRoot, setState]);

  const addTab = () => {
    const id = newTabId();
    const n = terminalTabs.length + 1;
    const tab: TerminalTab = { id, label: `zsh ${n}`, shell: "zsh", cwd: projectRoot ?? "" };
    setState((prev) => ({
      ...prev,
      terminalTabs: [...prev.terminalTabs, tab],
      terminalActiveId: id,
    }));
  };

  const closeTab = (id: string) => {
    void commands.killPtySession(id);
    setState((prev) => {
      const remaining = prev.terminalTabs.filter((t) => t.id !== id);
      const nextActive =
        prev.terminalActiveId === id
          ? (remaining[remaining.length - 1]?.id ?? null)
          : prev.terminalActiveId;
      return { ...prev, terminalTabs: remaining, terminalActiveId: nextActive };
    });
  };

  const selectTab = (id: string) =>
    setState((prev) => ({ ...prev, terminalActiveId: id }));

  // ⌘T new tab, ⌘W close active (screen-local).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() === "t") {
        e.preventDefault();
        e.stopPropagation();
        addTab();
      } else if (e.key.toLowerCase() === "w" && terminalActiveId) {
        e.preventDefault();
        e.stopPropagation();
        closeTab(terminalActiveId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalActiveId, terminalTabs]);

  return (
    <>
      <Toolbar title="터미널" sub="에이전트 실행을 감지해 자동으로 일지를 작성합니다">
        <span className="chip">
          <Activity size={13} color="var(--accent-text)" /> 변경 감시중
        </span>
        <button className="btn" onClick={addTab}>
          <Plus size={15} /> 새 세션
        </button>
      </Toolbar>

      <div className="term-wrap">
        <div className="term-tabs">
          {terminalTabs.map((t) => (
            <div
              key={t.id}
              className={"term-tab" + (t.id === terminalActiveId ? " active" : "")}
              onClick={() => selectTab(t.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") selectTab(t.id);
              }}
            >
              {t.label.includes("claude") || t.label.includes("cursor") ? (
                <Bot size={14} />
              ) : (
                <SquareTerminal size={14} />
              )}
              {t.label}
              <span
                className="term-tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(t.id);
                }}
                role="button"
                tabIndex={0}
                aria-label={`${t.label} 닫기`}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.stopPropagation();
                    closeTab(t.id);
                  }
                }}
              >
                <X size={12} />
              </span>
            </div>
          ))}
          <div className="term-watch">
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: "50%",
                background: "#57c98a",
                display: "inline-block",
              }}
            />
            .oculpm 감시중
          </div>
        </div>

        {/* Keep every tab's xterm mounted; CSS-hide inactive so PTY survives. */}
        {terminalTabs.map((t) => (
          <TerminalInstance
            key={t.id}
            sessionId={t.id}
            cwd={t.cwd || projectRoot || ""}
            visible={t.id === terminalActiveId}
          />
        ))}
      </div>
    </>
  );
}
