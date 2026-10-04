// 파일 이름을 바꾸면 찍어 둔 중단점이 따라간다 (2026-10-04).
//
// 백엔드 저장소는 `code_rename` 이 옮기고, 거터가 읽는 프런트 지도는 이 함수가
// 같은 규칙으로 옮긴다 — 그 전에는 이름을 바꾼 파일의 중단점이 거터에서
// 사라졌고, 다음 디버그 세션이 없는 경로로 중단점을 보냈다.
import { describe, expect, it } from "vitest";
import { remapPathKeys } from "@/features/code/fileOps";

describe("remapPathKeys — 경로 키가 이름 바꾸기를 따라간다", () => {
  it("파일 하나", () => {
    const before = new Map([
      ["src/a.rs", [3, 9]],
      ["src/b.rs", [1]],
    ]);
    const after = remapPathKeys(before, "src/a.rs", "src/z.rs", false);
    expect([...after.entries()].sort()).toEqual([
      ["src/b.rs", [1]],
      ["src/z.rs", [3, 9]],
    ]);
    expect(before.has("src/a.rs")).toBe(true); // 원본은 그대로
  });

  it("폴더면 그 아래 전부, 이름이 겹치는 형제는 아니다", () => {
    const before = new Map([
      ["src/a.rs", [1]],
      ["src/deep/b.rs", [2]],
      ["srcx/c.rs", [3]],
    ]);
    const after = remapPathKeys(before, "src", "lib", true);
    expect([...after.keys()].sort()).toEqual(["lib/a.rs", "lib/deep/b.rs", "srcx/c.rs"]);
  });

  it("해당 키가 없으면 같은 지도를 돌려준다 (렌더를 깨우지 않는다)", () => {
    const before = new Map([["src/a.rs", [1]]]);
    expect(remapPathKeys(before, "src/zz.rs", "src/yy.rs", false)).toBe(before);
  });
});
