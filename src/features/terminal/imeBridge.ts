import type { Terminal } from "@xterm/xterm";
import { oculpmLog } from "@/lib/oculpmLog";
import { dumpImeTrace, pushImeTrace } from "./imeTrace";

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

/**
 * 조합이 아닐 때(!imeKey) 부기 기준선을 리셋해야 하는 키. Backspace·Delete 는
 * xterm 이 셸에서 지우는데 textarea 는 그대로라서, 커서 이동·Escape 는 셸
 * 커서가 echoed 의 끝에서 떠나 이후 DEL 이 엉뚱한 글자를 지울 수 있어서다.
 */
const SESSION_END_KEYS = new Set([
  "Backspace",
  "Delete",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Escape",
]);

// ── 2026-08-19: 조합 중 스페이스가 이전 글자를 반복시키던 문제 ─────────────
// 실측 트레이스로 확인한 사실: IME 의 **내용을 바꾸는 교체 input** 은 keydown
// 보다 60~250ms 늦게 온다 (최대 242.7ms: `침여`→`침ㅇ`).
//
// 그 지연 창 안에 스페이스를 치면 순서가 이렇게 뒤집힌다:
//
//   echoed="드"                     (PTY 줄: "드")
//   keydown ' ' → xterm 이 즉시 전송  (PTY 줄: "드 ")   ← 브리지 밖에서 끼어든다
//   input "든 " (뒤늦은 교체분)       → 브리지는 echoed="드" 기준으로 DEL+"든 "
//   PTY 줄: "드 " -DEL→ "드" +"든 " = "드든 "            ← 이전 글자가 남는다
//
// DEL 은 조합 글자를 되돌리려던 것인데 방금 나간 **스페이스**를 지운다. 원인은
// 부기가 아니라 **소유권**이다 — 조합이 열려 있는 동안 PTY 로 나가는 바이트는
// 전부 브리지의 한 경로(syncEcho)를 지나야 순서가 보장된다.

// ── 2026-08-19(2): 스페이스 뒤 앞 음절이 다시 찍히던 문제 (프로덕션 전용) ──
// 증상: "안녕" 뒤 스페이스 → "안녕 녕". dev 빌드에서는 재현되지 않고 **릴리스
// 빌드에서만** 났다. 터미널 경로의 dev/prod 차이는 두 가지뿐인데(이벤트마다
// IPC 로그를 하는 TRACE, dev 전용 React.StrictMode) 둘 다 dev 를 느리게 만든다
// — 즉 빠른 쪽에서만 드러나는 **타이밍 경합**이다.
//
// 경로: 스페이스로 조합이 확정되면 꼬리가 조합 대상이 아니므로 endSession() 이
// textarea 를 비운다. 그런데 입력기가 아직 확정분을 붙들고 있으면, 비워진
// 버퍼에 **조합 잔여분을 다시 올린다**. 그때 우리 기준은 이미 "" 라 그 잔여분이
// 새 입력으로 보여 DEL 없이 통째로 나간다 → 앞 음절이 스페이스 뒤에 재등장.
//
//   echoed="안녕" → 스페이스 → " " 전송 → endSession(textarea="")
//   input "녕"(잔여분) → echoed="" 기준 → "녕" 전송 → "안녕 녕"
//
// 세션이 없는 상태(echoed === "")에서 올라온 **조합 잔여분은 되돌릴 대상이
// 없으므로 정의상 stale** 이다 — 흘리지 않고 버린다.

