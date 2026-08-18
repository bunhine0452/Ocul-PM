import type { Terminal } from "@xterm/xterm";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { attachImeBridge } from "@/features/terminal/imeBridge";

// 실제 WKWebView 트레이스(oculpm.log 2026-08-01)를 재현해 브리지 판정을 검증한다.
// 조합 렌더링 자체는 실 IME 가 필요해 검증 불가 — 여기서는 "PTY 로 몇 번 나가는가"와
// "xterm 에게 넘기는가"만 본다.
//
// 트레이스가 알려준 두 가지 순서:
//   한글       input(insertText 'ㅏ') → keydown key='ㅏ' keyCode=229
//   ASCII·공백 keydown key=' ' code=32 → input(insertText ' ', textarea 는 NBSP)
// 후자는 xterm 과 브리지가 각각 한 번씩 보내 두 번 찍히던 경로다.

const NBSP = " ";

/** readline/ZLE 의 backward-delete-char — 브리지가 조합 교체분 앞에 붙인다. */
const DEL = "\u007f";

/** 브리지가 보낸 순서대로 DEL 을 적용해, 받는 쪽 입력줄에 남는 문자열을 얻는다. */
function applyDel(sent: string[]): string {
  let line = "";
  for (const ch of sent.join("")) line = ch === DEL ? line.slice(0, -1) : line + ch;
  return line;
}

interface Harness {
  /** 브리지가 PTY 로 보낸 문자열 (= term.input 인자). */
  sent: string[];
  /** 브리지 + xterm 을 합쳐 **PTY 가 받는 순서 그대로** 기록한 스트림. */
  stream: string[];
  handler: (event: KeyboardEvent) => boolean;
  textarea: HTMLTextAreaElement;
  dispose(): void;
}

function setup(): Harness {
  const container = document.createElement("div");
  const textarea = document.createElement("textarea");
  container.appendChild(textarea);
  document.body.appendChild(container);

  const sent: string[] = [];
  const stream: string[] = [];
  let handler: (event: KeyboardEvent) => boolean = () => true;
  const term = {
    textarea,
    input: (data: string) => {
      sent.push(data);
      stream.push(data);
    },
    attachCustomKeyEventHandler: (fn: (event: KeyboardEvent) => boolean) => {
      handler = fn;
    },
  } as unknown as Terminal;

  const bridge = attachImeBridge(term, container);
  return {
    sent,
    stream,
    get handler() {
      return handler;
    },
    textarea,
    dispose() {
      bridge.dispose();
      container.remove();
    },
  };
}

/** IME 가 조합 버퍼(textarea)를 갱신하며 쏘는 input. */
function fireInput(h: Harness, value: string, inputType = "insertText"): void {
  h.textarea.value = value;
  h.textarea.dispatchEvent(
    new InputEvent("input", { inputType, data: value, bubbles: true, composed: true }),
  );
}

