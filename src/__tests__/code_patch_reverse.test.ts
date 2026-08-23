// 패치 역적용 — "에이전트가 바꾼 부분" 인라인 비교의 원본을 만드는 순수 함수.
//
// 여기서 지키는 것은 **정직한 실패**다: 파일이 그 일지 이후로 더 바뀌어 문맥이
// 안 맞으면 대충 물리지 말고 null — 거짓 비교가 가장 나쁘다.
import { describe, expect, it } from "vitest";
import { parseHunks, reverseApplyPatch } from "@/features/code/patchReverse";

/** git 이 만드는 모양 그대로의 패치 헬퍼. */
function patch(...hunks: string[]): string {
  return [
    "diff --git a/src/x.ts b/src/x.ts",
    "index 111..222 100644",
    "--- a/src/x.ts",
    "+++ b/src/x.ts",
    ...hunks,
  ].join("\n");
}

describe("reverseApplyPatch", () => {
  it("추가를 걷어내면 이전 내용이 나온다", () => {
    const current = ["a", "새 줄", "b", "c"].join("\n");
    const p = patch("@@ -1,3 +1,4 @@", " a", "+새 줄", " b", " c");
    expect(reverseApplyPatch(current, p)).toBe(["a", "b", "c"].join("\n"));
  });

  it("삭제를 되살리고 수정을 되돌린다", () => {
    const current = ["a", "고친 줄", "c"].join("\n");
    const p = patch("@@ -1,4 +1,3 @@", " a", "-원래 줄", "-지워진 줄", "+고친 줄", " c");
    expect(reverseApplyPatch(current, p)).toBe(["a", "원래 줄", "지워진 줄", "c"].join("\n"));
  });

  it("헝크 여러 개는 아래에서 위로 물린다 (줄 번호가 안 밀리게)", () => {
    const current = ["A1", "top", "A2", "B1", "bottom", "B2"].join("\n");
    const p = patch(
      "@@ -1,2 +1,3 @@",
      " A1",
      "+top",
      " A2",
      "@@ -3,2 +4,3 @@",
      " B1",
      "+bottom",
      " B2",
    );
    expect(reverseApplyPatch(current, p)).toBe(["A1", "A2", "B1", "B2"].join("\n"));
  });

  it("앞선 변경으로 줄이 밀렸어도 문맥이 정확히 맞으면 찾아낸다", () => {
    // 패치는 2행이라 말하지만 실제로는 위에 다른 줄이 끼어 4행에 있다.
    const current = ["끼어든1", "끼어든2", "a", "새 줄", "b"].join("\n");
    const p = patch("@@ -1,2 +1,3 @@", " a", "+새 줄", " b");
    expect(reverseApplyPatch(current, p)).toBe(["끼어든1", "끼어든2", "a", "b"].join("\n"));
  });

  it("문맥이 현재 내용과 안 맞으면 null — 대충 물리지 않는다", () => {
    // 일지 이후에 "b" 가 "B" 로 바뀌었다 → 그 일지의 변경을 겹쳐 볼 수 없다.
    const current = ["a", "새 줄", "B"].join("\n");
    const p = patch("@@ -1,2 +1,3 @@", " a", "+새 줄", " b");
    expect(reverseApplyPatch(current, p)).toBeNull();
  });

  it("빈 패치·못 읽는 패치는 null", () => {
    expect(reverseApplyPatch("x", "")).toBeNull();
    expect(reverseApplyPatch("x", "이건 패치가 아니다")).toBeNull();
  });

  it("'No newline' 표식은 건너뛴다", () => {
    const current = ["a", "b"].join("\n");
    const p = patch("@@ -1,1 +1,2 @@", " a", "+b", "\\ No newline at end of file");
    expect(reverseApplyPatch(current, p)).toBe("a");
  });

  it("parseHunks 는 생략형 헤더(@@ -1 +1 @@)도 읽는다", () => {
    const hunks = parseHunks(patch("@@ -1 +1 @@", "-x", "+y"));
    expect(hunks).toHaveLength(1);
    expect(hunks![0]).toMatchObject({ newStart: 1, newLines: ["y"], oldLines: ["x"] });
  });
});
