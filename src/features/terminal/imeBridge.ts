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
// 일반 영문 타이핑은 xterm 이 keydown 에서 preventDefault 하므로 `input` 이
// 아예 발생하지 않는다(실측). 따라서 **우리에게 도달하는 input 은 전부
// IME·받아쓰기 발원**이고, 전량 가로채도 일반 입력을 해치지 않는다.
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
   * 직전 keydown 이후 input 이 있었는가. 이 웹뷰는 IME 키에 대해 input 을
   * keydown **보다 먼저** 보내므로, keydown 시점의 이 값은 곧 "이 키의 글자는
   * 이미 input 으로 처리했다"는 뜻이다. 조합을 확정시키는 스페이스가 대표적인데,
   * 그때 keydown 은 조합이 끝난 뒤라 keyCode 가 229 가 아니어서 그냥 두면 xterm
   * 이 공백을 한 번 더 보낸다(= 공백이 두 칸으로 보이던 증상).
   */
  let inputSinceKeydown = false;

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
    inputSinceKeydown = true;
    const value = textarea?.value ?? "";
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
      const handledByInput = inputSinceKeydown;
      inputSinceKeydown = false;
      trace("keydown", {
        key: event.key,
        keyCode: event.keyCode,
        isComposing: event.isComposing,
        imeKey,
        handledByInput,
      });
      // Enter·Tab 은 조합을 끝낸다. 글자는 이미 셸에 올라가 있으므로 세션만
      // 정리하고 xterm 이 CR/TAB 을 보내게 둔다.
      if (event.key === "Enter" || event.key === "Tab") endSession();
      // 이 키의 글자를 input 이 이미 보냈다면 xterm 이 또 보내면 안 된다
      // (조합을 확정시키는 스페이스가 두 칸으로 찍히던 원인).
      if (handledByInput && event.key.length === 1) return false;
    }

    // 조합 중인 키를 xterm 이 preventDefault 하면 IME 가 조합을 이어가지 못한다.
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
  return /[ᄀ-ᇿ㄰-㆏ꥠ-꥿가-힣ힰ-퟿]/.test(char);
}
