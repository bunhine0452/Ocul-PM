// 한국어 IME 경계 사례표 (업그레이드 라운드 TI-06) — 이름은 Orca 의 사례 그대로.
//
// 진짜 xterm 위에 브리지를 붙이고(xtermHarness), 두 웹뷰의 이벤트 순서를 적어 PTY 로 나간 바이트를 문다.
//   wkwebview  macOS — 조합 이벤트 없이 input 이 keydown(229) 보다 먼저 온다 (imeBridge 머리말).
//   webview2   Windows — keydown(229) 다음 표준 조합(compositionstart/update/end · 확정은 삭제·삽입 한 쌍).
//              space-after-229 만은 Alt+V 뒤 음절째 확정 모드(조합 이벤트 0건)다 (2026-11-12 덤프).
// 합성 이벤트에는 브라우저의 기본 동작이 없다 — keydown 을 아무도 막지 않았을 때만 keypress 를 쏜다.
import { afterEach, describe, expect, it } from "vitest";

import { fireComposition, fireInput, fireKey, openRealTerm, type RealTerm } from "./xtermHarness";

const DEL = "\x7f";
const NBSP = "\xa0";
// 사례의 글자 — 소스에 완성형을 쓰지 않는다(lint:i18n). 주석이 읽는 법이다.
const GA = "\u{ac00}"; // 가
const GAM = "\u{ac10}"; // 감
const MA = "\u{b9c8}"; // 마
const DI = "\u{b514}"; // 디
const SSA = "\u{c2f8}"; // 싸
const WON = "\u{20a9}"; // ₩

/** PTY 가 받은 순서대로 DEL 을 적용한 입력줄. */
function line(data: string[]): string {
  let out = "";
  for (const ch of data.join("")) out = ch === DEL ? out.slice(0, -1) : out + ch;
  return out;
}

type Model = "wkwebview" | "webview2";

let rt: RealTerm;
afterEach(() => rt.dispose());

const ime = (key: string, extra: KeyboardEventInit = {}) => fireKey(rt, "keydown", { key, keyCode: 229, ...extra });
const compose = (prefix: string, text: string) => {
  fireComposition(rt, "compositionupdate", text);
  fireInput(rt, prefix + text, "insertCompositionText");
};
/** 표준 모델의 확정 — 조합 글자를 빼고(삭제) 같은 글자를 확정 텍스트로 다시 넣는다. */
const commit = (value: string, syllable: string) => {
  fireInput(rt, value.slice(0, -syllable.length), "deleteCompositionText");
  fireInput(rt, value, "insertFromComposition");
  fireComposition(rt, "compositionend", syllable);
};
/** 아무도 keydown 을 막지 않았으면 브라우저가 keypress 를 쏜다. */
const typeKey = (key: string, code: string, keyCode: number) => {
  const down = fireKey(rt, "keydown", { key, code, keyCode });
  if (!down.defaultPrevented) fireKey(rt, "keypress", { key, code, keyCode, charCode: key.charCodeAt(0) });
};

