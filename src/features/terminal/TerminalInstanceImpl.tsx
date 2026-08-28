import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import "@xterm/xterm/css/xterm.css";
import { takeBootCommand } from "./terminalLaunch";
import { commands } from "@/lib/bindings";
import { oculpmLog } from "@/lib/oculpmLog";
// 모듈 t() — 이 두 문구는 PTY 이벤트 시점에 터미널 버퍼로 **써 넣는** 것이라
// 리렌더와 무관하다. 이미 쓰인 줄은 언어를 바꿔도 소급되지 않는 게 맞다.
import { t } from "@/i18n";
import { attachImeBridge, type ImeBridgeHandle } from "./imeBridge";
import { nextRevealState, resyncViewport } from "./viewportResync";
import { observeTerminalTheme, readTerminalTheme } from "./termTheme";
import {
  initialShellState,
  parseOsc133,
  parseOsc7,
  reduceShellState,
  type ShellState,
} from "./oscShell";
import { scanFileRefs } from "./fileLinks";
import { emptyPaneSignal, type PaneSignal } from "./agentMode";

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
//
// 2026-07-30 품질 라운드:
//  - 한글 IME: 조합 처리를 xterm CompositionHelper 에서 회수 (→ imeBridge.ts).
//  - 렌더러: WebGL 로 승격. DOM 렌더러는 실제 텍스트 레이아웃을 쓰기 때문에
//    폴백 글리프의 폭이 셀과 다르면 그 줄 전체가 밀리고, 출력이 많을 때 눈에
//    띄게 버벅였다. 미지원/컨텍스트 소실이면 DOM 렌더러로 되돌아간다.
//  - 폰트: 라틴·기호·박스문자는 Menlo, 한글은 'D2Coding Term' (App.css 에서
//    unicode-range 로 한글에만 끼어드는 페이스).
//  - 테마: TERM_THEME 상수 제거 — tokens.css 의 `--term-*` 에서 파생 (→ termTheme.ts).
//
// 2026-08-01: 한글이 라틴·숫자보다 크게 보이던 문제 수정. 두 셀 폭을 맞추던
// CSS size-adjust(120.4%)가 advance 와 함께 글리프까지 20.4% 확대하고 있었다.
// 폰트 파일의 advance 를 Menlo 그리드로 재작성해(scripts/build-d2coding-subset.py)
// size-adjust 없이 두 셀에 맞춘다 — 글리프는 원본 크기 그대로.

// 라틴·기호·박스문자(█ ▀ ● ✓ 포함)는 Menlo 가 전 범위를 0.6021em 로 커버한다.
// 한글은 'D2Coding Term' 이 unicode-range 로만 끼어들어 정확히 두 셀을 채운다.
// (D2Coding 을 선두에 두면 서브셋에 없는 글리프가 폴백으로 새면서 줄이 밀린다.)
const TERM_FONT = 'Menlo, "D2Coding Term", "SF Mono", ui-monospace, monospace';

const SCROLLBACK_LINES = 20000;

export interface TerminalHandles {
  term: Terminal;
  search: SearchAddon;
}