/** keydown 을 핸들러에 통과시키고 "xterm 이 계속 처리해도 되는가"를 돌려준다. */
function fireKeydown(h: Harness, init: KeyboardEventInit): boolean {
  return h.handler(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
}

/**
 * keydown 을 흘리되, 브리지가 xterm 에게 넘긴(true) 인쇄 가능 키는 **xterm 이
 * keydown 에서 곧장 PTY 로 보낸다**는 사실까지 스트림에 반영한다. 기존 테스트가
 * 가정만 하던 부분 — 실제 xterm `_keyDown` 은 여기서 동기 전송한다.
 */
function fireKeydownThroughXterm(h: Harness, init: KeyboardEventInit): boolean {
  const pass = fireKeydown(h, init);
  const key = init.key ?? "";
  if (pass && key.length === 1 && !init.ctrlKey && !init.altKey && !init.metaKey) {
    h.stream.push(key);
  }
  return pass;
}

describe("imeBridge", () => {
  let h: Harness;
  beforeEach(() => {
    h = setup();
  });
  afterEach(() => h.dispose());

  test("영문: xterm 이 보낸 뒤 오는 input 은 에코라 다시 보내지 않는다", () => {
    // keydown 이 먼저 — 브리지는 xterm 에게 넘긴다(= xterm 이 'a' 를 보낸다).
    expect(fireKeydown(h, { key: "a", keyCode: 65 })).toBe(true);
    // 입력기가 켜져 있으면 같은 글자가 input 으로 한 번 더 올라온다.
    fireInput(h, "a");
    expect(h.sent).toEqual([]); // 브리지는 보내지 않는다 → 총 1회
  });

  test("스페이스: NBSP 로 올라오는 에코도 걸러낸다", () => {
    expect(fireKeydown(h, { key: " ", keyCode: 32 })).toBe(true);
    fireInput(h, NBSP); // 트레이스 그대로 — textarea 에는 NBSP 가 들어온다
    expect(h.sent).toEqual([]);
  });

  test("조합 뒤 스페이스: 앞 글자는 유지하고 공백은 정확히 한 번만 나간다", () => {
    fireInput(h, "ㅏ");
    expect(fireKeydown(h, { key: "ㅏ", keyCode: 229 })).toBe(false);
    expect(h.sent).toEqual(["ㅏ"]);

    // 조합이 열려 있는 동안의 스페이스는 **브리지가** 내보낸다 (2026-08-19).
    // xterm 이 keydown 에서 먼저 쏘면 뒤늦은 교체분의 DEL 이 그 스페이스를
    // 지워 이전 글자가 남는다 — 그래서 여기서 xterm 에게 넘기지 않는다.
    expect(fireKeydownThroughXterm(h, { key: " ", keyCode: 32 })).toBe(false);
    fireInput(h, `ㅏ${NBSP}`);
    expect(applyDel(h.stream)).toBe("ㅏ "); // 공백 1회, NBSP 아닌 보통 공백
  });

  test("한글 조합: xterm 에 넘기지 않고 브리지가 교체분만 보낸다", () => {
    fireInput(h, "ㅊ");
    expect(fireKeydown(h, { key: "ㅊ", keyCode: 229 })).toBe(false);
    fireInput(h, "치", "insertReplacementText");
    expect(h.sent.join("")).toBe("ㅊ치"); // DEL 로 낱자를 되돌리고 완성형 전송
  });

  test("에코가 없는 input 은 그대로 보낸다 (NBSP 는 공백으로 정규화)", () => {
    fireInput(h, NBSP); // 앞선 keydown 없음 = xterm 이 보낸 적 없음
    expect(h.sent).toEqual([" "]);
  });

  test("빠른 타이핑: keydown 두 개가 몰려도 각 에코를 짝지어 삼키지 않는다", () => {
    // 실측 연속 keydown 간격 최소 0ms — input 이 뒤늦게 도착할 수 있다.
    expect(fireKeydown(h, { key: "a", keyCode: 65 })).toBe(true);
    expect(fireKeydown(h, { key: "b", keyCode: 66 })).toBe(true);
    fireInput(h, "a");
    // 'a' 는 조합 대상이 아니라 세션이 끊기고 textarea 가 비워진다 → 다음 에코는 "b".
    expect(h.textarea.value).toBe("");
    fireInput(h, "b");
    expect(h.sent).toEqual([]); // 둘 다 에코 — 브리지는 아무것도 보태지 않는다
  });

  test("에코와 다른 글자는 삼키지 않는다", () => {
    expect(fireKeydown(h, { key: "a", keyCode: 65 })).toBe(true);
    fireInput(h, "ㅁ"); // 한/영 전환 직후 조합 시작 — 'a' 에코가 아니다
    expect(h.sent).toEqual(["ㅁ"]);
  });

  test("Backspace 는 부기를 리셋한다 — 어긋난 채 누적되지 않는다", () => {
    fireInput(h, "가");
    expect(h.sent).toEqual(["가"]);

    expect(fireKeydown(h, { key: "Backspace", keyCode: 8 })).toBe(true);
    expect(h.textarea.value).toBe("");

    fireInput(h, "나"); // 새 세션 — 앞 글자를 지우는 DEL 이 붙지 않는다
    expect(h.sent).toEqual(["가", "나"]);
  });

  test("붙여넣기는 xterm 몫 — 브리지가 다시 보내지 않는다", () => {
    // xterm 의 handlePasteEvent 는 preventDefault 를 하지 않아(5.5) 이미 PTY 로
    // 보낸 뒤에도 textarea 에 텍스트가 꽂히고 insertFromPaste 가 여기로 올라온다.
    // 여기서 또 보내면 내용이 두 번 들어가고, bracketed paste 가 아니라 개행이
    // 날것으로 나가 셸이 각 줄을 실행한다.
    fireInput(h, "첫 줄\n둘째 줄\n", "insertFromPaste");
    expect(h.sent).toEqual([]);
    expect(h.textarea.value).toBe(""); // 다음 조합이 붙여넣기 잔재와 섞이지 않게
  });

  test("Enter 는 xterm 이 CR 을 보내도록 넘긴다", () => {
    fireInput(h, "가");
    expect(fireKeydown(h, { key: "Enter", keyCode: 13 })).toBe(true);
  });

  test("⌘·Ctrl 조합은 에코 기록 대상이 아니다", () => {
    expect(fireKeydown(h, { key: "v", keyCode: 86, metaKey: true })).toBe(true);
    fireInput(h, "v"); // 붙여넣기 등으로 올라온 'v' 는 에코가 아니라 실제 입력
    expect(h.sent).toEqual(["v"]);
  });

  // ── 조합 중 Backspace (2026-08-18) ────────────────────────────────────────
  // 한글 입력기에서 조합 중에 누른 Backspace 는 "글자를 지우는" 키가 아니라
  // 음절을 한 단계 분해하는 IME 동작이라 keyCode 229 로 온다 (트레이스 확인:
  // `keydown Backspace keyCode=229 imeKey=true`). 분해 결과는 바로 앞 input 이
  // 이미 syncEcho 로 맞춰 놓은 뒤라, 여기서 부기를 비우면 IME 는 아직 같은
  // 조합을 붙들고 있는데 우리 기준만 "" 이 된다. 그러면 다음 교체분이 DEL 없이
  // 통째로 나가 앞 글자가 화면에 그대로 남는다 — 한글이 두 번 찍히던 원인.
  test("조합 중 Backspace(229) 뒤에도 교체분은 DEL 을 달고 나간다", () => {
    fireInput(h, "ㅊ");
    fireKeydown(h, { key: "ㅊ", keyCode: 229 });
    fireInput(h, "치", "insertReplacementText");
    fireKeydown(h, { key: "ㅣ", keyCode: 229 });

    fireInput(h, "ㅊ", "insertReplacementText"); // 치 → ㅊ 분해
    expect(fireKeydown(h, { key: "Backspace", keyCode: 229 })).toBe(false);
    expect(h.textarea.value).toBe("ㅊ"); // 조합이 살아 있으므로 버퍼를 비우지 않는다

    fireInput(h, "차", "insertReplacementText");
    expect(h.sent[h.sent.length - 1]).toBe(`${DEL}차`); // DEL 없이 "차" 만 나가면 화면은 "ㅊ차"
  });

  test("조합 중 Backspace 를 두 번 눌러도 앞 글자가 남지 않는다", () => {
    fireInput(h, "ㅎ");
    fireKeydown(h, { key: "ㅎ", keyCode: 229 });
    fireInput(h, "하", "insertReplacementText");
    fireKeydown(h, { key: "ㅏ", keyCode: 229 });
    fireInput(h, "한", "insertReplacementText");
    fireKeydown(h, { key: "ㄴ", keyCode: 229 });

    fireInput(h, "하", "insertReplacementText"); // 한 → 하
    fireKeydown(h, { key: "Backspace", keyCode: 229 });
    fireInput(h, "ㅎ", "insertReplacementText"); // 하 → ㅎ
    fireKeydown(h, { key: "Backspace", keyCode: 229 });

    fireInput(h, "호", "insertReplacementText");
    // 셸이 받은 순서대로 DEL 을 적용하면 정확히 "호" 하나만 남아야 한다.
    expect(applyDel(h.sent)).toBe("호");
  });

  test("조합이 아닌 Backspace(8) 는 여전히 부기를 리셋한다", () => {
    fireInput(h, "가");
    expect(fireKeydown(h, { key: "Backspace", keyCode: 8 })).toBe(true);
    expect(h.textarea.value).toBe(""); // xterm 이 DEL 을 보내 셸에서 지운다
  });

  // ── 커서 이동 키 (2026-08-19) ─────────────────────────────────────────────
  // macOS 입력기는 화살표·Home/End 에서 조합을 확정한다. 세션을 리셋하지
  // 않으면 echoed 가 이동 전 위치 기준으로 남아, 다음 조합의 DEL 이 커서
  // 옆의 엉뚱한 글자를 지운다. 조합 내비게이션 키는 229 로 오므로 여기서
  // 다루는 건 비조합(!imeKey) 커서 키뿐이다.
  test("조합이 아닌 화살표 키는 부기를 리셋한다 — 다음 조합이 DEL 없이 새로 시작한다", () => {
    fireInput(h, "가");
    expect(h.sent).toEqual(["가"]);

    expect(fireKeydown(h, { key: "ArrowLeft", keyCode: 37 })).toBe(true); // xterm 이 ESC[D 전송
    expect(h.textarea.value).toBe("");

    fireInput(h, "ㄴ"); // 새 조합 — 이동 전 "가" 를 지우는 DEL 이 붙으면 안 된다
    expect(h.sent).toEqual(["가", "ㄴ"]);
  });

  test("조합 중(229) 화살표 키는 세션을 유지한 채 xterm 에서 걷어낸다", () => {
    fireInput(h, "가");
    expect(fireKeydown(h, { key: "ArrowLeft", keyCode: 229 })).toBe(false);
    expect(h.textarea.value).toBe("가"); // 조합이 살아 있으므로 버퍼 유지

    fireInput(h, "간", "insertReplacementText");
    expect(h.sent.join("")).toBe(`가${DEL}간`); // 기준선이 살아 있어 DEL 로 교체된다
  });

  // ── 조합 중 스페이스 (2026-08-19) ─────────────────────────────────────────
  // IME 의 **내용을 바꾸는 교체 input** 은 keydown 보다 60~250ms 늦게 온다
  // (실측 트레이스: 최대 242.7ms). 그 창 안에 스페이스를 치면 xterm 이
  // keydown 에서 스페이스를 먼저 PTY 로 쏘고, 뒤늦게 도착한 교체분의 DEL 이
  // 조합 글자가 아니라 **그 스페이스**를 지운다 → 이전 글자가 남고 스페이스는
  // 사라진다 ("드든 ").
  test("조합 중 스페이스: 뒤늦은 교체분이 스페이스를 먹고 이전 글자를 남기지 않는다", () => {
    fireInput(h, "ㄷ");
    fireKeydownThroughXterm(h, { key: "ㄷ", keyCode: 229 });
    fireInput(h, "드", "insertReplacementText");
    fireKeydownThroughXterm(h, { key: "ㅡ", keyCode: 229 });

    // 교체분(든)이 오기 전에 스페이스를 친다.
    fireKeydownThroughXterm(h, { key: " ", keyCode: 32 });
    fireInput(h, "든 ", "insertReplacementText");

    expect(applyDel(h.stream)).toBe("든 ");
  });

  test("조합 중 스페이스: 교체분이 두 번에 나눠 와도 결과가 같다", () => {
    fireInput(h, "ㄷ");
    fireKeydownThroughXterm(h, { key: "ㄷ", keyCode: 229 });
    fireInput(h, "드", "insertReplacementText");
    fireKeydownThroughXterm(h, { key: "ㅡ", keyCode: 229 });

    fireKeydownThroughXterm(h, { key: " ", keyCode: 32 });
    fireInput(h, "든", "insertReplacementText"); // 교체분 먼저
    fireInput(h, "든 ");                          // 그 다음 스페이스 확정

    expect(applyDel(h.stream)).toBe("든 ");
  });

  test("조합이 없을 때 스페이스는 종전대로 xterm 이 보낸다 (두 번 찍히지 않음)", () => {
    fireKeydownThroughXterm(h, { key: " ", keyCode: 32 });
    fireInput(h, NBSP);
    expect(applyDel(h.stream)).toBe(" ");
  });

  test("조합 중 스페이스: 뒤따르는 keypress 로 xterm 이 다시 보내지 않는다", () => {
    fireInput(h, "ㅏ");
    fireKeydown(h, { key: "ㅏ", keyCode: 229 });
    expect(fireKeydownThroughXterm(h, { key: " ", keyCode: 32 })).toBe(false);
    // input 이 keypress 보다 먼저 와 세션이 끝난 경우까지 포함해 막아야 한다.
    fireInput(h, `ㅏ${NBSP}`);
    const keypress = h.handler(
      new KeyboardEvent("keypress", { key: " ", keyCode: 32, bubbles: true, cancelable: true }),
    );
    expect(keypress).toBe(false); // xterm 이 ' ' 를 또 보내면 두 칸이 된다
  });

  test("조합이 아닌 Escape 는 부기를 리셋한다 (vim 등에서 한글 입력 직후 Esc)", () => {
    fireInput(h, "가");
    expect(fireKeydown(h, { key: "Escape", keyCode: 27 })).toBe(true); // xterm 이 ESC 전송
    expect(h.textarea.value).toBe("");
  });
});
