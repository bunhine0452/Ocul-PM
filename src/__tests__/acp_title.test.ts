import { describe, expect, test } from "vitest";
import { resolveTitle, titleFromPrompt } from "@/features/chat/acpTitle";

describe("resolveTitle — 어댑터가 주는 제목 거르기", () => {
  test("첫 지시문의 메아리는 그대로 받아들인다", () => {
    expect(resolveTitle("탭 제목을 고쳐 줘", ["탭 제목을 고쳐 줘"])).toBe("탭 제목을 고쳐 줘");
  });

  test("나중 지시문의 메아리는 버리고 첫 지시문을 지킨다", () => {
    const prompts = ["탭 제목을 고쳐 줘", "그리고 이것도"];
    expect(resolveTitle("그리고 이것도", prompts)).toBe("탭 제목을 고쳐 줘");
  });

  test("메아리가 아닌 제목(aiTitle·/rename)은 이긴다", () => {
    const prompts = ["탭 제목을 고쳐 줘", "그리고 이것도"];
    expect(resolveTitle("ACP 세션 탭 제목 수정", prompts)).toBe("ACP 세션 탭 제목 수정");
  });

  test("보낸 것을 모르면 받은 것을 그대로 쓴다 — 삼키지 않는다", () => {
    expect(resolveTitle("무엇이든", [])).toBe("무엇이든");
    expect(resolveTitle(null, [])).toBeNull();
  });

  test("제목이 아직 없으면 첫 지시문이 임시 제목이 된다", () => {
    expect(resolveTitle(null, ["첫 마디", "둘째"])).toBe("첫 마디");
  });

  test("어댑터가 자른 제목(…)도 같은 지시문으로 알아본다", () => {
    const long = "가".repeat(300);
    const cut = titleFromPrompt(long);
    expect(cut.endsWith("…")).toBe(true);
    expect(resolveTitle(cut, [long, "나중 지시문"])).toBe(cut);
  });

  test("잘리지 않은 접두사는 같은 제목으로 치지 않는다", () => {
    // "고쳐줘" 로 시작한다고 "고쳐줘 그리고 저것도" 가 메아리인 것은 아니다.
    expect(resolveTitle("고쳐줘 그리고 저것도", ["고쳐줘", "둘째"])).toBe("고쳐줘 그리고 저것도");
  });

  test("줄바꿈이 섞인 지시문도 접어서 비교한다", () => {
    const prompts = ["첫 마디", "여러 줄\n\n지시문"];
    expect(resolveTitle("여러 줄 지시문", prompts)).toBe("첫 마디");
  });
});

describe("resolveTitle — 울트라코드", () => {
  test("키워드가 앞에 붙어 돌아온 제목도 같은 지시문으로 알아본다", () => {
    // 보낸 문장은 "ultracode\n\n둘째" 였고 화면의 지시문은 "둘째" 뿐이다.
    expect(resolveTitle("ultracode 둘째", ["첫 마디", "둘째"])).toBe("첫 마디");
  });
});
