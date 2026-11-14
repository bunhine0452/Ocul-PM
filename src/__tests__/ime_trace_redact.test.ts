// IME 진단 덤프에 입력 내용은 한글만 남긴다 (업그레이드 라운드 TI-05).
//
// 링은 모든 keydown 의 key 와 PTY 로 간 짧은 입력(termStore 의 pty-write)을 담는다. 그대로 비우면
// sudo 비밀번호가 한 글자씩 oculpm.log 에 남았다 — 이 덤프는 사용자에게 보내 달라고 하는 물건이다.
import { afterEach, describe, expect, it, vi } from "vitest";

const info = vi.fn();
vi.mock("@/lib/oculpmLog", () => ({
  oculpmLog: { info: (...a: unknown[]) => info(...a), warn: () => {}, error: () => {}, flow: () => {} },
}));

const { dumpImeTrace, pushImeTrace, shapeImeDetail } = await import("@/features/terminal/imeTrace");
const { t } = await import("@/i18n");
const { fireInput, fireKey, openRealTerm } = await import("./xtermHarness");

afterEach(() => {
  dumpImeTrace("cleanup");
  info.mockClear();
});

const dumped = () => info.mock.calls.map((c) => String(c[1])).join("\n");

// 시험의 글자 — 소스에 완성형을 쓰지 않는다(lint:i18n). 주석이 읽는 법이다.
const GA = "\u{ac00}"; // 가
const HAN = "\u{d55c}"; // 한
const DI = "\u{b514}"; // 디
const MASK = "\u{b7}"; // ·
const NBSP = "\xa0";

describe("the IME trace keeps Hangul only", () => {
  it("a typed password leaves only dots; Hangul, spaces and named keys stay", () => {
    const rt = openRealTerm();
    // termStore 의 onData 그대로 — PTY 로 간 8자 이하 입력을 링에 남긴다(termStore.ts 는 그대로).
    rt.term.onData((data) => {
      if (data.length <= 8) pushImeTrace("pty-write", { data: JSON.stringify(data) });
    });
    for (const ch of "pass1234") {
      const code = /\d/.test(ch) ? `Digit${ch}` : `Key${ch.toUpperCase()}`;
      fireKey(rt, "keydown", { key: ch, code, keyCode: ch.toUpperCase().charCodeAt(0) });
    }
    fireKey(rt, "keydown", { key: "Backspace", code: "Backspace", keyCode: 8 });
    fireKey(rt, "keydown", { key: " ", code: "Space", keyCode: 32 });
    fireInput(rt, "\u{314e}"); // ㅎ
    fireInput(rt, HAN, "insertReplacementText");
    rt.dispose();

    dumpImeTrace("manual");
    const text = dumped();
    expect(text).toContain(t("terminal.imeTrace.redacted"));
    expect(text).not.toContain("pass");
    expect(text).not.toContain("1234");
    // 비밀번호 글자가 하나라도 값으로 남지 않는다 — key 도, PTY 로 간 글자도.
    expect(text).not.toMatch(/"[pas1-4]"|\\"[pas1-4]\\"/);
    // keyCode 로도 드러나지 않는다(80 = P).
    expect(text).not.toMatch(/"keyCode":(80|65|83|49|50|51|52)\b/);
    expect(text).toContain(MASK);
    expect(text).toContain('"key":"Backspace"');
    expect(text).toContain('"keyCode":8');
    expect(text).toContain("DEL"); // Backspace 가 PTY 로 보낸 0x7f 의 이름
    expect(text).toContain(HAN);
    expect(text).toContain("\u{314e}");
    expect(text).toContain('"inputType":"insertReplacementText"');
  });

  it("names control bytes and masks other scripts", () => {
    expect(shapeImeDetail({ data: JSON.stringify("\x03\r\x1b[A") })).toEqual({ data: `"^C^M^[${MASK}${MASK}"` });
    expect(shapeImeDetail({ value: `${GA}a${NBSP}b\u{3131}` })).toEqual({ value: `${GA}${MASK}${NBSP}${MASK}\u{3131}` });
    expect(shapeImeDetail({ key: "Process", keyCode: 229, isComposing: false })).toEqual({
      key: "Process",
      keyCode: 229,
      isComposing: false,
    });
    expect(shapeImeDetail({ key: "A", charCode: 65 })).toEqual({ key: MASK, charCode: MASK });
    expect(shapeImeDetail({ key: DI, charCode: 0xb514 })).toEqual({ key: DI, charCode: 0xb514 });
  });
});
