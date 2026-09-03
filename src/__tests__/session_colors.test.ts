import { describe, expect, test } from "vitest";
import {
  SESSION_COLORS,
  isSessionColor,
  sessionColorStyle,
  sessionColorVar,
} from "@/lib/sessionColors";

// 세션 정체 색 (2026-09-04). 지키는 것은 셋이다: 저장되는 값은 hex 가 아니라
// **토큰을 가리키는 이름**이고(테마를 따라가야 한다), 상태색과 겹치지 않으며,
// 안 고른 세션은 스타일이 아예 안 붙는다(예전 모습 그대로).

describe("sessionColors", () => {
  test("상태색과 겹치지 않는다 — 초록(완료)·노랑(기다림)은 팔레트에 없다", () => {
    expect(SESSION_COLORS).not.toContain("green");
    expect(SESSION_COLORS).not.toContain("yellow");
  });

  test("hex 가 아니라 토큰을 가리킨다 — 테마를 바꿔도 고른 의미가 남는다", () => {
    for (const color of SESSION_COLORS) {
      expect(sessionColorVar(color)).toBe(`var(--term-${color})`);
    }
  });

  test("모르는 값은 색이 아니다 — 옛 설정·손으로 고친 파일 방어", () => {
    expect(isSessionColor("blue")).toBe(true);
    expect(isSessionColor("green")).toBe(false);
    expect(isSessionColor("#ff0000")).toBe(false);
    expect(isSessionColor(undefined)).toBe(false);
    expect(isSessionColor(null)).toBe(false);
    expect(isSessionColor(7)).toBe(false);
  });

  test("안 고른 세션에는 스타일을 붙이지 않는다", () => {
    // 빈 객체를 돌려주면 매 렌더 새 객체라 React 가 style 을 계속 다시 쓴다.
    expect(sessionColorStyle(undefined)).toBeUndefined();
    expect(sessionColorStyle(null)).toBeUndefined();
    expect(sessionColorStyle("green" as never)).toBeUndefined();
  });

  test("고른 세션은 `--sess` 하나만 얹는다 — CSS 가 기본값을 소유한다", () => {
    expect(sessionColorStyle("magenta")).toEqual({ "--sess": "var(--term-magenta)" });
  });
});
