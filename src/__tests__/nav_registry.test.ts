import { describe, expect, it } from "vitest";
import {
  NAV_DESTINATIONS,
  NAV_ENTRIES,
  NAV_SHORTCUT_KEYS,
  navShortcutLabel,
  navViewForKey,
} from "@/lib/navRegistry";
import { migrateUiV2View, UI_V2_VIEWS } from "@/contexts/uiV2View";

// 내비 단일 소스 계약 (v2 U1 → 4.0). 팔레트 화면 누락 / ⌘번호·사이드바 순서
// 불일치가 재발하면 여기서 잡힌다.

describe("navRegistry", () => {
  it("사이드바 행의 id 가 유일하다", () => {
    const ids = NAV_ENTRIES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * 4.0 의 행 넷을 **순서까지** 못 박는다 — 오늘 · 작업 일지 · 계획 · 변경.
   * 순서가 곧 ⌘1~⌘4 라서, 여기 배열이 바뀌면 손가락이 기억하는 번호가 바뀐 것이다.
   */
  it("행은 넷 — 오늘 · 작업 일지 · 계획 · 변경", () => {
    expect(NAV_ENTRIES.map((e) => e.id)).toEqual(["today", "journal", "planner", "diff"]);
  });

  it("⌘1~⌘4 는 배열(=사이드바 표시) 순서를 그대로 따른다", () => {
    expect(NAV_SHORTCUT_KEYS).toEqual(["1", "2", "3", "4"]);
    NAV_SHORTCUT_KEYS.forEach((key, idx) => {
      expect(navViewForKey(key)).toBe(NAV_ENTRIES[idx]?.id);
    });
    expect(navShortcutLabel("planner")).toBe("⌘3");
    expect(navShortcutLabel("diff")).toBe("⌘4");
  });

  it("번호 없는 키 입력은 undefined — ⌘5 부터는 아무 화면도 아니다", () => {
    for (const key of ["5", "9", "0", "\\", "k"]) expect(navViewForKey(key)).toBeUndefined();
    // 설정은 ⌘, 다 — 번호를 받지 않는다.
    expect(navShortcutLabel("settings")).toBeUndefined();
  });
});

describe("navRegistry — 화면 목록과의 정합", () => {
  it("화면은 다섯 — 행 넷 + 설정", () => {
    expect([...UI_V2_VIEWS]).toEqual(["today", "journal", "planner", "diff", "settings"]);
  });

  it("팔레트 목적지는 사이드바 행과 같고, 모두 실재하는 화면이다", () => {
    expect(NAV_DESTINATIONS).toEqual(NAV_ENTRIES);
    for (const dest of NAV_DESTINATIONS) expect(UI_V2_VIEWS).toContain(dest.id);
  });

  it("설정 말고는 도달할 수 없는 화면이 없다", () => {
    const reachable = new Set(NAV_DESTINATIONS.map((e) => e.id));
    expect(UI_V2_VIEWS.filter((v) => v !== "settings" && !reachable.has(v))).toEqual([]);
  });

  /** 4.0 에서 걷은 화면에 머물던 사용자는 오늘로 돌아온다 — 빈 본문이 아니라. */
  it("걷은 화면의 저장값은 오늘로 접힌다", () => {
    for (const gone of ["search", "skills", "discussion", "branch", "terminal", "code"]) {
      expect(migrateUiV2View(gone)).toBe("today");
    }
    expect(migrateUiV2View("planner")).toBe("planner");
  });
});
