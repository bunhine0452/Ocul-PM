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
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";

import { fileOpenApi } from "@/api/fileOpen";
import { terminalApi, type TermEvent, type TermInfo } from "@/api/terminal";
import { isMac } from "@/lib/platform";
import { t } from "@/i18n";
import { toast } from "@/lib/toast";
import { alertIfWaiting } from "./attention";
import { attachImeBridge } from "./imeBridge";
import { LAUNCH_WATCH_CHARS, launchFailed } from "./launchCheck";
import { observeTerminalTheme, readTerminalTheme } from "./termTheme";

// 한글은 번들 'D2Coding Term'(App.css)이 unicode-range 로 두 셀을 정확히 채운다 — 라틴 격자를
// 정하는 글꼴이 스택의 맨 앞이어야 한다 (3.x terminalPlatform.ts 의 실측 그대로).
const MAC_FONT = 'Menlo, "D2Coding Term", "SF Mono", ui-monospace, monospace';
const OTHER_FONT =
  '"Cascadia Mono", Consolas, "DejaVu Sans Mono", "D2Coding Term", "Noto Sans Mono", "Liberation Mono", monospace';
const SCROLLBACK = 5000;

interface Entry {
  info: TermInfo;
  term: Terminal;
  fit: FitAddon;
  host: HTMLDivElement;
  opened: boolean;
  disposeIme: (() => void) | null;
}

const entries = new Map<number, Entry>();
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
    for (const e of entries.values()) e.term.options.theme = theme;
  });
}

/**
 * 새 세션 — 프로젝트 루트의 로그인 셸. `prompt` 가 있으면 그 프롬프트로 `claude` 를 바로 친다
 * (오늘·계획의 「다음」 실행). 돌려주는 것은 세션 id.
 */
export async function openTerm(projectId: number, prompt: string | null = null): Promise<number> {
  await Promise.all([sweepOrphans(), loadHangulFont()]);
  watchTheme();
  const term = new Terminal({
    cursorBlink: true,
    cursorStyle: "bar",
    cursorInactiveStyle: "outline",
    allowProposedApi: true,
    fontFamily: isMac() ? MAC_FONT : OTHER_FONT,
    fontSize: 13,
    lineHeight: 1.15,
    theme: readTerminalTheme(),
    scrollback: SCROLLBACK,
    macOptionIsMeta: true,
    macOptionClickForcesSelection: true,
    drawBoldTextInBrightColors: true,
    minimumContrastRatio: 1.5,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new Unicode11Addon());
  term.unicode.activeVersion = "11";
  term.loadAddon(new WebLinksAddon((_e, uri) => void fileOpenApi.url(uri)));
  const host = document.createElement("div");
  host.className = "term-host";

  let entry: Entry | null = null;
  // 셸이 open 이 돌아오기 전에 끝날 수도 있다 — 그 끝을 받아 뒀다가 표에 넣을 때 적는다.
  let earlyExit: { code: number | null } | null = null;
  // 첫 출력이 open 이 돌아오기 전에 올 수 있다 — xterm 은 open() 전에도 버퍼에 쓴다.
  // 「다음」 실행이면 첫머리에서 claude 를 못 찾았는지 본다 — 찾았든 못 찾았든 한 번만.
  let launchHead: string | null = prompt ? "" : null;
  const onEvent = (ev: TermEvent) => {
    if (ev.kind === "output") {
      term.write(ev.data);
      if (launchHead !== null) {
        launchHead += ev.data;
        if (launchFailed(launchHead)) {
          launchHead = null;
          toast.warning(t("terminal.launchFailed"), { durationMs: 15000 });
        } else if (launchHead.length > LAUNCH_WATCH_CHARS) {
          launchHead = null;
        }
      }
      return;
    }
    if (ev.kind === "status") {
      // 프로그램 상태(OSC 7501) — open 이 돌아온 뒤에야 오지만(탐침 답이 먼저다) 앞서 오면 버린다.
      if (!entry) return;
      const prev = entry.info.status;
      entry.info = { ...entry.info, status: ev.status };
      alertIfWaiting(prev, entry.info);
      notify();
      return;
    }
    if (!entry) {
      earlyExit = { code: ev.code };
      return;
    }
    entry.info = { ...entry.info, alive: false, exit_code: ev.code };
    notify();
  };
  let info: TermInfo;
  try {
    info = await terminalApi.open(projectId, term.cols, term.rows, prompt, onEvent);
  } catch (e) {
    term.dispose();
    throw e;
  }
  if (earlyExit) info = { ...info, alive: false, exit_code: (earlyExit as { code: number | null }).code };
  entry = { info, term, fit, host, opened: false, disposeIme: null };
  entries.set(info.id, entry);
  const id = info.id;
  term.onData((data) => void terminalApi.write(id, data).catch(() => {}));
  term.onResize(({ cols, rows }) => void terminalApi.resize(id, cols, rows).catch(() => {}));
  notify();
  return id;
}

/** 세션의 화면을 `container` 에 붙이고 칸에 맞춘다. 처음이면 xterm 을 연다. */
export function mountTerm(id: number, container: HTMLElement): () => void {
  const e = entries.get(id);
  if (!e) return () => {};
  container.appendChild(e.host);
  if (!e.opened) {
    e.term.open(e.host);
    const ime = attachImeBridge(e.term, e.host);
    e.disposeIme = () => ime.dispose();
    e.opened = true;
  }
  // WebGL 렌더러 — 박스 그림 문자(Claude Code 배너 · 표)를 xterm 이 직접 이어 그린다(DOM 렌더러는
  // 글꼴 글리프라 점선처럼 끊겼다). **보이는 세션에만** 붙이고 내려가면 반납한다 — 세션마다 문맥을
  // 쥐면 브라우저 상한(약 16)과 GPU 메모리를 먹었다(3.x 「WebGL 반납」). 못 쓰면 DOM 그대로.
  let webgl: WebglAddon | null = null;
  try {
    webgl = new WebglAddon();
    webgl.onContextLoss(() => {
      webgl?.dispose();
      webgl = null;
    });
    e.term.loadAddon(webgl);
  } catch {
    webgl = null;
  }
  const refit = () => {
    if (e.host.clientWidth > 0 && e.host.clientHeight > 0) e.fit.fit();
  };
  refit();
  const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(refit);
  ro?.observe(container);
  e.term.focus();
  return () => {
    ro?.disconnect();
    webgl?.dispose();
    if (e.host.parentElement === container) container.removeChild(e.host);
  };
}

export function focusTerm(id: number) {
  entries.get(id)?.term.focus();
}

/** 세션을 닫는다 — 셸을 죽이고 화면을 버린다. */
export function closeTerm(id: number) {
  const e = entries.get(id);
  void terminalApi.close(id).catch(() => {});
  if (!e) return;
  e.disposeIme?.();
  e.term.dispose();
  e.host.remove();
  entries.delete(id);
  notify();
}
