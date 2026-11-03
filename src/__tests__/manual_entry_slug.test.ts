// 일지 직접 쓰기 (화면 검사 11-03) — 파일 이름(slug)을 사람이 꼭 지어야 하던 칸을 제목에서 짓는다.
import { describe, expect, it } from "vitest";
import { slugFromTitle } from "@/features/oculpm/ManualEntryModalV2";

describe("slugFromTitle", () => {
  it("제목의 영문 · 숫자 낱말을 잇는다", () => {
    expect(slugFromTitle("Export param mismatch")).toBe("export-param-mismatch");
    expect(slugFromTitle("터미널: ⌘W 가 세션부터 닫는다 v2")).toBe("w-v2");
  });

  it("한글뿐이면 note", () => {
    expect(slugFromTitle("창: 프로젝트 색을 입힌다")).toBe("note");
    expect(slugFromTitle("")).toBe("note");
  });

  it("백엔드 규칙(소문자 · 숫자 · - · 60자)을 늘 지킨다", () => {
    const long = slugFromTitle("a ".repeat(80));
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long).toMatch(/^[a-z0-9-]{1,60}$/);
    expect(long.endsWith("-")).toBe(false);
  });
});
