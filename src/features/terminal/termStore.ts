/**
 * 앱 안 터미널 세션 저장소 (4.0) — 창(웹뷰) 하나에 하나, **모듈 범위**에 산다.
 *
 * 화면(탭)을 오가도 세션은 계속 돈다 — xterm 인스턴스와 그 DOM 을 여기서 들고 있다가
 * 화면이 다시 서면 그 자리에 붙인다. 백엔드 세션은 창이 닫히면 함께 끝난다
 * (`src-tauri/src/terminal.rs`). 웹뷰만 새로 그려진 경우(개발 중 새로고침)엔 출력
 * 통로가 끊긴 세션이 백엔드에 남으므로, 처음 쓸 때 그것들을 닫는다.
 */

import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon, type ISearchOptions } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";

import { fileOpenApi } from "@/api/fileOpen";
import { ApiError } from "@/api/invoke";
import { terminalApi, type TermCheck, type TermEvent, type TermInfo } from "@/api/terminal";
import { kbd } from "@/lib/kbd";
import { isMac } from "@/lib/platform";
import { t } from "@/i18n";
import { oculpmLog } from "@/lib/oculpmLog";
import { toast } from "@/lib/toast";
import { watchAgentScreen } from "./agentScreen";
import { watchOscClipboard } from "./oscClipboard";
import { alertIfWaiting, alertOnSignal, forgetAlerts, trackSession } from "./attention";
import { noteWorked } from "./claudeWorked";
import { createImagePathProvider, createOscLinkHandler, shouldOpenLink } from "./fileLinks";
import { createFileRefProvider, openFileMenu } from "./fileRefs";
import { peekEvent } from "./imagePeek";
import { pushImeTrace } from "./imeTrace";
import { attachImeBridge } from "./imeBridge";
import { LAUNCH_WATCH_CHARS, announceLaunchFailure, launchFailure } from "./launchCheck";
import { forgetTermActivity, noteTermActivity } from "./status";
import { afterFit, forgetCell, initialSize } from "./termSize";
import { contrastFloor, observeTerminalTheme, readTerminalTheme } from "./termTheme";

// 한글은 번들 'D2Coding Term'(App.css)이 unicode-range 로 두 셀을 정확히 채운다 — 라틴 격자를
// 정하는 글꼴이 스택의 맨 앞이어야 한다 (3.x terminalPlatform.ts 의 실측 그대로).
// 프롬프트 아이콘(starship · oh-my-posh 의 git 가지 · 언어 표시)은 Nerd Font 의 사용자 영역(PUA)
// 글자라 시스템 대체 글꼴이 찾지 못하고 □ 로 나왔다 — 설치돼 있으면 쓰도록 흔한 Nerd Font 이름을
// 대체 자리에 둔다. 칸 폭은 맨 앞 글꼴이 정하니 한 칸짜리(Mono · NFM)를 먼저 둔다.
const NERD_FONTS = [
  '"Symbols Nerd Font Mono"',
  '"JetBrainsMono NFM"',
  '"JetBrainsMono Nerd Font Mono"',
  '"CaskaydiaMono NFM"',
  '"CaskaydiaCove NFM"',
  '"CaskaydiaCove Nerd Font Mono"',
  '"MesloLGS NF"',
  '"MesloLGM Nerd Font Mono"',
  '"Hack Nerd Font Mono"',
  '"FiraCode Nerd Font Mono"',
  '"JetBrainsMono Nerd Font"',
  '"Symbols Nerd Font"',
].join(", ");
const MAC_FONT = `Menlo, "D2Coding Term", ${NERD_FONTS}, "SF Mono", ui-monospace, monospace`;
const OTHER_FONT = `"Cascadia Mono", Consolas, "DejaVu Sans Mono", "D2Coding Term", ${NERD_FONTS}, "Noto Sans Mono", "Liberation Mono", monospace`;
const SCROLLBACK = 5000;
/**
 * PTY 크기 바꾸기는 칸이 잠잠해진 뒤 한 번 — 창 끌기 · 칸 나누기 동안 ResizeObserver 가 프레임마다
 * 불러, 그때마다 ConPTY 가 화면을 다시 흘리고(conhost reflow) 셸 · claude 가 프롬프트를 다시 그렸다
 * (2026-11-11). 잠잠하던 칸의 첫 바꾸기는 곧장 보낸다(처음 맞춘 크기가 늦지 않게).
 */
export const PTY_RESIZE_DEBOUNCE_MS = 80;
/**
 * 내려간 세션의 WebGL 렌더러를 이만큼 쥐고 있다가 반납한다 — 탭을 오갈 때마다 문맥(ANGLE/D3D11)과
 * 글리프 아틀라스를 새로 짓지 않게. 오래 내려가 있으면 반납해 브라우저 상한(약 16)을 넘지 않는다.
 */
