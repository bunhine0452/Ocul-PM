import type { Terminal } from "@xterm/xterm";
import { oculpmLog } from "@/lib/oculpmLog";

// WKWebView 한글/CJK 입력 브리지 (2026-07-30)
//
// ── 실측으로 확인한 WKWebView 의 한글 입력 모델 ───────────────────────────
// 이 웹뷰는 한글 입력에서 **compositionstart/update/end 를 한 번도 쏘지 않는다.**
// (실제 트레이스: 조합 이벤트 0건, `isComposing` 끝까지 false.)
// 대신 `input` 이벤트만으로 조합이 진행되고, 숨은 textarea 가 조합 버퍼다.
//
//   input  inputType="insertText"             data="ㅊ"  textarea="ㅊ"
//   keydown key="ㅊ" keyCode=229                          ← input 뒤에 온다
//   input  inputType="insertReplacementText"  data="치"  textarea="치"
//   keydown key="ㅣ" keyCode=229
//
// 즉 조합 중인 글자는 `insertReplacementText` 로 통째로 교체되고, textarea 가
// 언제나 "지금 화면에 있어야 할 문자열" 전체를 들고 있다.
//
// ── 그래서 무엇이 깨졌었나 ────────────────────────────────────────────────
// 1) xterm 의 `_inputEvent` 는 `insertText` 를 보면 곧장 PTY 로 보낸다. 가드가
//    `!e.composed || !this._keyDownSeen` 인데 이 웹뷰는 **input 이 keydown 보다
//    먼저** 오므로 `_keyDownSeen` 이 아직 false → 가드가 뚫려 낱자 `ㅊ` 이 그대로
//    나가고, 뒤이어 교체본 `치` 도 나가 화면이 `ㅊ치` 처럼 뭉갰다.
// 2) 조합 중인 글자를 DOM 오버레이로 그리던 1차 대응은 위치가 어긋났다.
//    오버레이는 `buffer.active.cursorX` 에 놓이는데, 앞 글자의 커서 전진은
//    **셸 에코를 받아야** 반영된다(비동기). 한 박자 늦은 자리에 그려져
//    "가나다라마 사" 처럼 조합 글자가 앞으로 튀어나왔다.
//
// ── 처리 방식 ─────────────────────────────────────────────────────────────
// 입력기가 붙지 않은 배열(ABC 등)의 영문 타이핑은 xterm 이 keydown 에서
// preventDefault 하므로 `input` 이 아예 발생하지 않는다. 반면 **한글 입력기가
// 영문 모드일 때는 ASCII 도 IME 를 거쳐** input 이 먼저 온다. 즉 우리에게
// 도달하는 input 은 전부 IME·받아쓰기 발원이고, 전량 가로채도 일반 입력을
// 해치지 않는다 — 단 그 키를 xterm 이 다시 보내지 않게 막아야 한다(아래 참고).
//
// 오버레이를 쓰지 않고 조합 중인 글자까지 셸에 그대로 흘린다. textarea 가
// 바뀔 때마다 이전에 보낸 문자열과의 **공통 접두사**를 구해, 달라진 만큼만
// DEL(0x7f) 로 지우고 새 꼬리를 보낸다. 렌더링은 전부 터미널이 하므로 위치를
// 계산할 일이 없고, 셸 에코 지연과도 무관하다(비교 기준은 우리가 보낸 문자열).
//
//   ""    → "ㄱ"        : "ㄱ"
//   "ㄱ"  → "가"        : DEL + "가"
//   "가"  → "가ㄴ"      : "ㄴ"
//   "가ㄴ"→ "가나"      : DEL + "나"

/** readline/ZLE 의 backward-delete-char. 조합 중 글자가 바뀌면 되돌린다. */
const DEL = "";

// ── 2026-08-01: 영문·스페이스가 두 번 입력되던 문제 ───────────────────────
// 실제 트레이스(oculpm.log)로 확인한 사실:
//
//   05:29:15.139 keydown key=' ' code=32        ← xterm 이 여기서 ' ' 를 보낸다
//   05:29:15.141 input   data=' ' textarea='…\xa0'  ← 브리지가 여기서 또 보낸다
//
// **한글 입력기가 켜져 있으면 ASCII·스페이스도 input 을 한 번 더 만든다.** 다만
// 조합 키와 순서가 반대다 — 한글은 input→keydown, ASCII·스페이스는 keydown→input.
// 그래서 xterm 과 브리지가 같은 글자를 각각 한 번씩 보내 두 번 찍혔다.
// 게다가 IME 가 textarea 에 넣는 공백은 U+00A0(NBSP)라 셸에 NBSP 가 나가고 있었다.
//
// 판정은 타이밍으로 하지 않는다 — 실측상 연속 keydown 간격이 최소 0~7ms 라
// "직전에 input 이 있었나" 류의 시간 창은 오발동해 **멀쩡한 키를 삼킨다**.
// 대신 두 축으로 나눈다:
//   1. keydown 억제는 `imeKey`(keyCode 229)일 때만. 트레이스의 input→keydown
//      287건이 전부 229 였다 — 결정적 신호다.
//   2. 나머지는 xterm 이 보낸 글자를 기록해두고, 뒤늦게 같은 글자가 input 으로
//      올라오면 그 에코를 버린다.