interface TerminalInstanceProps {
  sessionId: string;
  cwd: string;
  visible: boolean;
  fontSize?: number;
  /**
   * 줄 높이 배수 — 밀도 프리셋(`density.ts`)이 정한다. 글자 크기와 다른 축이라
   * 따로 받는다: 크기는 "읽히는가", 줄 높이는 "숨 쉴 자리가 있는가".
   */
  lineHeight?: number;
  /** true 면 unmount 시 PTY 를 유지 (탭/페인 닫기에서만 명시적으로 kill). */
  persistent?: boolean;
  /** visible 전환 시 자동 포커스 여부 (분할 페인에선 포커스 페인만 true). */
  autoFocus?: boolean;
  /** xterm open 직후 1회 — 화면이 검색/포커스 제어에 쓸 핸들 전달. */
  onReady?: (handles: TerminalHandles) => void;
  /** 이 페인(컨테이너)으로 포커스가 들어올 때. */
  onFocusIn?: () => void;
  /** 셸이 OSC 0/2 로 알려온 제목 — 탭 자동 이름에 쓴다. */
  onTitleChange?: (title: string) => void;
  /**
   * 셸 통합(OSC 133/7) 상태가 바뀔 때마다. 통합이 설치돼 있지 않으면 한 번도
   * 불리지 않는다 — 소비처는 `state.active` 로 "켜져 있는가"를 판단한다.
   */
  onShellState?: (state: ShellState) => void;
  /**
   * 페인이 xterm 에서 직접 관찰한 신호 — alt-screen 진입/이탈, BEL, 마지막
   * 출력 시각 (2026-08-28). 셸 통합과 **독립**이다: 통합이 꺼져 있어도 오고,
   * 소비처(`agentMode.deriveAgentState`)가 둘을 합쳐 판정한다.
   *
   * 출력 시각은 청크마다 부르면 초당 수백 번이 되므로 1초로 묶어 보낸다.
   * alt-screen 전환과 벨은 **즉시** 보낸다 — 그 둘이 상태를 뒤집는 사건이라
   * 1초를 미루면 "기다린다"는 표시가 늦게 뜬다.
   */
  onSignal?: (signal: PaneSignal) => void;
  /**
   * 출력 안의 `파일:줄` 을 ⌘클릭했을 때. 넘기지 않으면 링크를 만들지 않는다
   * (프로젝트가 없는 세션에서 열 곳이 없으므로).
   */
  onOpenFileRef?: (path: string, line: number | null) => void;
}

