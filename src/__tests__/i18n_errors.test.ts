import { afterEach, describe, expect, it } from "vitest";

import { __resetLangForTests, setLangSetting } from "@/i18n";
import { tError } from "@/i18n/errors";

// 백엔드 에러 매핑 계약 (docs/20260811_three-features/03-i18n.md §4.4).
//
// Rust 는 영어만 반환하고 프런트가 되돌린다. 이 설계의 안전판은 **매칭 실패가
// 곧 폴백**이라는 점이다 — 표에 없는 에러가 와도 영어 원문이 보일 뿐 깨지지
// 않는다. 그 계약이 무너지면(빈 문자열·throw·`undefined`) 사용자는 실패 이유를
// 영영 못 본다. 그래서 폴백을 가장 촘촘히 덮는다.
//
// 표는 **지금 백엔드가 실제로 내는 문구**만 든다 — 걷은 기능(LLM · API 키 · 키체인 · 편집기)의 문구는
// 호출자가 0 이라 사전에서 지웠다(11-23 love-round G3).

afterEach(() => {
  __resetLangForTests();
});

describe("tError — 한국어 모드", () => {
  it("알려진 문구를 한국어로 되돌린다", () => {
    setLangSetting("ko");
    expect(tError("Enter a phase name.")).toBe("단계 이름을 입력하세요.");
    expect(tError("No journal entries to export in this period.")).toBe("이 기간에 내보낼 일지가 없어요.");
  });

  it("캡처 그룹이 자리표시자로 들어간다", () => {
    setLangSetting("ko");
    expect(
      tError("Refusing to write through a symbolic link: notes.md"),
    ).toBe("notes.md 는 심볼릭 링크라 건드리지 않았어요. 따라가면 프로젝트 밖에 쓰게 될 수 있어요.");
  });

  it("앞뒤 공백이 있어도 매칭된다", () => {
    setLangSetting("ko");
    expect(tError("  Enter a phase name.  ")).toBe("단계 이름을 입력하세요.");
  });

  it("모르는 문구는 원문 그대로 (표가 비어도 앱은 정상)", () => {
    setLangSetting("ko");
    const unknown = "Could not read the rule file: No such file or directory (os error 2)";
    expect(tError(unknown)).toBe(unknown);
  });

  it("부분 일치로 오작동하지 않는다 — 앵커가 걸려 있다", () => {
    setLangSetting("ko");
    // "Enter a phase name." 를 포함하지만 다른 문장이면 번역하지 않는다.
    const longer = "Enter a phase name. And also something else happened.";
    expect(tError(longer)).toBe(longer);
  });
});

describe("tError — 크로스플랫폼 고정 문구 ({#ui-followups})", () => {
  it("Windows 클립보드 점유", () => {
    setLangSetting("ko");
    expect(tError("The clipboard is busy in another app — try pasting again.")).toBe(
      "다른 앱이 클립보드를 쓰고 있어요. 다시 붙여넣어 보세요.",
    );
  });

  it("macOS 키체인 원문은 건드리지 않는다", () => {
    setLangSetting("ko");
    const mac = "Platform secure storage failure: User canceled the operation.";
    expect(tError(mac)).toBe(mac);
  });
});

describe("tError — 영어 모드", () => {
  it("원문을 그대로 돌려준다 (이미 영어라 매칭할 이유가 없다)", () => {
    setLangSetting("en");
    expect(tError("Enter a phase name.")).toBe("Enter a phase name.");
  });
});

describe("tError — 방어", () => {
  it("빈 문자열은 그대로", () => {
    setLangSetting("ko");
    expect(tError("")).toBe("");
  });
});
