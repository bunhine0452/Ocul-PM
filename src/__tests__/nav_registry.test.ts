import { describe, expect, it } from "vitest";
import {
  NAV_DESTINATIONS,
  NAV_ENTRIES,
  NAV_SHORTCUT_KEYS,
  navRowViews,
  navShortcutLabel,
  navViewForKey,
} from "@/lib/navRegistry";
import { UI_V2_VIEWS } from "@/contexts/uiV2View";

// v2 U1 (docs/20260706_v2/01-ux-spec.md §1) — 내비 단일 소스 계약.
// 팔레트 화면 누락 / ⌘번호·사이드바 순서 불일치가 재발하면 여기서 잡힌다.

describe("navRegistry", () => {
  it("사이드바 행의 id 가 유일하다", () => {
    const ids = NAV_ENTRIES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("main 5 + tools 1 + ai 1 + ref 1 = 8행 (2026-10-28 보류 등급 제거 반영)", () => {
    // main 의 다섯 번째는 「브랜치의 이야기」.
    expect(NAV_ENTRIES.filter((e) => e.group === "main")).toHaveLength(5);
    // 검색만 — 터미널·편집기는 2026-10-28 에 걷었다 (simplify-round).
    expect(NAV_ENTRIES.filter((e) => e.group === "tools")).toHaveLength(1);
    // 스킬만 — 에이전트 두 화면·AI 패널도 같은 날 걷었다.
    expect(NAV_ENTRIES.filter((e) => e.group === "ai")).toHaveLength(1);
    // 참고에 남은 것은 논의 하나 — 문서 화면은 2026-09-08 에 사라졌다.
    expect(NAV_ENTRIES.filter((e) => e.group === "ref")).toHaveLength(1);
    expect(NAV_ENTRIES).toHaveLength(8);
  });

  it("⌘번호는 배열(=사이드바 표시) 순서를 그대로 따른다", () => {
    NAV_SHORTCUT_KEYS.forEach((key, idx) => {
      expect(navViewForKey(key)).toBe(NAV_ENTRIES[idx]?.id);
    });
  });

  /**
   * 번호가 걸린 **앞 10칸을 못 박는다.**
   *
   * 새 화면을 목록 중간에 끼우면 ⌘번호가 통째로 밀리는데, 개수만 세는 위
   * 테스트는 그걸 통과시킨다. 여기 배열이 바뀌면 사용자의 손가락이 기억하는
   * 번호가 바뀐 것이므로, 일부러 고칠 때만 고친다 —
   * 그때는 `NavRemapNotice` 로 한 번 안내한다.
   */
  it("⌘번호가 걸린 칸은 고정이다 — 여덟 화면 전부 번호를 받는다", () => {
    expect(NAV_ENTRIES.slice(0, NAV_SHORTCUT_KEYS.length).map((e) => e.id)).toEqual([
      "today",
      "journal",
      "diff",
      "planner",
      "search",
      "skills",
      "discussion",
      "branch",
    ]);
  });

  it("재편에서 뜻이 그대로인 번호 셋 (⌘1·⌘2·⌘4)", () => {
    expect(navViewForKey("1")).toBe("today");
    expect(navViewForKey("2")).toBe("journal");
    expect(navViewForKey("4")).toBe("planner");
  });

  it("보류 등급이 빠지며 ⌘6 부터 당겨졌다 — 스킬 ⌘6 · 논의 ⌘7 · 브랜치 ⌘8, ⌘9·⌘0 은 빈다", () => {
    expect(navShortcutLabel("search")).toBe("⌘5");
    expect(navShortcutLabel("skills")).toBe("⌘6");
    expect(navShortcutLabel("discussion")).toBe("⌘7");
    expect(navShortcutLabel("branch")).toBe("⌘8");
    expect(navViewForKey("9")).toBeUndefined();
    expect(navViewForKey("0")).toBeUndefined();
  });

  it("번호 없는 키 입력은 undefined (⌘\\ 등 다른 핸들러로 폴스루)", () => {
    expect(navViewForKey("\\")).toBeUndefined();
    expect(navViewForKey("k")).toBeUndefined();
  });
});

describe("navRegistry — 팔레트 목적지", () => {
  it("갈래를 가진 행은 없다 — 에이전트 두 화면은 2026-10-28 에 걷었다", () => {
    expect(NAV_ENTRIES.filter((e) => e.children)).toHaveLength(0);
    expect(NAV_ENTRIES.every((e) => navRowViews(e).length === 1)).toBe(true);
  });

  it("팔레트 목적지는 사이드바 행과 같다 — 여덟, 중복 없이", () => {
    const ids = NAV_DESTINATIONS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(NAV_DESTINATIONS).toHaveLength(8);
  });
});

describe("navRegistry — 화면 목록과의 정합", () => {
  it("모든 목적지가 실재하는 uiV2View 다", () => {
    for (const dest of NAV_DESTINATIONS) {
      expect(UI_V2_VIEWS).toContain(dest.id);
    }
  });

  it("설정 말고는 도달할 수 없는 화면이 없다", () => {
    const reachable = new Set(NAV_DESTINATIONS.map((e) => e.id));
    const orphans = UI_V2_VIEWS.filter((v) => v !== "settings" && !reachable.has(v));
    expect(orphans).toEqual([]);
  });
});