export const WEBGL_IDLE_MS = 30_000;
/** 동시에 쥐는 WebGL 렌더러의 상한 — 넘으면 내려간 세션의 것부터 곧장 반납한다. */
export const MAX_WEBGL = 8;
/**
 * 문맥을 잃으면 다시 붙이되 이 간격에 한 번까지 — 연달아 잃는 GPU 에서 붙였다 잃기를 되풀이하지 않게. 예전에는
 * 두 번 잃으면 그 세션은 끝까지 DOM 렌더러였다(박스 문자가 점선처럼 끊긴다).
 */
export const WEBGL_RETRY_MS = 60_000;
/** 글리프 아틀라스 페이지가 이만큼 붙을 때마다 비운다 — Claude 의 트루컬러 shimmer 가 글리프를 끝없이 늘렸다. */
export const ATLAS_CLEAR_EVERY = 32;
/** 그린 출력이 이만큼 모이면 백엔드에 알린다(`term_ack`) — 백엔드는 안 그린 것이 256KB 를 넘으면 읽기를 멈춘다. */
export const ACK_BYTES = 32 * 1024;
/**
 * xterm 이 아직 못 그린 출력이 이만큼을 넘으면 새 출력은 버리고 센다 — 다시 따라오면 「N MB 를 건너뛰었어요」
 * 한 줄을 남긴다. xterm 은 50MB 에서 말없이 버린다. 백엔드 흐름 제어가 있어 여기까지 오는 것은 창이 오래
 * 멈춰 있을 때뿐이다.
 */
export const DROP_BYTES = 32 * 1024 * 1024;
const LINE_HEIGHT = 1.15;

interface Entry {
  info: TermInfo;
  term: Terminal;
  fit: FitAddon;
  search: SearchAddon;
  host: HTMLDivElement;
  opened: boolean;
  disposeIme: (() => void) | null;
  /** 지금 에이전트(Claude · Codex)가 이 화면에 있는가 — 열 때부터 출력을 본다(`agentScreen`), 브리지가 묻는다. */
  agent: () => boolean;
  /** 지금 이 세션을 보여 주는 칸 수 — 0 이면 내려가 있다. */
  mounts: number;
  webgl: WebglAddon | null;
  /** 내려간 뒤 WebGL 을 반납할 타이머. */
  webglIdle: ReturnType<typeof setTimeout> | null;
  /** 문맥을 잃고 마지막으로 다시 붙인 때(ms, 0 이면 아직) — `WEBGL_RETRY_MS` 에 한 번. */
  webglRetryAt: number;
  /** 간격이 안 차 미뤄 둔 다시 붙이기. */
  webglRetry: ReturnType<typeof setTimeout> | null;
  /** 지금 WebGL 렌더러의 아틀라스 페이지 수 — `ATLAS_CLEAR_EVERY` 마다 비운다. */
  atlasPages: number;
  /** 다음 프레임에 칸 맞추기가 잡혀 있다. */
  fitFrame: number | null;
  /** PTY 로 보낼 크기 — 잠잠해지면 보낸다. */
  resizeTimer: ReturnType<typeof setTimeout> | null;
  pendingSize: { cols: number; rows: number } | null;
}

const entries = new Map<number, Entry>();
/** 터미널 글자 크기 — 새 세션도 이 크기로 연다 (`setTermFontSize`). */
let fontSize = 13;
/** 이 창에서 WebGL 문맥을 잃은 수 — 로그에 싣는다. */
let webglLosses = 0;
/** 「⌘ 로 연다」 안내는 창마다 한 번. */
let modHinted = false;
let dprWatched = false;
/** 안의 Claude 가 한 번이라도 「일하는 중」(OSC 7501 working)을 알린 세션 — 「일지 없이 끝남」의 재료. */
const worked = new Set<number>();
const listeners = new Set<() => void>();
let list: TermInfo[] = [];
let swept = false;
let unobserveTheme: (() => void) | null = null;

function notify() {
  list = [...entries.values()].map((e) => e.info).sort((a, b) => a.id - b.id);
  for (const fn of listeners) fn();
}