/** IME 가 textarea 에 넣는 공백. 셸에 그대로 보내면 인자 구분이 깨진다. */
const NBSP = / /g;

/**
 * xterm 이 keydown 에서 보낸 글자의 에코를 인정하는 시간 창. 실측 keydown→input
 * 간격은 1~5ms 다. 창을 벗어난 기록은 "에코가 오지 않은 키"로 보고 버린다.
 */
const XTERM_ECHO_WINDOW_MS = 250;

/** 개발 빌드에서만 이벤트 흐름을 남긴다 (`<app_data>/logs/oculpm.log.*`). */
const TRACE = import.meta.env.DEV;

export interface ImeBridgeHandle {
  dispose(): void;
}

/**
 * `term` 은 이미 `open()` 된 상태여야 한다 (textarea 필요).
 * `container` 는 `term.open()` 에 넘긴 엘리먼트 — textarea 의 조상이어야 캡처
 * 단계에서 input 이벤트를 xterm 보다 먼저 받을 수 있다.
 */
export function attachImeBridge(term: Terminal, container: HTMLElement): ImeBridgeHandle {
  const textarea = term.textarea ?? null;

  /** 이번 조합 세션에서 셸 입력줄에 올려놓은 문자열 (우리가 보낸 것 기준). */
  let echoed = "";
  /**
   * xterm 이 keydown 에서 이미 PTY 로 보낸 글자들. 입력기가 켜져 있으면 같은
   * 글자가 곧이어 input 으로 한 번 더 올라오는데, 그건 이미 나간 글자의 에코이지
   * 새 입력이 아니다. 큐로 두는 건 타이핑이 빠르면 keydown 두 개가 input 보다
   * 먼저 몰릴 수 있어서다 (실측 keydown 간격 최소 0ms).
   */
  const xtermEchoes: { char: string; at: number }[] = [];

  /** `char` 가 xterm 이 방금 보낸 글자의 에코면 소비하고 true. */
  const takeXtermEcho = (char: string): boolean => {
    const now = Date.now();
    while (xtermEchoes.length && now - xtermEchoes[0].at > XTERM_ECHO_WINDOW_MS) {
      xtermEchoes.shift();
    }
    const index = xtermEchoes.findIndex((echo) => echo.char === char);
    if (index < 0) return false;
    xtermEchoes.splice(index, 1);
    return true;
  };

  const trace = (event: string, detail: Record<string, unknown>) => {
    if (!TRACE) return;
    oculpmLog.info("ime", event, { ...detail, echoed, textarea: textarea?.value ?? null });
  };

  /** 셸 입력줄을 `next` 와 같게 만든다 — 공통 접두사 뒤만 DEL 로 지우고 다시 쓴다. */
  const syncEcho = (next: string) => {
    let common = 0;
    while (common < echoed.length && common < next.length && echoed[common] === next[common]) {
      common += 1;
    }
    const removals = echoed.length - common;
    const addition = next.slice(common);
    echoed = next;
    if (removals === 0 && !addition) return;
    // 새로 붙은 꼬리가 xterm 이 방금 keydown 에서 보낸 그 글자면 에코다 —
    // 다시 보내면 영문·스페이스가 두 번 찍힌다. 부기(echoed)만 맞추고 끝낸다.
    if (removals === 0 && takeXtermEcho(addition)) return;
    term.input(DEL.repeat(removals) + addition, true);
  };

  /** 조합 세션을 끝낸다 — 버퍼를 비우고 다음 세션을 새로 시작하게 한다. */
  const endSession = () => {
    if (textarea) textarea.value = "";
    echoed = "";
  };

  /**
   * IME 가 만들어낸 모든 input. 일반 타이핑은 xterm 이 keydown 에서
   * preventDefault 하므로 여기까지 오지 않는다(실측).
   */
  const onInput = (event: Event) => {
    event.stopPropagation(); // xterm `_inputEvent` 의 낱자 중복 전송을 막는다

    // 붙여넣기는 xterm 이 `paste` 이벤트에서 이미 보냈다 — bracketed paste 로 감싸고
    // 개행을 CR 로 바꿔서. 그런데 xterm 의 handlePasteEvent 는 stopPropagation 만 하고
    // preventDefault 를 하지 않아(5.5) 브라우저가 textarea 에도 그대로 꽂고, 그 결과
    // 여기로 insertFromPaste 가 올라온다. 이걸 다시 보내면 같은 내용이 두 번 들어갈 뿐
    // 아니라 **우리 경로는 bracketed 가 아니라 개행이 날것으로 나가 셸이 각 줄을
    // 실행한다.** 그러니 전송하지 않고 버퍼만 정리한다.
    if ((event as InputEvent).inputType === "insertFromPaste") {
      trace("paste-ignored", { length: ((event as InputEvent).data ?? "").length });
      endSession();
      return;
    }
    // IME 는 공백을 NBSP 로 넣는다. 정규화한 값을 부기 기준으로 삼아야 셸에
    // NBSP 가 나가지 않고, xterm 이 보낸 ' ' 와 에코 대조도 성립한다.
    const value = (textarea?.value ?? "").replace(NBSP, " ");
    trace("input", {
      inputType: (event as InputEvent).inputType ?? "",
      data: (event as InputEvent).data,
      value,
    });
    syncEcho(value);
    // 버퍼가 무한정 자라면 공통 접두사 비교가 길어지기만 한다. 조합이 끝나
    // 더 바뀔 일이 없는 상태(꼬리가 조합 대상이 아님)면 세션을 끊는다.
    if (!value || !isComposable(value.slice(-1))) endSession();
  };

  // 조합 이벤트를 쏘는 엔진(Chromium 등)에서는 확정 문자열도 결국 textarea 에
  // 반영되므로 onInput 과 같은 규칙으로 처리된다. 여기서는 xterm 의
  // CompositionHelper 가 textarea 를 건드리지 못하게 막기만 한다.
  const stopComposition = (event: Event) => {
    event.stopPropagation();
    trace(event.type, { data: (event as CompositionEvent).data });
  };

  // 조합이 남은 채 포커스를 잃으면 이미 셸에 흘려둔 상태이므로 세션만 정리한다.
  const onBlur = () => endSession();

  container.addEventListener("input", onInput, true);
  container.addEventListener("compositionstart", stopComposition, true);
  container.addEventListener("compositionupdate", stopComposition, true);
  container.addEventListener("compositionend", stopComposition, true);
  textarea?.addEventListener("blur", onBlur);

  term.attachCustomKeyEventHandler((event) => {
    const imeKey = event.isComposing || event.keyCode === 229 || event.key === "Process";

    if (event.type === "keydown") {
      trace("keydown", {
        key: event.key,
        keyCode: event.keyCode,
        isComposing: event.isComposing,
        imeKey,
      });
      // Enter·Tab 은 조합을 끝낸다. 글자는 이미 셸에 올라가 있으므로 세션만
      // 정리하고 xterm 이 CR/TAB 을 보내게 둔다.
      // Backspace·Delete 는 xterm 이 셸에 지우라고 보내는데 textarea 는 그대로라,
      // 세션을 끊지 않으면 부기가 어긋난 채 계속 자란다(트레이스에서 30자 넘게
      // 누적된 채 남아 있었다). 다음 조합은 빈 상태에서 새로 시작하게 한다.
      if (event.key === "Enter" || event.key === "Tab") endSession();
      else if (event.key === "Backspace" || event.key === "Delete") endSession();

      // 조합 중인 키만 xterm 에서 걷어낸다. 조합 이벤트를 쏘지 않는 웹뷰라
      // keyCode 229 가 유일하게 믿을 수 있는 신호다 (트레이스의 input→keydown
      // 287건이 전부 229). 여기서 preventDefault 하면 IME 가 조합을 못 잇는다.
      if (imeKey) return false;

      // xterm 이 이 키의 글자를 PTY 로 보낸다. 입력기가 켜져 있으면 곧이어 같은
      // 글자가 input 으로도 올라오므로, 그 에코를 걸러내려고 기록해둔다.
      if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
        xtermEchoes.push({ char: event.key, at: Date.now() });
      }
      return true;
    }

    if (imeKey) return false;
    return true;
  });

  return {
    dispose() {
      container.removeEventListener("input", onInput, true);
      container.removeEventListener("compositionstart", stopComposition, true);
      container.removeEventListener("compositionupdate", stopComposition, true);
      container.removeEventListener("compositionend", stopComposition, true);
      textarea?.removeEventListener("blur", onBlur);
    },
  };
}

/** 아직 교체될 수 있는 글자인가 — 한글 자모·완성형이면 조합이 이어질 수 있다. */
function isComposable(char: string): boolean {
  // i18n-ignore-next-line -- 한글 자모·완성형 범위 (표시 문자열이 아니라 조합 판정용)
  return /[ᄀ-ᇿ㄰-㆏ꥠ-꥿가-힣ힰ-퟿]/.test(char);
}
