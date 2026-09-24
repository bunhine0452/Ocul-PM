import { afterEach, describe, expect, it } from "vitest";

import { __resetLangForTests, setLangSetting } from "@/i18n";
import { tError } from "@/i18n/errors";

// 백엔드 에러 매핑 계약 (docs/20260811_three-features/03-i18n.md §4.4).
//
// Rust 는 영어만 반환하고 프런트가 되돌린다. 이 설계의 안전판은 **매칭 실패가
// 곧 폴백**이라는 점이다 — 표에 없는 에러가 와도 영어 원문이 보일 뿐 깨지지
// 않는다. 그 계약이 무너지면(빈 문자열·throw·`undefined`) 사용자는 실패 이유를
// 영영 못 본다. 그래서 폴백을 가장 촘촘히 덮는다.

afterEach(() => {
  __resetLangForTests();
});

describe("tError — 한국어 모드", () => {
  it("알려진 문구를 한국어로 되돌린다", () => {
    setLangSetting("ko");
    expect(tError("Enter a title.")).toBe("제목을 입력하세요.");
  });

  it("캡처 그룹이 자리표시자로 들어간다", () => {
    setLangSetting("ko");
    expect(tError("No API key configured for anthropic")).toBe(
      "anthropic API 키가 설정되지 않았어요",
    );
    expect(tError("Skill not found: my-skill")).toBe("스킬을 찾을 수 없어요: my-skill");
  });

  it("앞뒤 공백이 있어도 매칭된다", () => {
    setLangSetting("ko");
    expect(tError("  Enter a title.  ")).toBe("제목을 입력하세요.");
  });

  it("모르는 문구는 원문 그대로 (표가 비어도 앱은 정상)", () => {
    setLangSetting("ko");
    const unknown = "Could not read the rule file: No such file or directory (os error 2)";
    expect(tError(unknown)).toBe(unknown);
  });

  it("부분 일치로 오작동하지 않는다 — 앵커가 걸려 있다", () => {
    setLangSetting("ko");
    // "Enter a title." 를 포함하지만 다른 문장이면 번역하지 않는다.
    const longer = "Enter a title. And also something else happened.";
    expect(tError(longer)).toBe(longer);
  });
});

describe("tError — 크로스플랫폼 고정 문구 ({#ui-followups})", () => {
  it("Linux 키링 부재 — 호출부가 앞에 문맥을 붙여도 문장 안에서 찾는다", () => {
    setLangSetting("ko");
    const raw =
      "The system keyring is unavailable — install and unlock a Secret Service provider (GNOME Keyring or KWallet), then try again. Keys are never saved in plain text. (Platform secure storage failure: …)";
    const guide = "시스템 키링을 쓸 수 없어요 — Secret Service 제공자(GNOME 키링이나 KWallet)를 설치하고 잠금을 푼 뒤 다시 시도하세요. 키는 평문으로 저장하지 않아요.";
    expect(tError(raw)).toBe(guide);
    expect(tError(`Could not save to the keychain: ${raw}`)).toBe(guide);
  });

  it("Linux 파일 붙여넣기 · Windows 클립보드 점유", () => {
    setLangSetting("ko");
    expect(
      tError("Pasting copied files is not available on Linux — drag the files into the tree instead."),
    ).toBe("Linux 에서는 복사한 파일을 붙여넣을 수 없어요 — 파일을 트리로 끌어다 놓으세요.");
    expect(tError("The clipboard is busy in another app — try pasting again.")).toBe(
      "다른 앱이 클립보드를 쓰고 있어요 — 다시 붙여넣어 보세요.",
    );
  });

  it("macOS 키체인 원문(keyring 오류)은 건드리지 않는다", () => {
    setLangSetting("ko");
    const mac = "Platform secure storage failure: User canceled the operation.";
    expect(tError(mac)).toBe(mac);
  });
});

describe("tError — 영어 모드", () => {
  it("원문을 그대로 돌려준다 (이미 영어라 매칭할 이유가 없다)", () => {
    setLangSetting("en");
    expect(tError("Enter a title.")).toBe("Enter a title.");
    expect(tError("No API key configured for openai")).toBe("No API key configured for openai");
  });
});

describe("tError — 방어", () => {
  it("빈 문자열은 그대로", () => {
    setLangSetting("ko");
    expect(tError("")).toBe("");
  });
});
