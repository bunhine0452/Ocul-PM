import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { commands } from "@/lib/bindings";

// Shared PTY-backed terminal instance — used by the full 터미널 화면
// (TerminalScreenV2, tabbed) and the Today 빠른 터미널 (TodayTerminal). One PTY
// per sessionId; output buffers in xterm until the container is visible + sized
// (the 2026-06-03 blank-terminal fix is preserved here verbatim).
//
// Quality (icon round): a full 16-color ANSI palette tuned to the app's
// trigger/accent tones (was bg/fg only → ANSI fell back to xterm defaults), a
// brand-green cursor, 5k scrollback, macOptionIsMeta (Option as Meta), bold in
// bright colors, and a refined mono font stack.

const TERM_THEME = {
  background: "#16161c",
  foreground: "#e6e6ea",
  cursor: "#2bc488",
  cursorAccent: "#16161c",
  selectionBackground: "rgba(43,196,136,0.30)",
  black: "#16161c",
  red: "#f1685f",
  green: "#2bc488",
  yellow: "#e6c570",
  blue: "#6ea8fe",
  magenta: "#c79bf0",
  cyan: "#5fd5d0",
  white: "#d4d4d8",
  brightBlack: "#5b5b66",
  brightRed: "#ff8079",
  brightGreen: "#4fdca0",
  brightYellow: "#f2d98a",
  brightBlue: "#8fc0ff",
  brightMagenta: "#d9b6f7",
  brightCyan: "#86e6e1",
  brightWhite: "#f4f4f6",
} as const;

interface TerminalInstanceProps {
  sessionId: string;
  cwd: string;
  visible: boolean;
  fontSize?: number;
}

export default function TerminalInstanceImpl({ sessionId, cwd, visible, fontSize = 13 }: TerminalInstanceProps) {
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
      cursorStyle: "bar",
      cursorWidth: 2,
      allowProposedApi: true,
      // 한국어 입력 fix: D2Coding(번들 subset, 한글 2:1 고정폭)을 선두로 —
      // 라틴 우선(SF Mono)이면 한글 글리프가 시스템 고딕 폴백으로 렌더돼
      // 셀 폭(반각×2)과 어긋나 겹침/들쭉날쭉이 생긴다.
      fontFamily: '"D2Coding", "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace',
      fontSize,
      fontWeightBold: "600",
      lineHeight: 1.2,
      letterSpacing: 0,
      theme: TERM_THEME,
      scrollback: 5000,
      macOptionIsMeta: true,
      drawBoldTextInBrightColors: true,
      minimumContrastRatio: 1.5,
      smoothScrollDuration: 80,
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

    // isMounted guard — React 18 StrictMode mounts → unmounts → remounts in dev;
    // aborts the first run before it spawns an orphan PTY (dogfood fix).
    let isMounted = true;
    let unlistenData: (() => void) | null = null;
    let unlistenExit: (() => void) | null = null;
    void (async () => {
      try {
        unlistenData = await listen<string>(`pty-data-${sessionId}`, (e) => {
          if (isMounted) term.write(e.payload);
        });
        if (!isMounted) return;
        unlistenExit = await listen<void>(`pty-exit-${sessionId}`, () => {
          if (isMounted) term.write("\r\n\x1b[1;31m[프로세스 종료됨]\x1b[0m\r\n");
        });
        if (!isMounted) return;
        const res = await commands.startPtySession(sessionId, cwdRef.current, term.rows, term.cols);
        if (!isMounted) return;
        if (res.status === "error") {
          term.write(`\r\n\x1b[1;31m[PTY 시작 실패: ${res.error}]\x1b[0m\r\n`);
          return;
        }
        term.onData((data) => {
          void commands.writeToPty(sessionId, data);
        });
        void commands.resizePty(sessionId, term.rows, term.cols);
      } catch (err) {
        console.error("[TerminalInstance] setup failed:", err);
      }
    })();

    return () => {
      isMounted = false;
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

  // Open (once) + fit + focus when visible — guarantees real dimensions so
  // xterm measures the font and renders (the blank-terminal fix).
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
