import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "xterm";
import { FitAddon } from "@xterm/addon-fit";
import "xterm/css/xterm.css";
import { Toolbar } from "@/components/Toolbar";
import { SquareTerminal, Bot, Activity, Plus, X } from "@/components/Icons";
import { commands } from "@/lib/bindings";
import { useWorkspace, type TerminalTab } from "@/contexts/WorkspaceContext";

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
          <TerminalInstanceV2
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

interface TerminalInstanceV2Props {
  sessionId: string;
  cwd: string;
  visible: boolean;
}

// Extracted from the legacy TerminalPanel's TerminalInstance — same PTY
// lifecycle (listen pty-data/exit → startPtySession → onData → write), inside
// the ui_v2 .term-screen shell.
//
// CRITICAL (dogfood fix, 2026-06-03): xterm measures the font cell on
// `term.open()`. If the container is `display:none` or 0×0 at that moment,
// `dimensions.css.cell.width` stays 0 — the renderer paints nothing (blank,
// no cursor) and FitAddon.fit() early-returns forever (it bails when
// css.cell.width === 0), so the terminal never recovers. The original opened
// on mount regardless of visibility, so an inactive-at-open tab stayed blank.
// Fix: defer `term.open()` until the container is actually visible + sized,
// and refit via a ResizeObserver. PTY output written before open is buffered
// by xterm and flushed on open, so no output is lost.
function TerminalInstanceV2({ sessionId, cwd, visible }: TerminalInstanceV2Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const openedRef = useRef(false);
  const cwdRef = useRef(cwd);
  useEffect(() => {
    cwdRef.current = cwd;
  }, [cwd]);

  // Create the Terminal + wire the PTY on mount. We do NOT open() here — output
  // buffers in xterm until the first open() once the tab is visible.
  useEffect(() => {
    const term = new Terminal({
      cursorBlink: true,
      allowProposedApi: true,
      fontFamily: '"SF Mono", "D2Coding", Menlo, monospace',
      fontSize: 12.5,
      theme: { background: "#1b1b1f", foreground: "#e8e8ea" },
      cols: 80,
      rows: 24,
    });
    termRef.current = term;
    const fit = new FitAddon();
    fitRef.current = fit;
    term.loadAddon(fit);

    // Refit whenever the container changes size — including the 0→N jump when
    // the tab goes display:none → block. No-op until opened + sized.
    const container = containerRef.current;
    const ro = new ResizeObserver(() => {
      if (!openedRef.current || !container) return;
      if (container.clientWidth === 0 || container.clientHeight === 0) return;
      try {
        fit.fit();
        void commands.resizePty(sessionId, term.rows, term.cols);
      } catch {
        /* renderer not ready — ignore */
      }
    });
    if (container) ro.observe(container);

    let unlistenData: (() => void) | null = null;
    let unlistenExit: (() => void) | null = null;
    void (async () => {
      try {
        unlistenData = await listen<string>(`pty-data-${sessionId}`, (e) => {
          term.write(e.payload);
        });
        unlistenExit = await listen<void>(`pty-exit-${sessionId}`, () => {
          term.write("\r\n\x1b[1;31m[프로세스 종료됨]\x1b[0m\r\n");
        });
        const res = await commands.startPtySession(sessionId, cwdRef.current, term.rows, term.cols);
        if (res.status === "error") {
          term.write(`\r\n\x1b[1;31m[PTY 시작 실패: ${res.error}]\x1b[0m\r\n`);
          return;
        }
        term.onData((data) => {
          void commands.writeToPty(sessionId, data);
        });
        // The visible-effect fit() and this spawn race within a few ms — sync
        // the PTY to xterm's (possibly already-fitted) size once started.
        void commands.resizePty(sessionId, term.rows, term.cols);
      } catch (err) {
        console.error("[TerminalScreenV2] setup failed:", err);
      }
    })();

    return () => {
      ro.disconnect();
      if (unlistenData) unlistenData();
      if (unlistenExit) unlistenExit();
      void commands.killPtySession(sessionId);
      term.dispose();
      termRef.current = null;
      openedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Open (once) + fit + focus when this tab becomes visible. Opening here — not
  // on mount — guarantees the container is painted with real dimensions so
  // xterm measures the font and actually renders.
  useEffect(() => {
    if (!visible) return;
    const id = window.setTimeout(() => {
      const container = containerRef.current;
      const term = termRef.current;
      if (!container || !term) return;
      if (container.clientWidth === 0 || container.clientHeight === 0) return;
      if (!openedRef.current) {
        term.open(container);
        openedRef.current = true;
      }
      try {
        fitRef.current?.fit();
        void commands.resizePty(sessionId, term.rows, term.cols);
      } catch {
        /* ignore */
      }
      term.focus();
    }, 0);
    return () => window.clearTimeout(id);
  }, [visible, sessionId]);

  return (
    <div
      className="term-screen"
      style={{ display: visible ? "block" : "none" }}
      ref={containerRef}
    />
  );
}