export function subscribeTerms(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function termsSnapshot(): TermInfo[] {
  return list;
}

/** 출력 통로가 끊긴(웹뷰 새로고침) 세션을 닫는다 — 한 번만. */
async function sweepOrphans() {
  if (swept) return;
  swept = true;
  try {
    for (const s of await terminalApi.list()) if (!entries.has(s.id)) void terminalApi.close(s.id);
  } catch {
    /* 웹뷰 밖(브라우저 개발 서버)에는 IPC 가 없다 */
  }
}

/**
 * 번들 한글 글꼴을 미리 받는다 — `unicode-range` 로 걸린 글꼴은 한글이 처음 그려질 때에야
 * 내려오는데, xterm 은 그 전에 칸을 재고 그린다. 그러면 첫 화면의 한글이 대체 글꼴 폭으로
 * 그려져 글자 사이가 벌어졌다(「플 랜」, 4.0 하네스에서 잡음). 한 번만, 실패는 무시.
 */
let fontReady: Promise<unknown> | null = null;
function loadHangulFont(): Promise<unknown> {
  if (!fontReady) {
    fontReady =
      typeof document !== "undefined" && document.fonts?.load
        ? document.fonts.load('13px "D2Coding Term"', "가").catch(() => null) // i18n-ignore -- 글꼴을 깨우는 표본 글자(표시 문자열 아님)
        : Promise.resolve(null);
  }
  return fontReady;
}

function watchTheme() {
  if (unobserveTheme) return;
  unobserveTheme = observeTerminalTheme(() => {
    const theme = readTerminalTheme();
    for (const e of entries.values()) {
      e.term.options.theme = theme;
      e.term.options.minimumContrastRatio = contrastFloor(theme.background);
    }
  });
}

/**
 * 화면 배율(DPR)이 바뀌면(외부 모니터로 옮김) 보이는 세션의 칸 수를 다시 맞춘다 — 셀 크기가 장치 픽셀로
 * 반올림돼 바뀌는데, 칸 크기는 그대로라 ResizeObserver 가 부르지 않았다.
 */
function watchDpr() {
  if (dprWatched || typeof window === "undefined" || typeof window.matchMedia !== "function") return;
  dprWatched = true;
  const arm = () => {
    const query = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    const onChange = () => {
      query.removeEventListener("change", onChange);
      forgetCell();
      for (const e of entries.values()) if (e.mounts > 0) scheduleFit(e);
      arm();
    };
    query.addEventListener("change", onChange);
  };
  arm();
}

function fontStack(): string {
  return isMac() ? MAC_FONT : OTHER_FONT;
}

/** 전체 화면 프로그램 위의 맨 클릭은 그 프로그램에 둔다 — 창마다 한 번 ⌘ 로 연다고 알린다. */
function hintModClick() {
  if (modHinted) return;
  modHinted = true;
  toast.info(t("terminal.link.modHint", { mod: kbd("⌘") }));
}

/** 쓰기가 밀렸다(백엔드 대기 1MB) — 붙여넣기를 다시 하라고 한 번 알린다. 다른 실패는 조용히. */
function warnIfBusy(e: unknown) {
  if (e instanceof ApiError && e.code === "terminal_busy") {
    toast.warning(t("terminal.writeBusy"), { dedupKey: "terminal-write-busy", dedupWindowMs: 5000 });
  }
}

/**
 * 새 세션 — 프로젝트 루트의 로그인 셸. `prompt` 가 있으면 그 프롬프트로 `claude` 를 바로 친다
 * (오늘·계획의 「다음」 실행). `check` 면 계획의 확인 명령 한 줄을 셸이 명령 인자로 받아 돌린다
 * (`runCheck.ts` — 사람이 확인 창에서 누른 뒤에만). 돌려주는 것은 세션 id.
 */
export async function openTerm(
  projectId: number,
  prompt: string | null = null,
  cwd: string | null = null,
  resume = false,
  check: TermCheck | null = null,
): Promise<number> {
  await Promise.all([sweepOrphans(), loadHangulFont()]);
  watchTheme();
  watchDpr();
  const theme = readTerminalTheme();
  const term = new Terminal({
    // 영수증 ⑥ — 움직임은 응답일 때만. 깜빡이는 커서는 쉬지 않는 반복이다.
    cursorBlink: false,
    cursorStyle: "bar",
    cursorInactiveStyle: "outline",
    allowProposedApi: true,
    fontFamily: fontStack(),
    fontSize,
    lineHeight: LINE_HEIGHT,
    theme,
    scrollback: SCROLLBACK,
    macOptionIsMeta: true,
    macOptionClickForcesSelection: true,
    drawBoldTextInBrightColors: true,
    minimumContrastRatio: contrastFloor(theme.background),
    // 한 칸을 넘는 Nerd Font 아이콘이 옆 글자를 덮지 않게 칸 안으로 줄인다.
    rescaleOverlappingGlyphs: true,
    // 칸에 맞는 크기로 연다 — 80×24 로 열면 「다음」 의 claude 가 첫 화면을 80칸에 찍었다 다시 그렸다.
    ...initialSize(fontStack(), fontSize, LINE_HEIGHT),
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  const search = new SearchAddon();
  term.loadAddon(search);
  term.loadAddon(new Unicode11Addon());
  term.unicode.activeVersion = "11";
  // 첫 바이트부터 — 브리지는 첫 마운트에 붙어서 그 전에 온 claude 의 탐침 · idle 을 못 본다.
  const agent = watchAgentScreen(term);
  watchOscClipboard(term); // OSC 52 쓰기 — 키 직후 · 64KB · 알림, 읽기는 막음
  const openUrl = (uri: string) => void fileOpenApi.url(uri).catch(() => {});
  term.loadAddon(
    new WebLinksAddon((event, uri) => (shouldOpenLink(event, term) ? openUrl(uri) : hintModClick())),
  );
  // OSC 8 링크(없으면 xterm 기본 처리기가 웹뷰에서 막혀 아무 일도 없다) · 출력의 이미지 경로.
  term.options.linkHandler = createOscLinkHandler({
    openUrl,
    onImage: peekEvent,
    onFile: openFileMenu,
    term,
    onPassedThrough: hintModClick,
  });
  term.registerLinkProvider(
    createImagePathProvider((y) => term.buffer.active.getLine(y), peekEvent, () => term.cols, term, hintModClick),
  );
  // 맨 글자 `src/foo.ts:12` — ⌘클릭이면 「이 파일로 할 일」(Finder · 빠른 미리보기 · 외부 편집기).
  term.registerLinkProvider(createFileRefProvider((y) => term.buffer.active.getLine(y), openFileMenu));
  const host = document.createElement("div");
  host.className = "term-host";

  let entry: Entry | null = null;
  // 셸이 open 이 돌아오기 전에 끝날 수도 있다 — 그 끝을 받아 뒀다가 표에 넣을 때 적는다.
  let earlyExit: { code: number | null } | null = null;
  // 첫 출력이 open 이 돌아오기 전에 올 수 있다 — xterm 은 open() 전에도 버퍼에 쓴다.
  // 「다음」 실행이면 첫머리에서 claude 를 못 찾았는지 본다 — 찾았든 못 찾았든 한 번만.
  let launchHead: string | null = prompt || resume ? "" : null;
  // 출력 흐름 — xterm 이 그린(콜백) 바이트를 모아 `ACK_BYTES` 마다 백엔드에 알린다. 세션 id 는 open 이
  // 돌아와야 알므로 그 전에 그린 것은 모아 두었다가 함께 알린다.
  const flow = { id: null as number | null, pending: 0, drawn: 0, skipped: 0 };
  const drawn = (n: number) => {
    flow.drawn += n;
    if (flow.id === null || flow.drawn < ACK_BYTES) return;
    void terminalApi.ack(flow.id, flow.drawn).catch(() => {});
    flow.drawn = 0;
  };
  const onEvent = (ev: TermEvent) => {
    if (ev.kind === "output") {
      // 「최근 소식 없음」 의 시계 — 출력 조각마다 시각 하나(Map 한 칸)라 값싸다. 표시는 화면의 분 틱이 다시 읽는다.
      if (entry) noteTermActivity(entry.info.id);
      const n = Number.isFinite(ev.n) ? ev.n : ev.data.length;
      if (flow.pending > DROP_BYTES) {
        flow.skipped += n;
        drawn(n);
        return;
      }
      if (flow.skipped > 0) {
        const mb = Math.max(0.1, Math.round(flow.skipped / 104_857.6) / 10);
        term.write(`\r\n\x1b[2m${t("terminal.notify.skipped", { mb })}\x1b[0m\r\n`);
        flow.skipped = 0;
      }
      flow.pending += n;
      term.write(ev.data, () => {
        flow.pending -= n;
        drawn(n);
      });
      if (launchHead !== null) {
        launchHead += ev.data;
        const failure = launchFailure(launchHead);
        if (failure) {
          launchHead = null;
          announceLaunchFailure(failure);
        } else if (launchHead.length > LAUNCH_WATCH_CHARS) {
          launchHead = null;
        }
      }
      return;
    }
    if (ev.kind === "status") {
      // 프로그램 상태(OSC 7501) — open 이 돌아온 뒤에야 오지만(탐침 답이 먼저다) 앞서 오면 버린다.
      if (!entry) return;
      noteTermActivity(entry.info.id);
      const prev = entry.info.status;
      if (ev.status?.state === "working") worked.add(entry.info.id);
      entry.info = { ...entry.info, status: ev.status };
      // 설정 「일지가 안 와요」 — 훅 신호와 견줄 Claude 의 일한 때(11-23). 레인(cwd)의 Claude 는 그 worktree 의 인박스에 쓴다.
      if (cwd === null) noteWorked(entry.info);
      alertIfWaiting(prev, entry.info);
      notify();
      return;
    }
    // 제목(OSC 0 · 2 · 7501 title=) · 종 · 프로그램 알림 — 이것도 open 뒤에만 쓴다.
    if (ev.kind === "title") {
      if (!entry) return;
      entry.info = { ...entry.info, title: ev.title };
      notify();
      return;
    }
    if (ev.kind === "bell" || ev.kind === "notice") {
      if (entry) alertOnSignal(entry.info, ev);
      return;
    }
    if (!entry) {
      earlyExit = { code: ev.code };
      return;
    }
    entry.info = { ...entry.info, alive: false, exit_code: ev.code };
    trackSession(entry.info);
    notify();
  };
  let info: TermInfo;
  try {
    info = await terminalApi.open(projectId, term.cols, term.rows, prompt, onEvent, cwd, resume, check);
  } catch (e) {
    term.dispose();
    throw e;
  }
  flow.id = info.id;
  drawn(0);
  if (earlyExit) info = { ...info, alive: false, exit_code: (earlyExit as { code: number | null }).code };
  entry = {
    info,
    term,
    fit,
    search,
    host,
    opened: false,
    disposeIme: null,
    agent,
    mounts: 0,
    webgl: null,
    webglIdle: null,
    webglRetryAt: 0,
    webglRetry: null,
    atlasPages: 0,
    fitFrame: null,
    resizeTimer: null,
    pendingSize: null,
  };
  entries.set(info.id, entry);
  const id = info.id;
  const e = entry;
  term.onData((data) => {
    // 실제로 PTY 에 보낸 짧은 입력을 입력 기록 링에 남긴다 — 한글이 두 번 찍힐 때 앱이 두 번
    // 보냈는지, 그 뒤(ConPTY · 셸 · claude)에서 겹쳤는지를 덤프(⌃⌥⇧I)만 보고 가린다(2026-11-11
    // Windows). 키 입력 길이(8자 이하)만 — 붙여넣기 · 프롬프트 본문은 남기지 않는다.
    if (data.length <= 8) pushImeTrace("pty-write", { data: JSON.stringify(data) });
    void terminalApi.write(id, data).catch(warnIfBusy);
  });
  term.onResize((size) => queuePtyResize(id, e, size));
  notify();
  return id;
}

/**
 * 세션의 화면을 `container` 에 붙이고 칸에 맞춘다. 처음이면 xterm 을 연다. 칸이 여럿이면
 * 고른 칸만 `focus` — 나중에 선 칸이 입력을 빼앗지 않게.
 */
export function mountTerm(id: number, container: HTMLElement, focus = true): () => void {
  const e = entries.get(id);
  if (!e) return () => {};
  container.appendChild(e.host);
  if (!e.opened) {
    e.term.open(e.host);
    const ime = attachImeBridge(e.term, e.host, e.agent);
    e.disposeIme = () => ime.dispose();
    e.opened = true;
  }
  e.mounts += 1;
  if (e.webglIdle) {
    clearTimeout(e.webglIdle);
    e.webglIdle = null;
  }
  attachWebgl(e);
  // 다시 붙은 화면 — 크기가 같으면 fit 이 아무것도 안 하니, 내려가 있던 동안의 것을 한 번 다시 그린다.
  if (e.webgl) e.term.refresh(0, e.term.rows - 1);
  // 처음 맞추기는 곧장(붙자마자 칸에 맞는다), 그 뒤 ResizeObserver 는 한 프레임에 한 번.
  refitNow(e);
  const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => scheduleFit(e));
  ro?.observe(container);
  if (focus) e.term.focus();
  return () => {
    ro?.disconnect();
    e.mounts = Math.max(0, e.mounts - 1);
    if (e.mounts === 0) {
      if (e.fitFrame !== null) {
        cancelFrame(e.fitFrame);
        e.fitFrame = null;
      }
      if (e.webgl && !e.webglIdle) {
        e.webglIdle = setTimeout(() => {
          e.webglIdle = null;
          if (e.mounts === 0) releaseWebgl(e);
        }, WEBGL_IDLE_MS);
      }
    }
    if (e.host.parentElement === container) container.removeChild(e.host);
  };
}

/**
 * WebGL 렌더러 — 박스 그림 문자(Claude Code 배너 · 표)를 xterm 이 직접 이어 그린다(DOM 렌더러는
 * 글꼴 글리프라 점선처럼 끊겼다). 보이는 세션에 붙이고, 내려가면 `WEBGL_IDLE_MS` 뒤에 반납한다 — 세션마다
 * 문맥을 쥐면 브라우저 상한(약 16)과 GPU 메모리를 먹었다(3.x 「WebGL 반납」). 예전엔 내려가는 즉시 반납해
 * 탭을 오갈 때마다 문맥 · 글리프 아틀라스를 새로 지었다(2026-11-11). 문맥을 잃으면 다시 붙이되
 * `WEBGL_RETRY_MS` 에 한 번(`retryWebgl`), 못 쓰면 DOM 그대로. 아틀라스는 `ATLAS_CLEAR_EVERY` 페이지마다
 * 비운다 — 트루컬러 shimmer 가 색마다 글리프를 새로 구워 끝없이 늘었다(Paradev 11GB → 2GB 실측).
 */
function attachWebgl(e: Entry) {
  if (e.webgl) return;
  const live = [...entries.values()].filter((x) => x.webgl);
  if (live.length >= MAX_WEBGL) {
    for (const x of live) if (x.mounts === 0) releaseWebgl(x);
  }
  let addon: WebglAddon;
  try {
    addon = new WebglAddon();
    addon.onContextLoss(() => {
      if (e.webgl !== addon) return;
      webglLosses += 1;
      oculpmLog.warn("terminal", "webgl context lost", { session: e.info.id, losses: webglLosses });
      releaseWebgl(e);
      retryWebgl(e);
    });
    addon.onAddTextureAtlasCanvas(() => {
      e.atlasPages += 1;
      // 그리는 도중의 사건이다 — 그 그리기가 끝난 뒤에 비운다.
      if (e.atlasPages % ATLAS_CLEAR_EVERY === 0) queueMicrotask(() => e.webgl === addon && addon.clearTextureAtlas());
    });
    e.term.loadAddon(addon);
  } catch {
    return;
  }
  e.atlasPages = 0;
  e.webgl = addon;
}

/** 잃은 문맥을 다시 붙인다 — 지난번에서 `WEBGL_RETRY_MS` 가 지났으면 곧장, 아니면 그때까지 미룬다. 보이는 세션만. */
function retryWebgl(e: Entry) {
  if (e.webglRetry) return;
  const attach = () => {
    e.webglRetry = null;
    if (e.mounts === 0 || e.webgl || entries.get(e.info.id) !== e) return;
    e.webglRetryAt = Date.now();
    attachWebgl(e);
  };
  const wait = e.webglRetryAt + WEBGL_RETRY_MS - Date.now();
  if (e.webglRetryAt === 0 || wait <= 0) attach();
  else e.webglRetry = setTimeout(attach, wait);
}

/**
 * WebGL 렌더러의 GL 문맥 — `.xterm-screen` 의 캔버스 가운데 WebGL 것. addon-webgl 0.18 은 2D 링크 층
 * (`xterm-link-layer`)을 WebGL 캔버스보다 먼저 붙인다(WebglRenderer 생성자). 첫 캔버스를 집던 때는 그 2D
 * 캔버스에 `getContext("webgl2")` 를 물어 늘 null 이었고, 문맥을 한 번도 돌려주지 못했다. 2D 층(`xterm-*-layer`)은
 * 건너뛴다 — 남는 것은 이미 WebGL 문맥을 가진 캔버스라 묻는다고 새 문맥이 생기지 않는다.
 */
function webglContextOf(term: Terminal): WebGL2RenderingContext | null {
  const canvases = term.element?.querySelectorAll<HTMLCanvasElement>(".xterm-screen > canvas") ?? [];
  for (const canvas of canvases) {
    if (/-layer\b/.test(canvas.className)) continue;
    const gl = canvas.getContext("webgl2");
    if (gl) return gl;
  }
  return null;
}

function releaseWebgl(e: Entry) {
  if (e.webglIdle) {
    clearTimeout(e.webglIdle);
    e.webglIdle = null;
  }
  const addon = e.webgl;
  e.webgl = null;
  if (!addon) return;
  // 문맥은 버리기 전에 잡는다(버리면 캔버스가 화면에서 떨어진다). 곧장 돌려준다 — 떨어진 캔버스의 GL 문맥은
  // 가비지 컬렉터가 거둘 때까지 브라우저 상한(약 16)과 GPU 메모리를 쥐고 있었다.
  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = webglContextOf(e.term);
  } catch {
    /* 물을 수 없다 — 버리기만 한다 */
  }
  try {
    addon.dispose();
  } catch {
    /* 이미 잃은 문맥 — 버릴 것도 없다 */
  }
  try {
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    /* 돌려줄 문맥이 없다 */
  }
}

/** 칸에 맞춘다 — 맞춘 격자를 가운데에 두고, 셀 크기 · 자리를 새 세션의 첫 크기로 기억한다(`termSize.ts`). */
function refitNow(e: Entry) {
  const width = e.host.clientWidth;
  const height = e.host.clientHeight;
  if (width <= 0 || height <= 0) return;
  e.fit.fit();
  afterFit(e.term, e.host, width, height);
}

const nextFrame: (cb: () => void) => number =
  typeof requestAnimationFrame === "function"
    ? (cb) => requestAnimationFrame(cb)
    : (cb) => setTimeout(cb, 16) as unknown as number;
const cancelFrame: (id: number) => void =
  typeof cancelAnimationFrame === "function" ? (id) => cancelAnimationFrame(id) : (id) => clearTimeout(id);

/** 칸 맞추기를 다음 프레임으로 — 한 프레임에 ResizeObserver 가 몇 번 불러도 fit 은 한 번. */
function scheduleFit(e: Entry) {
  if (e.fitFrame !== null) return;
  e.fitFrame = nextFrame(() => {
    e.fitFrame = null;
    refitNow(e);
  });
}

/**
 * xterm 크기가 바뀌었다 → PTY 로. 잠잠하던 칸이면 곧장 보내고, 이어지는 바꾸기는 마지막 것만
 * `PTY_RESIZE_DEBOUNCE_MS` 잠잠한 뒤에 보낸다.
 */
function queuePtyResize(id: number, e: Entry, size: { cols: number; rows: number }) {
  const send = (s: { cols: number; rows: number }) => void terminalApi.resize(id, s.cols, s.rows).catch(() => {});
  if (e.resizeTimer === null) {
    send(size);
    e.pendingSize = null;
  } else {
    clearTimeout(e.resizeTimer);
    e.pendingSize = size;
  }
  e.resizeTimer = setTimeout(() => {
    e.resizeTimer = null;
    const last = e.pendingSize;
    e.pendingSize = null;
    if (last && entries.get(id) === e) send(last);
  }, PTY_RESIZE_DEBOUNCE_MS);
}

/** 모든 세션의 글자 크기를 바꾸고 보이는 칸은 다시 맞춘다 (⌘= / ⌘- / ⌘0). */
export function setTermFontSize(size: number) {
  if (size === fontSize) return;
  fontSize = size;
  for (const e of entries.values()) {
    e.term.options.fontSize = size;
    // 가운데 맞춤 · 기억한 셀 크기까지 새로(`refitNow`) — fit 만 부르던 때는 옛 셀 폭으로 잰 여백이 남아 격자가
    // 반 칸까지 스크롤바 쪽으로 밀렸고, 다음 새 세션의 첫 크기도 옛 셀로 쟀다. 칸 크기는 그대로라 ResizeObserver 도
    // 다시 부르지 않는다.
    if (e.opened) refitNow(e);
  }
}

/** 찾기 결과 — `index` 는 0부터, 못 세면(결과가 너무 많음) -1. */
export interface FindResult {
  index: number;
  count: number;
}

/** 찾기 조건 — `incremental` 은 치는 대로 찾을 때(지금 곳이 그대로 늘어난다, `findNext` 만). */
export interface FindOptions {
  caseSensitive?: boolean;
  regex?: boolean;
  incremental?: boolean;
  /**
   * 찾은 곳을 모두 새로 칠한다 — 테마가 바뀌었을 때. 검색 애드온은 같은 낱말 · 같은 조건이면 칠을 다시 하지
   * 않는다(장식 색은 비교하지 않는다). 선택은 남겨 지금 곳이 그대로다.
   */
  repaint?: boolean;
}

/** 토큰이 아직 안 붙은 순간(첫 페인트 · jsdom)의 값 — 다크 기준. */
const FIND_FALLBACK = { bg: "#1b1f1d", text: "#f1f4f1", warn: "#eaa23f", accent: "#34d095" };

function hexToken(style: CSSStyleDeclaration, name: string, fallback: string): string {
  const v = style.getPropertyValue(name).trim();
  return /^#[0-9a-f]{6}$/i.test(v) ? v : fallback;
}

/** `top` 을 `base` 에 `amount` 만큼 섞은 #RRGGBB (`projectTint.mixHex` 와 같은 셈 — 이 구역만 고치려고 따로 둔다). */
function mixFind(top: string, base: string, amount: number): string {
  const ch = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const mixed = [0, 1, 2].map((i) => Math.round(ch(base, i) + (ch(top, i) - ch(base, i)) * amount));
  return "#" + mixed.map((v) => v.toString(16).padStart(2, "0")).join("");
}

/**
 * 찾은 곳 · 지금 곳의 칠 — 토큰에서 #RRGGBB 로 만든다(장식은 그 꼴만 받는다). 예전 고정 색은 rg 가 칠한
 * 빨간 낱말 위에서 글자 대비가 라이트 1.02:1 이었다 — 찾은 곳은 바탕에 글자색 20% 를 섞은 **중립** 면에
 * 앰버 1px 테, 지금 곳은 한 단 짙은 면에 강조색 1px 테. 테마 · 프로젝트 색이 바뀌면 다음 찾기부터 따라간다.
 */
export function findDecor(root: HTMLElement = document.documentElement): NonNullable<ISearchOptions["decorations"]> {
  const style = getComputedStyle(root);
  const bg = hexToken(style, "--term-bg", FIND_FALLBACK.bg);
  const text = hexToken(style, "--text", FIND_FALLBACK.text);
  const warn = hexToken(style, "--warn", FIND_FALLBACK.warn);
  const accent = hexToken(style, "--accent", FIND_FALLBACK.accent);
  return {
    matchBackground: mixFind(text, bg, 0.2),
    matchBorder: warn,
    matchOverviewRuler: warn,
    activeMatchBackground: mixFind(text, bg, 0.32),
    activeMatchBorder: accent,
    activeMatchColorOverviewRuler: accent,
  };
}

/**
 * 세션의 출력(스크롤백 포함)에서 찾는다 (11-02, 터미널 찾기 ⌘F). 결과 수는 `onResult` 로 —
 * 찾을 때마다 다시 온다. 돌려주는 것은 찾았는가. 맞지 않는 정규식은 찾지 못한 것으로 친다.
 */
export function findInTerm(id: number, query: string, back: boolean, options: FindOptions = {}): boolean {
  const e = entries.get(id);
  if (!e || !query) return false;
  const opts: ISearchOptions = {
    caseSensitive: options.caseSensitive ?? false,
    regex: options.regex ?? false,
    incremental: !back && (options.incremental ?? false),
    decorations: findDecor(),
  };
  if (options.repaint) e.search.clearDecorations();
  try {
    return back ? e.search.findPrevious(query, opts) : e.search.findNext(query, opts);
  } catch {
    return false;
  }
}

/**
 * 안의 프로그램이 대체 화면(전체 화면 TUI)에 있는가 — Claude Code 는 `CLAUDE_CODE_NO_FLICKER` 라 대화가
 * 거기 산다. 대체 화면에는 스크롤백이 없어 ⌘F 는 보이는 몇 줄만 찾는다.
 */
export function isAltScreen(id: number): boolean {
  return entries.get(id)?.term.buffer.active.type === "alternate";
}

/** 찾은 곳 칠과 선택만 지운다 — 입력은 건드리지 않는다(다른 칸을 고르며 닫힐 때). */
export function clearFindDecor(id: number) {
  const e = entries.get(id);
  if (!e) return;
  e.search.clearDecorations();
  e.term.clearSelection();
}

/** 찾기 결과 수가 바뀔 때마다 — 끄는 함수를 돌려준다. */
export function onFindResult(id: number, fn: (r: FindResult) => void): () => void {
  const e = entries.get(id);
  if (!e) return () => {};
  const sub = e.search.onDidChangeResults(({ resultIndex, resultCount }) => fn({ index: resultIndex, count: resultCount }));
  return () => sub.dispose();
}

/** 찾기를 닫는다 — 칠한 것을 지우고 입력으로 돌아간다. */
export function clearFind(id: number) {
  clearFindDecor(id);
  entries.get(id)?.term.focus();
}

/** 이 세션에서 Claude 가 일한 적이 있는가 (OSC 7501 working 을 한 번이라도). */
export function hasWorked(id: number): boolean {
  return worked.has(id);
}

/** 세션의 입력에 초점을 둔다 — 칸 여럿 중 하나를 탭 · 단축키로 고를 때. */
export function focusTerm(id: number) {
  entries.get(id)?.term.focus();
}

/** 세션 입력에 붙여 넣는다 — xterm 이 안의 프로그램의 브래킷 붙여넣기 모드를 따라 감싼다. */
export function pasteToTerm(id: number, text: string) {
  const e = entries.get(id);
  if (!e || !e.info.alive) return;
  e.term.paste(text);
  e.term.focus();
}

/**
 * 세션 안 프로그램의 상태가 `pred` 를 만족할 때까지 기다린다(OSC 7501) — 만족하면 `true`,
 * 시간이 다 되거나 세션이 끝나면 `false`. 「끝까지」가 claude 의 입력 대기를 기다릴 때 쓴다.
 */
export function waitForTermStatus(id: number, pred: (s: TermInfo["status"]) => boolean, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      off();
      resolve(ok);
    };
    const check = () => {
      const info = entries.get(id)?.info;
      if (!info || !info.alive) finish(false);
      else if (pred(info.status)) finish(true);
    };
    const off = subscribeTerms(check);
    const timer = setTimeout(() => finish(false), timeoutMs);
    check();
  });
}

/** 세션을 닫는다 — 셸을 죽이고 화면을 버린다. */
export function closeTerm(id: number) {
  const e = entries.get(id);
  void terminalApi.close(id).catch(() => {});
  if (!e) return;
  e.disposeIme?.();
  if (e.fitFrame !== null) cancelFrame(e.fitFrame);
  if (e.resizeTimer) clearTimeout(e.resizeTimer);
  e.resizeTimer = null;
  if (e.webglRetry) clearTimeout(e.webglRetry);
  e.webglRetry = null;
  releaseWebgl(e);
  e.term.dispose();
  e.host.remove();
  entries.delete(id);
  worked.delete(id);
  forgetAlerts(id);
  forgetTermActivity(id);
  notify();
}
