import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import "@xterm/xterm/css/xterm.css";
import { commands } from "@/lib/bindings";

// Shared PTY-backed terminal instance — used by the full 터미널 화면
// (TerminalScreenV2, 탭+분할 페인) and the Today 빠른 터미널 (TodayTerminal).
//
// 2026-07-20 터미널 개편:
//  - `persistent` 세션: unmount 에도 PTY 를 죽이지 않고, 재마운트 시
//    `attachPtySession` 스냅샷(스크롤백 리플레이) + seq 로 라이브 이벤트
//    중복을 걸러 이어붙인다. 이벤트 페이로드는 {seq, text} 로 바뀌었다.
//  - Unicode11 폭 테이블(한글·이모지 셀 폭), WebLinks(URL ⌘클릭 → 기본
//    브라우저), Search 애드온. onReady 로 화면에 Terminal/Search 핸들 전달.
//  - fontSize 라이브 변경 (⌘+/⌘-).
// (2026-06-03 blank-terminal fix — visible+sized 이후에만 open() — 유지.)

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

export interface TerminalHandles {
  term: Terminal;
  search: SearchAddon;
}

interface TerminalInstanceProps {
  sessionId: string;
  cwd: string;
  visible: boolean;
  fontSize?: number;
  /** true 면 unmount 시 PTY 를 유지 (탭/페인 닫기에서만 명시적으로 kill). */
  persistent?: boolean;
  /** visible 전환 시 자동 포커스 여부 (분할 페인에선 포커스 페인만 true). */
  autoFocus?: boolean;
  /** xterm open 직후 1회 — 화면이 검색/포커스 제어에 쓸 핸들 전달. */
  onReady?: (handles: TerminalHandles) => void;
  /** 이 페인(컨테이너)으로 포커스가 들어올 때. */
  onFocusIn?: () => void;
}

export default function TerminalInstanceImpl({
  sessionId,
  cwd,
  visible,
  fontSize = 13,
  persistent = false,
  autoFocus = true,
  onReady,
  onFocusIn,
}: TerminalInstanceProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const openedRef = useRef(false);
  const cwdRef = useRef(cwd);
  const persistentRef = useRef(persistent);
  const autoFocusRef = useRef(autoFocus);
  const onReadyRef = useRef(onReady);
  const onFocusInRef = useRef(onFocusIn);
  useEffect(() => {
    cwdRef.current = cwd;
    persistentRef.current = persistent;
    autoFocusRef.current = autoFocus;
    onReadyRef.current = onReady;
    onFocusInRef.current = onFocusIn;
  }, [cwd, persistent, autoFocus, onReady, onFocusIn]);

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
    // 한글/이모지 셀 폭 정확도 — Unicode 11 폭 테이블 활성화.
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = "11";
    // URL 클릭 → 시스템 브라우저 (opener 권한 우회: 백엔드 open_url 사용).
    term.loadAddon(
      new WebLinksAddon((_event, uri) => {
        void commands.openUrl(uri);
      }),
    );
    const search = new SearchAddon();
    searchRef.current = search;
    term.loadAddon(search);

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

    // 페인 포커스 추적 — xterm textarea 로 들어오는 focusin 을 컨테이너에서 수신.
    const handleFocusIn = () => onFocusInRef.current?.();
    container?.addEventListener("focusin", handleFocusIn);

    // isMounted guard — React 18 StrictMode mounts → unmounts → remounts in dev;
    // aborts the first run before it spawns an orphan PTY (dogfood fix).
    let isMounted = true;
    let unlistenData: (() => void) | null = null;
    let unlistenExit: (() => void) | null = null;
    void (async () => {
      try {
        // attach 스냅샷이 리플레이되기 전 도착한 라이브 청크는 큐에 쌓았다가
        // seq 로 걸러 이어붙인다 (중복/유실 없는 재접속).
        let attached = false;
        let lastSeq = 0;
        const queued: { seq: number; text: string }[] = [];
        unlistenData = await listen<{ seq: number; text: string }>(
          `pty-data-${sessionId}`,
          (e) => {
            if (!isMounted) return;
            if (!attached) queued.push(e.payload);
            else term.write(e.payload.text);
          },
        );
        if (!isMounted) return;
        unlistenExit = await listen<void>(`pty-exit-${sessionId}`, () => {
          if (isMounted) term.write("\r\n\x1b[1;31m[프로세스 종료됨]\x1b[0m\r\n");
        });
        if (!isMounted) return;

        const at = await commands.attachPtySession(sessionId);
        if (!isMounted) return;
        if (at.status === "ok" && at.data) {
          // 살아있는 세션 재접속 — 스크롤백 리플레이.
          lastSeq = at.data.seq;
          if (at.data.text) term.write(at.data.text);
        } else {
          const res = await commands.startPtySession(sessionId, cwdRef.current, term.rows, term.cols);
          if (!isMounted) return;
          if (res.status === "error") {
            term.write(`\r\n\x1b[1;31m[PTY 시작 실패: ${res.error}]\x1b[0m\r\n`);
            return;
          }
        }
        attached = true;
        for (const chunk of queued) {
          if (chunk.seq > lastSeq) term.write(chunk.text);
        }
        queued.length = 0;

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
      container?.removeEventListener("focusin", handleFocusIn);
      if (unlistenData) unlistenData();
      if (unlistenExit) unlistenExit();
      // persistent 세션은 백엔드에 남긴다 — 탭/페인 닫기가 명시적으로 kill.
      if (!persistentRef.current) void commands.killPtySession(sessionId);
      term.dispose();
      termRef.current = null;
      openedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // fontSize 라이브 반영 (⌘+/⌘-) — 열린 뒤엔 refit + PTY resize 까지.
  useEffect(() => {
    const term = termRef.current;
    if (!term || term.options.fontSize === fontSize) return;
    term.options.fontSize = fontSize;
    if (openedRef.current) {
      try {
        fitRef.current?.fit();
        void commands.resizePty(sessionId, term.rows, term.cols);
      } catch {
        /* ignore */
      }
    }
  }, [fontSize, sessionId]);

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
        const search = searchRef.current;
        if (search) onReadyRef.current?.({ term, search });
      }
      try {
        fitRef.current?.fit();
        void commands.resizePty(sessionId, term.rows, term.cols);
      } catch {
        /* ignore */
      }
      if (autoFocusRef.current) term.focus();
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