export default function TerminalInstanceImpl({
  sessionId,
  cwd,
  visible,
  fontSize = 13,
  lineHeight = 1.25,
  persistent = false,
  autoFocus = true,
  onReady,
  onFocusIn,
  onTitleChange,
  onShellState,
  onSignal,
  onOpenFileRef,
}: TerminalInstanceProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // 경계 포착용 — 비동기(setTimeout) 지점의 치명 오류를 렌더로 승격한다.
  const [fatal, setFatal] = useState<Error | null>(null);
  if (fatal) throw fatal;
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const imeRef = useRef<ImeBridgeHandle | null>(null);
  // WebGL 애드온 핸들 — 정리 시 코어보다 먼저, 가드하고 dispose 한다.
  const webglRef = useRef<{ dispose(): void } | null>(null);
  const openedRef = useRef(false);
  const cwdRef = useRef(cwd);
  const persistentRef = useRef(persistent);
  const autoFocusRef = useRef(autoFocus);
  const onReadyRef = useRef(onReady);
  const onFocusInRef = useRef(onFocusIn);
  const onTitleChangeRef = useRef(onTitleChange);
  const onShellStateRef = useRef(onShellState);
  const onSignalRef = useRef(onSignal);
  const onOpenFileRefRef = useRef(onOpenFileRef);
  // 세션 nonce — 이 값이 실린 OSC 133 만 신뢰한다. attach/start 응답이 오기
  // 전에는 빈 문자열이라 파서가 전부 거른다 (실패 시 기본값이 "불신"이다).
  const nonceRef = useRef("");
  const shellStateRef = useRef<ShellState>(initialShellState);
  // 페인 신호(alt-screen · BEL · 마지막 출력) — 출력 시각은 청크마다 갱신되고
  // 발행만 1초로 묶는다. 예약된 타이머 id 는 정리를 위해 따로 든다.
  const signalRef = useRef<PaneSignal>(emptyPaneSignal);
  const signalTimerRef = useRef<number | null>(null);
  useEffect(() => {
    cwdRef.current = cwd;
    persistentRef.current = persistent;
    autoFocusRef.current = autoFocus;
    onReadyRef.current = onReady;
    onFocusInRef.current = onFocusIn;
    onTitleChangeRef.current = onTitleChange;
    onShellStateRef.current = onShellState;
    onSignalRef.current = onSignal;
    onOpenFileRefRef.current = onOpenFileRef;
  }, [
    cwd,
    persistent,
    autoFocus,
    onReady,
    onFocusIn,
    onTitleChange,
    onShellState,
    onSignal,
    onOpenFileRef,
  ]);

  // Create the Terminal + wire the PTY on mount. We do NOT open() here — output
  // buffers in xterm until the first open() once the tab is visible.
  useEffect(() => {
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      cursorWidth: 2,
      // 포커스가 없는 페인의 커서는 속을 비운다 (2026-08-28). 분할·다중 세션에서
      // 채워진 커서가 여러 개 깜빡이면 어디에 타이핑되는지 매번 확인해야 한다.
      cursorInactiveStyle: "outline",
      allowProposedApi: true,
      fontFamily: TERM_FONT,
      fontSize,
      fontWeightBold: "600",
      lineHeight,
      letterSpacing: 0,
      theme: readTerminalTheme(),
      scrollback: SCROLLBACK_LINES,
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
    term.onTitleChange((title) => {
      const trimmed = title.trim();
      if (trimmed) onTitleChangeRef.current?.(trimmed);
    });

    // --- 셸 통합 (OSC 133 명령 경계 / OSC 7 cwd) ---
    //
    // 등록은 여기(동기 구간)에서 해야 한다. 아래 async IIFE 의 스크롤백 리플레이
    // 전에 붙어 있어야 화면을 떠났다 돌아왔을 때 프롬프트 상태가 복원된다.
    //
    // 핸들러는 **동기로 boolean 을 반환**한다. Promise 를 돌려주면 xterm 파서가
    // 그 시퀀스에서 멈춰 터미널 출력 전체가 정지한다. 그래서 소비처 콜백은
    // microtask 로 밀어 파서 밖에서 돌린다 — 소비처가 던지는 예외가 파서를
    // 오염시키지 않게 하려는 목적도 있다.
    const publishShellState = (next: ShellState) => {
      if (next === shellStateRef.current) return;
      shellStateRef.current = next;
      queueMicrotask(() => {
        try {
          onShellStateRef.current?.(next);
        } catch (err) {
          // i18n-ignore-next-line -- 진단 로그(oculpm.log)는 한 언어로 남긴다
          oculpmLog.error("terminal", `셸 상태 콜백 실패: ${String(err)}`);
        }
      });
    };
    /** 신호 발행 — 상태를 뒤집는 사건(alt-screen·벨)은 즉시. */
    const publishSignal = (next: PaneSignal) => {
      signalRef.current = next;
      if (signalTimerRef.current !== null) {
        window.clearTimeout(signalTimerRef.current);
        signalTimerRef.current = null;
      }
      try {
        onSignalRef.current?.(next);
      } catch (err) {
        // i18n-ignore-next-line -- 진단 로그(oculpm.log)는 한 언어로 남긴다
        oculpmLog.error("terminal", `페인 신호 콜백 실패: ${String(err)}`);
      }
    };

    /**
     * 출력이 흘렀다. 청크마다 부르면 초당 수백 번이라 **1초로 묶어** 보낸다 —
     * 이 값은 "얼마나 조용한가"를 재는 데만 쓰이므로 1초 해상도면 충분하다.
     */
    const markOutput = () => {
      signalRef.current = { ...signalRef.current, lastOutputAt: Date.now() };
      if (signalTimerRef.current !== null) return;
      signalTimerRef.current = window.setTimeout(() => {
        signalTimerRef.current = null;
        try {
          onSignalRef.current?.(signalRef.current);
        } catch (err) {
          // i18n-ignore-next-line -- 진단 로그(oculpm.log)는 한 언어로 남긴다
          oculpmLog.error("terminal", `페인 신호 콜백 실패: ${String(err)}`);
        }
      }, 1000);
    };

    const oscDisposables = [
      // alt-screen 진입/이탈 — 전체화면 TUI(에이전트·less·vim) 구간의 경계.
      term.buffer.onBufferChange((buffer) => {
        const altScreen = buffer.type === "alternate";
        if (altScreen === signalRef.current.altScreen) return;
        publishSignal({ ...signalRef.current, altScreen });
      }),
      // BEL — 프로그램이 사람을 부른 것. "기다린다"의 유일한 확실한 근거다.
      term.onBell(() => {
        publishSignal({ ...signalRef.current, bellAt: Date.now() });
      }),
      term.parser.registerOscHandler(133, (payload) => {
        const event = parseOsc133(payload, nonceRef.current);
        // 위조/미검증 신호는 조용히 버리되, 마커 자체는 계속 소비한다 —
        // 화면에 이스케이프 잔해가 찍히지 않게.
        if (event) publishShellState(reduceShellState(shellStateRef.current, event, Date.now()));
        return true;
      }),
      term.parser.registerOscHandler(7, (payload) => {
        // OSC 7 에는 nonce 를 실을 자리가 없다 → 표시용 힌트로만 받는다.
        // 통합이 확인된 세션에서만 반영하고, 경로 해석에는 쓰지 않는다.
        const cwdFromOsc = parseOsc7(payload);
        const state = shellStateRef.current;
        if (cwdFromOsc && state.active && state.cwd !== cwdFromOsc) {
          publishShellState({ ...state, cwd: cwdFromOsc });
        }
        return true;
      }),
      // 출력 안의 `src/foo.ts:42` → ⌘클릭으로 편집기 열기.
      // WebLinksAddon 과 공존한다: URL 은 저쪽이, 상대경로는 이쪽이 맡는다.
      term.registerLinkProvider({
        provideLinks(bufferLineNumber, callback) {
          const open = onOpenFileRefRef.current;
          if (!open) {
            callback(undefined);
            return;
          }
          // 방어 — 이 콜백은 마우스 이동마다 xterm 내부에서 불린다. 여기서
          // 예외가 새면 렌더러 상태에 따라 컴포넌트째 죽을 수 있어, 링크
          // 하나 못 만드는 것으로 강등한다.
          try {
          // bufferLineNumber 는 이미 스크롤(ydisp)이 반영된 절대 버퍼 줄이다
          // — viewportY 를 더 하면 스크롤백이 쌓인 뒤 엉뚱한 줄을 스캔한다.
          const line = term.buffer.active.getLine(bufferLineNumber - 1);
          const text = line?.translateToString(true) ?? "";
          const refs = scanFileRefs(text);
          if (refs.length === 0) {
            callback(undefined);
            return;
          }
          callback(
            refs.map((ref) => ({
              // xterm 의 x/y 는 1-based, end 는 포함(inclusive)이다.
              range: {
                start: { x: ref.start + 1, y: bufferLineNumber },
                end: { x: ref.end, y: bufferLineNumber },
              },
              text: text.slice(ref.start, ref.end),
              activate: () => open(ref.path, ref.line),
            })),
          );
          } catch (err) {
            // i18n-ignore-next-line -- 진단 로그(oculpm.log)는 한 언어로 남긴다
            oculpmLog.error("terminal", `링크 스캔 실패 (무시): ${String(err)}`);
            callback(undefined);
          }
        },
      }),
    ];

    // 앱 테마(<html> 의 data-theme/preset/accent) 전환을 그대로 따라간다.
    const stopThemeWatch = observeTerminalTheme(() => {
      try {
        term.options.theme = readTerminalTheme();
      } catch (err) {
        // i18n-ignore-next-line -- 진단 로그(oculpm.log)는 한 언어로 남긴다
        oculpmLog.error("terminal", `테마 반영 실패: ${String(err)}`);
      }
    });

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

    // 다시 보이게 된 순간의 뷰포트 되맞춤 (viewportResync.ts 에 근거를 적어 뒀다).
    // ResizeObserver 로는 못 잡는다 — 다른 프로젝트 탭에 갔다 오면 **같은
    // 크기**로 돌아오므로 리사이즈가 아예 일어나지 않고, `fit()` 은 같은 치수에서
    // 아무 일도 하지 않는다. 그래서 xterm 과 같은 잣대(가시성)로 판정한다.
    let wasVisible = true;
    const io = new IntersectionObserver(
      (entries) => {
        const last = entries[entries.length - 1];
        if (!last) return;
        const { visible, revealed } = nextRevealState(wasVisible, last);
        wasVisible = visible;
        if (!revealed || !openedRef.current || !container) return;
        if (container.clientWidth === 0 || container.clientHeight === 0) return;
        try {
          // 자리를 비운 사이 창이 커졌을 수도 있으니 먼저 맞춰 보고,
          // 크기가 그대로여도 어긋난 스크롤 기하는 반드시 되맞춘다.
          fit.fit();
          void commands.resizePty(sessionId, term.rows, term.cols);
          resyncViewport(term);
        } catch {
          /* renderer not ready — ignore */
        }
      },
      { threshold: 0 },
    );
    if (container) io.observe(container);

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
            else {
              term.write(e.payload.text);
              markOutput();
            }
          },
        );
        if (!isMounted) return;
        unlistenExit = await listen<void>(`pty-exit-${sessionId}`, () => {
          if (isMounted) term.write(`\r\n\x1b[1;31m[${t("term.processEnded")}]\x1b[0m\r\n`);
        });
        if (!isMounted) return;

        const at = await commands.attachPtySession(sessionId);
        if (!isMounted) return;
        if (at.status === "ok" && at.data) {
          // 살아있는 세션 재접속 — 스크롤백 리플레이.
          // nonce 를 write 보다 **먼저** 세운다. 리플레이 안에도 OSC 133 이
          // 들어 있어서, 순서가 뒤바뀌면 재접속마다 통합이 꺼진 것처럼 보인다.
          nonceRef.current = at.data.nonce;
          lastSeq = at.data.seq;
          if (at.data.text) term.write(at.data.text);
        } else {
          const res = await commands.startPtySession(sessionId, cwdRef.current, term.rows, term.cols);
          if (!isMounted) return;
          if (res.status === "error") {
            term.write(`\r\n\x1b[1;31m[${t("term.ptyStartFailed", { error: res.error })}]\x1b[0m\r\n`);
            return;
          }
          nonceRef.current = res.data.nonce;
          // **갓 뜬 셸에만** 첫 명령을 친다. 재접속 갈래(위 `attachPtySession`
          // 성공)에서는 건드리지 않는다 — 사용자는 셸을 이어 쓰려고 돌아온
          // 것이지 `claude` 를 또 띄우려는 것이 아니다.
          const boot = takeBootCommand(sessionId);
          if (boot) void commands.writeToPty(sessionId, `${boot}\r`);
        }
        attached = true;
        for (const chunk of queued) {
          if (chunk.seq > lastSeq) {
            term.write(chunk.text);
            markOutput();
          }
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
      io.disconnect();
      stopThemeWatch();
      container?.removeEventListener("focusin", handleFocusIn);
      if (unlistenData) unlistenData();
      if (unlistenExit) unlistenExit();
      for (const d of oscDisposables) d.dispose();
      // 묶어 두었던 출력 신호 발행 — 언마운트된 소비처를 깨우지 않게 취소한다.
      if (signalTimerRef.current !== null) {
        window.clearTimeout(signalTimerRef.current);
        signalTimerRef.current = null;
      }
      imeRef.current?.dispose();
      imeRef.current = null;
      // persistent 세션은 백엔드에 남긴다 — 탭/페인 닫기가 명시적으로 kill.
      if (!persistentRef.current) void commands.killPtySession(sessionId);
      // A0d 근본 원인 — 정리에서 throw 금지: addon-webgl 0.19 가 xterm 5.5
      // 코어에 없는 내부(_core._store)를 dispose 에서 만져 언마운트 커밋을
      // 통째로 무너뜨렸다(앱 전체 빈 화면). 버전은 0.18 로 정합했고, 여기는
      // 미래의 어떤 dispose 예외도 앱을 죽이지 못하게 가드한다.
      try {
        webglRef.current?.dispose();
      } catch (err) {
        // i18n-ignore-next-line -- 진단 로그(oculpm.log)는 한 언어로 남긴다
        oculpmLog.error("terminal", `webgl dispose 실패 (무시): ${String(err)}`);
      }
      webglRef.current = null;
      try {
        term.dispose();
      } catch (err) {
        // i18n-ignore-next-line -- 진단 로그(oculpm.log)는 한 언어로 남긴다
        oculpmLog.error("terminal", `term.dispose 실패 (무시): ${String(err)}`);
      }
      termRef.current = null;
      openedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // fontSize·lineHeight 라이브 반영 (⌘+/⌘- · 밀도 프리셋) — 열린 뒤엔 refit +
  // PTY resize 까지. 둘 다 셀 크기를 바꾸므로 한 이펙트에서 처리한다: 따로 두면
  // 밀도와 크기를 연달아 바꿀 때 fit 이 두 번 돌며 PTY 에 중간 크기가 한 번
  // 새어 나간다 (셸이 그 크기로 다시 그린다).
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    const sizeChanged = term.options.fontSize !== fontSize;
    const heightChanged = term.options.lineHeight !== lineHeight;
    if (!sizeChanged && !heightChanged) return;
    if (sizeChanged) term.options.fontSize = fontSize;
    if (heightChanged) term.options.lineHeight = lineHeight;
    if (openedRef.current) {
      try {
        fitRef.current?.fit();
        void commands.resizePty(sessionId, term.rows, term.cols);
      } catch {
        /* ignore */
      }
    }
  }, [fontSize, lineHeight, sessionId]);

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
        try {
          term.open(container);
        } catch (err) {
          // 렌더러가 테마 색을 파싱하는 지점이라 잘못된 토큰 하나가 여기서 터진다.
          // setTimeout 안이라 여기서 rethrow 하면 에러 경계가 원리적으로 못
          // 잡는다 (A0d: 앱 전체 빈 화면의 유력 경로) — state 로 승격해 렌더
          // 단계에서 다시 던져 TerminalErrorBoundary 가 포착하게 한다.
          // i18n-ignore-next-line -- 진단 로그(oculpm.log)는 한 언어로 남긴다
          oculpmLog.error("terminal", `term.open 실패: ${String(err)}`);
          setFatal(err instanceof Error ? err : new Error(String(err)));
          return;
        }
        openedRef.current = true;
        // open() 이후 부가 기능(GPU 렌더러·IME 브리지·화면 핸들 등록)은 하나가
        // 실패해도 터미널 자체는 살아 있어야 한다. 예외가 그대로 올라가면
        // React 가 TerminalInstanceImpl 을 통째로 언마운트해 입력이 죽는다.
        void loadWebglRenderer(term, webglRef);
        try {
          imeRef.current = attachImeBridge(term, container);
        } catch (err) {
          // i18n-ignore-next-line -- 진단 로그(oculpm.log)는 한 언어로 남긴다
          oculpmLog.error("terminal", `IME 브리지 연결 실패: ${String(err)}`);
        }
        try {
          const search = searchRef.current;
          if (search) onReadyRef.current?.({ term, search });
        } catch (err) {
          // i18n-ignore-next-line -- 진단 로그(oculpm.log)는 한 언어로 남긴다
          oculpmLog.error("terminal", `onReady 핸들 등록 실패: ${String(err)}`);
        }
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

/**
 * GPU 렌더러로 승격. open() 이후에만 붙일 수 있고, 컨텍스트를 잃으면 dispose 해
 * xterm 이 DOM 렌더러로 되돌아가게 한다. 애드온 청크는 여기서 지연 로드해
 * 터미널을 안 여는 세션에 비용을 지우지 않는다.
 */
async function loadWebglRenderer(
  term: Terminal,
  handle: { current: { dispose(): void } | null },
): Promise<void> {
  try {
    const { WebglAddon } = await import("@xterm/addon-webgl");
    if (!term.element) return; // 로드 중 dispose 된 경우
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => webgl.dispose());
    term.loadAddon(webgl);
    handle.current = webgl;
  } catch (err) {
    // WebGL2 미지원/차단 — DOM 렌더러 그대로 (동작엔 문제 없음).
    // i18n-ignore-next-line -- 진단 로그(oculpm.log)는 한 언어로 남긴다
    console.warn("[TerminalInstance] WebGL 렌더러 사용 불가, DOM 렌더러로 진행:", err);
  }
}