// ── 2026-08-20: 같은 증상이 v2.13.3 뒤에도 남아 있었다 ────────────────────
// 위 판별에 구멍이 둘 있었다. 둘 다 "확정과 잔여분 사이"에서 벌어진다.
//
// (1) **빈 input 한 건이 근거를 지웠다.** 확정 처리는 `lastCommitted` 에 방금
//     내보낸 문자열을 적어 두고, 잔여분이 오면 그 꼬리와 대조한다. 그런데
//     기록하는 자리가 `if (!value || 조합 아님)` 안이라 **value 가 빈 문자열일
//     때도 덮어썼다**. 확정 직후 입력기가 버퍼를 한 번 비우고("") 나서 잔여분을
//     올리면, 그 빈 건이 `lastCommitted` 를 "" 로 만들어 뒤이은 "녕" 이 대조에
//     걸리지 않는다 → 그대로 나간다.
//
//       input "안녕 " → 확정, lastCommitted="안녕 "
//       input ""      → lastCommitted="" 로 덮임          ← 근거 소실
//       input "녕"    → "".endsWith("녕") = false → 전송 → "안녕 녕"
//
// (2) **잔여분이 확정한 공백까지 끌고 오면** 꼬리가 " " 라 `isComposable` 검사에
//     걸려 판별 자체를 시작하지 못했다 ("녕 " 형태). 끝의 공백은 떼고 본다.

/** 잔여 조합이 확정한 공백까지 끌고 올 때 떼어내는 꼬리 (NBSP 포함). */
const TRAILING_SPACE = /\s+$/;

/** 확정 직후 잔여 조합으로 인정하는 시간 창. */
const STALE_COMMIT_WINDOW_MS = 400;

