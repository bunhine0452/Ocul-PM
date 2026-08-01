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

interface Harness {
  /** 브리지가 PTY 로 보낸 문자열 (= term.input 인자). */
  sent: string[];
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
  let handler: (event: KeyboardEvent) => boolean = () => true;
  const term = {
    textarea,
    input: (data: string) => sent.push(data),
    attachCustomKeyEventHandler: (fn: (event: KeyboardEvent) => boolean) => {
      handler = fn;
    },
  } as unknown as Terminal;

  const bridge = attachImeBridge(term, container);
  return {
    sent,
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

  test("조합 뒤 스페이스: 앞 글자는 유지하고 공백만 에코로 걸러낸다", () => {
    fireInput(h, "ㅏ");
    expect(fireKeydown(h, { key: "ㅏ", keyCode: 229 })).toBe(false);
    expect(h.sent).toEqual(["ㅏ"]);

    expect(fireKeydown(h, { key: " ", keyCode: 32 })).toBe(true); // xterm 이 ' ' 전송
    fireInput(h, `ㅏ${NBSP}`);
    expect(h.sent).toEqual(["ㅏ"]); // 브리지는 공백을 더 보내지 않는다
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

  test("Enter 는 xterm 이 CR 을 보내도록 넘긴다", () => {
    fireInput(h, "가");
    expect(fireKeydown(h, { key: "Enter", keyCode: 13 })).toBe(true);
  });

  test("⌘·Ctrl 조합은 에코 기록 대상이 아니다", () => {
    expect(fireKeydown(h, { key: "v", keyCode: 86, metaKey: true })).toBe(true);
    fireInput(h, "v"); // 붙여넣기 등으로 올라온 'v' 는 에코가 아니라 실제 입력
    expect(h.sent).toEqual(["v"]);
  });
});