describe.each<Model>(["wkwebview", "webview2"])("IME cases on %s", (model) => {
  it("korean-enter-commit-order: the syllable reaches the PTY before the CR", () => {
    rt = openRealTerm();
    if (model === "wkwebview") {
      fireInput(rt, "ㄱ");
      ime("ㄱ");
      fireInput(rt, GA, "insertReplacementText");
      ime("ㅏ");
    } else {
      ime("Process");
      fireComposition(rt, "compositionstart", "");
      compose("", "ㄱ");
      ime("Process");
      compose("", GA);
      ime("Process"); // 조합 중의 Enter — 입력기가 「가」 를 확정한 뒤 진짜 Enter 가 다시 온다
      commit(GA, GA);
    }
    fireKey(rt, "keydown", { key: "Enter", code: "Enter", keyCode: 13 });
    expect(rt.data.join("")).toBe(`ㄱ${DEL}${GA}\r`);
  });

  it("digit-after-commit: a digit right after the syllable goes out once", () => {
    rt = openRealTerm();
    if (model === "wkwebview") {
      fireInput(rt, "ㄱ");
      ime("ㄱ");
      fireInput(rt, GA, "insertReplacementText");
      ime("ㅏ");
      typeKey("1", "Digit1", 49);
    } else {
      ime("Process");
      fireComposition(rt, "compositionstart", "");
      compose("", "ㄱ");
      ime("Process");
      compose("", GA);
      ime("Process"); // 숫자 키 — 입력기가 「가」 를 확정하고 1 을 덧붙인다
      commit(GA, GA);
      fireKey(rt, "keypress", { key: "1", code: "Digit1", keyCode: 49, charCode: 49 });
    }
    fireInput(rt, `${GA}1`);
    expect(rt.data.join("")).toBe(`ㄱ${DEL}${GA}1`);
  });

  it("won-sign-repeat: ₩ held down types one ₩ per repeat", () => {
    rt = openRealTerm();
    for (let n = 0; n < 3; n += 1) {
      if (model === "wkwebview") {
        fireInput(rt, WON);
        ime(WON, { repeat: n > 0 });
      } else {
        const down = fireKey(rt, "keydown", { key: WON, code: "Backslash", keyCode: 220, repeat: n > 0 });
        if (!down.defaultPrevented) fireKey(rt, "keypress", { key: WON, keyCode: 220, charCode: 0x20a9 });
        fireInput(rt, WON);
      }
    }
    expect(line(rt.data)).toBe(WON.repeat(3));
  });

  // 감 + ㅏ = 가마
  it("batchim-carry: the final consonant moves on to the next syllable", () => {
    rt = openRealTerm();
    if (model === "wkwebview") {
      fireInput(rt, "ㄱ");
      ime("ㄱ");
      fireInput(rt, GA, "insertReplacementText");
      ime("ㅏ");
      fireInput(rt, GAM, "insertReplacementText");
      ime("ㅁ");
      fireInput(rt, `${GA}${MA}`, "insertReplacementText");
      ime("ㅏ");
    } else {
      ime("Process");
      fireComposition(rt, "compositionstart", "");
      compose("", "ㄱ");
      ime("Process");
      compose("", GA);
      ime("Process");
      compose("", GAM);
      ime("Process"); // ㅏ — 「가」 를 확정하고 「마」 로 새 조합을 연다
      commit(GA, GA);
      fireComposition(rt, "compositionstart", "");
      compose(GA, MA);
    }
    expect(line(rt.data)).toBe(`${GA}${MA}`);
    expect(rt.data.join("")).toBe(`ㄱ${DEL}${GA}${DEL}${GAM}${DEL}${GA}${MA}`);
  });

  it("double-consonant: Shift+ㅅ composes ㅆ and the Shift key itself sends nothing", () => {
    rt = openRealTerm();
    fireKey(rt, "keydown", { key: "Shift", code: "ShiftLeft", keyCode: 16, shiftKey: true });
    if (model === "wkwebview") {
      fireInput(rt, "ㅆ");
      ime("ㅆ", { shiftKey: true });
      fireKey(rt, "keyup", { key: "Shift", code: "ShiftLeft", keyCode: 16 });
      fireInput(rt, SSA, "insertReplacementText");
      ime("ㅏ");
    } else {
      ime("Process", { shiftKey: true });
      fireComposition(rt, "compositionstart", "");
      compose("", "ㅆ");
      fireKey(rt, "keyup", { key: "Shift", code: "ShiftLeft", keyCode: 16 });
      ime("Process");
      compose("", SSA);
    }
    expect(rt.data.join("")).toBe(`ㅆ${DEL}${SSA}`);
  });

  it("space-after-229: the space after a committed syllable goes out once", () => {
    rt = openRealTerm();
    if (model === "wkwebview") {
      fireInput(rt, "ㄷ");
      ime("ㄷ");
      fireInput(rt, DI, "insertReplacementText");
      ime("ㅣ");
      typeKey(" ", "Space", 32);
    } else {
      // Alt+V 뒤 음절째 확정 모드 — 조합 이벤트 없이 229 몇 번 뒤 「디」, 스페이스도 229 로 온다.
      ime("Process");
      ime("Process");
      fireInput(rt, DI);
      ime("Process");
      // 예전에는 이 keypress 를 xterm 이 보내고 input 으로 브리지가 또 보내 「디  」 였다.
      fireKey(rt, "keypress", { key: " ", code: "Space", keyCode: 32, charCode: 32 });
    }
    fireInput(rt, `${DI}${NBSP}`);
    expect(line(rt.data)).toBe(`${DI} `);
    expect(rt.data.join("").split(" ").length - 1).toBe(1);
  });
});