/** 개발 빌드에서만 IPC 로그까지 태운다 — 링 버퍼는 릴리스에서도 항상 돈다. */
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
    // 링은 릴리스에서도 돈다 (imeTrace.ts) — 배열 한 칸 쓰기라 경합을 안 바꾼다.
    pushImeTrace(event, { ...detail, echoed, textarea: textarea?.value ?? null });
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

  /**
   * 조합이 열려 있는 동안(echoed 비어 있지 않음) 찍힌 인쇄 가능 키인가.
   * 그렇다면 xterm 이 아니라 **브리지가** 내보내야 한다 (위 2026-08-19 주석).
   * echoed 는 조합 대상이 아닌 글자에서 매번 비워지므로, 비어 있지 않다는 건
   * 곧 한글 조합이 진행 중이라는 뜻 — 그 상태에선 모든 인쇄 키가 IME 를 거쳐
   * input 으로 올라온다(실측). Enter·Tab·화살표 등은 key.length > 1 이라
   * 여기 걸리지 않고 종전대로 xterm 이 보낸다.
   */
  const bridgeOwnsKey = (event: KeyboardEvent): boolean =>
    echoed !== "" &&
    event.key.length === 1 &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey;

  /**
   * 방금 keydown 에서 브리지가 가져간 키. 뒤따르는 keypress 를 막는 데 쓴다 —
   * keydown 에서 preventDefault 를 하지 않으므로 keypress 가 올 수 있고, 넘기면
   * xterm 이 같은 글자를 또 보낸다. `echoed` 로 다시 판정하지 않는 건 그 사이
   * input 이 먼저 와서 세션이 끝났을 수 있어서다 (그때 echoed 는 이미 "").
   */
  let ownedKeydown: string | null = null;

  /** 방금 확정해 셸로 내보낸 문자열과 그 시각 — 잔여 조합 판별용. */
  let lastCommitted = "";
  let lastCommittedAt = 0;

  /** 조합 세션을 끝낸다 — 버퍼를 비우고 다음 세션을 새로 시작하게 한다. */
  const endSession = () => {
    if (textarea) textarea.value = "";
    echoed = "";
  };

  /**
   * 세션이 없는데(`echoed === ""`) 올라온 **입력기의 잔여 조합**인가.
   * 되돌릴 기준이 없으므로 그대로 흘리면 앞 음절이 다시 찍힌다(위 주석).
   *
   * 두 가지로 가린다:
   *   1. `insertReplacementText` — 교체할 대상이 없는 교체는 정의상 stale.
   *   2. 방금 확정한 문자열의 **한글 꼬리**와 같은 값 — 예: "안녕 " 확정 직후의
   *      "녕". 새 조합은 언제나 낱자("ㄴ")로 시작하므로 완성형 음절이 첫 input
   *      으로 오는 일은 정상 타이핑에 없다.
   */
  const sinceCommit = () => Date.now() - lastCommittedAt;

  const isStaleCommitEcho = (inputType: string, value: string): boolean => {
    if (echoed !== "" || !value) return false;
    if (sinceCommit() > STALE_COMMIT_WINDOW_MS) return false;
    // 잔여분이 확정한 공백까지 끌고 오는 일이 있다("녕 "). 그대로 보면 꼬리가
    // 공백이라 조합 검사에서 튕겨 나가 판별을 시작조차 못 한다.
    const tail = value.replace(TRAILING_SPACE, "");
    if (!tail || !isComposable(tail.slice(-1))) return false;
    if (inputType === "insertReplacementText") return true;
    return lastCommitted.trimEnd().endsWith(tail);
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
    const inputType = (event as InputEvent).inputType ?? "";
    trace("input", { inputType, data: (event as InputEvent).data, value });

    // 확정 직후 입력기가 비워진 버퍼에 다시 올린 잔여 조합 — 흘리면 앞 음절이
    // 스페이스 뒤에 재등장한다. 버퍼만 다시 비우고 버린다.
    if (isStaleCommitEcho(inputType, value)) {
      trace("stale-commit-echo", { inputType, value });
      endSession();
      return;
    }

    // 위 판별을 빠져나왔는데 **모양은 잔여분** — 놓친 경로일 수 있다.
    //
    // 네 번 재발한 버그가 지나간 자리다. 지나갈 때마다 그때까지의 흐름을 통째로
    // 로그에 남겨 두면, 다음에 또 새더라도 추측이 아니라 트레이스로 시작한다.
    //
    // "모양은 잔여분" 을 좁게 잡는 것이 중요하다 — 확정 직후라는 조건만으로는
    // **낱말 사이마다** 걸린다(스페이스 뒤 새 조합의 첫 낱자). 새 조합은 언제나
    // 낱자(ㅈ)로 시작하므로, **완성형 음절만으로 이루어진 값**은 정상 타이핑에
    // 첫 input 으로 오지 않는다. 그것만 남긴다.
    if (isLeftoverShaped(value) && echoed === "" && sinceCommit() <= STALE_COMMIT_WINDOW_MS) {
      trace("post-commit-passthrough", { inputType, value, lastCommitted });
      dumpImeTrace("post-commit-passthrough");
    }

    const had = echoed;
    syncEcho(value);
    // 버퍼가 무한정 자라면 공통 접두사 비교가 길어지기만 한다. 조합이 끝나
    // 더 바뀔 일이 없는 상태(꼬리가 조합 대상이 아님)면 세션을 끊는다.
    if (!value || !isComposable(value.slice(-1))) {
      // **빈 값으로는 확정 기록을 덮지 않는다.** 실어 나를 것이 없었던(had === "")
      // 빈 input 은 아무 일도 아닌데, 그 한 건이 잔여분을 가려낼 근거를 지웠다
      // (위 (1)). 지울 것이 있었던 빈 값은 진짜 삭제이므로 그대로 기록한다.
      if (value || had) {
        lastCommitted = value;
        lastCommittedAt = Date.now();
      }
      endSession();
    }
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
      // ⌃⌥⇧I — 그때까지의 입력 흐름을 로그 파일로 비운다. 한글 입력이 이상하게
      // 동작한 **직후** 눌러 달라고 안내하면, 릴리스 빌드에서도 재현 순간의
      // 트레이스를 그대로 받을 수 있다 (imeTrace.ts).
      if (event.ctrlKey && event.altKey && event.shiftKey && event.code === "KeyI") {
        const count = dumpImeTrace("manual");
        oculpmLog.info("ime", `[IME-DUMP] manual dump requested — ${count} events`);
        return false;
      }
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
      //
      // 단 **조합 중인 Backspace 는 예외**다 (2026-08-18). 한글 입력기에서
      // 조합 중에 누른 Backspace 는 "글자를 지우는" 키가 아니라 음절을 한 단계
      // 분해하는 IME 동작이라 keyCode 229 로 온다 — 게다가 바로 앞 input 이
      // 분해 결과(`치`→`ㅊ`)를 이미 syncEcho 로 맞춰 놓은 뒤다. 여기서 부기를
      // 비우면 IME 는 아직 같은 조합을 붙들고 있는데 우리 기준만 "" 이 돼,
      // 다음 교체분(`차`)이 DEL 없이 통째로 다시 나간다 → 화면에 `ㅊ차`.
      // 한글 문장을 길게 치며 오타를 지울 때마다 글자가 두 번 남던 원인이다.
      //
      // 커서 이동 키·Escape(2026-08-19)도 같은 이유로 세션을 끊는다 — macOS
      // 입력기는 화살표·Home/End 에서 조합을 확정하는데, 여기서 기준선을
      // 리셋하지 않으면 echoed 가 이동 전 위치 기준으로 남아, 다음 조합의
      // DEL 이 커서 옆의 엉뚱한 글자를 지울 수 있다. 조합 내비게이션으로
      // 쓰이는 키는 229(imeKey)로 오므로 !imeKey 가드가 그대로 지켜준다.
      if (event.key === "Enter" || event.key === "Tab") endSession();
      else if (SESSION_END_KEYS.has(event.key) && !imeKey) endSession();

      // 조합 중인 키만 xterm 에서 걷어낸다. 조합 이벤트를 쏘지 않는 웹뷰라
      // keyCode 229 가 유일하게 믿을 수 있는 신호다 (트레이스의 input→keydown
      // 287건이 전부 229). 여기서 preventDefault 하면 IME 가 조합을 못 잇는다.
      if (imeKey) return false;

      // 조합이 열려 있으면 인쇄 가능 키도 xterm 에게 넘기지 않는다 — 뒤이어 올
      // IME 의 input 이 syncEcho 를 타고 **교체분 뒤에** 나가야 순서가 맞는다.
      // (여기서 preventDefault 는 하지 않으므로 IME 는 조합을 그대로 잇는다.)
      if (bridgeOwnsKey(event)) {
        ownedKeydown = event.key;
        return false;
      }
      ownedKeydown = null;

      // xterm 이 이 키의 글자를 PTY 로 보낸다. 입력기가 켜져 있으면 곧이어 같은
      // 글자가 input 으로도 올라오므로, 그 에코를 걸러내려고 기록해둔다.
      if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
        xtermEchoes.push({ char: event.key, at: Date.now() });
      }
      return true;
    }

    if (imeKey) return false;
    // keydown 에서 preventDefault 를 하지 않았으므로 keypress 가 뒤따른다 —
    // 여기서 넘기면 xterm 이 같은 글자를 또 보낸다.
    if (event.type === "keypress" && ownedKeydown === event.key) {
      ownedKeydown = null;
      return false;
    }
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

/**
 * 확정 잔여분의 **모양**인가 — 완성형 음절만으로 이루어졌는가.
 *
 * 새 조합은 언제나 낱자(`ㅈ`)로 시작하므로 완성형만 든 값이 조합의 첫 input 으로
 * 오는 일은 정상 타이핑에 없다. 진단 기록을 좁히는 데만 쓴다(전송 판단 아님).
 */
function isLeftoverShaped(value: string): boolean {
  const tail = value.replace(TRAILING_SPACE, "");
  // i18n-ignore-next-line -- 한글 완성형 음절 범위 (표시 문자열이 아니라 모양 판정용)
  return tail.length > 0 && /^[가-힣]+$/.test(tail);
}

/** 아직 교체될 수 있는 글자인가 — 한글 자모·완성형이면 조합이 이어질 수 있다. */
function isComposable(char: string): boolean {
  // i18n-ignore-next-line -- 한글 자모·완성형 범위 (표시 문자열이 아니라 조합 판정용)
  return /[ᄀ-ᇿ㄰-㆏ꥠ-꥿가-힣ힰ-퟿]/.test(char);
}
