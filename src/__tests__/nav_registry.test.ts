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
   * 4.0 의 탭 다섯을 **순서까지** 못 박는다 — 오늘 · 작업 일지 · 계획 · 변경 · 터미널.
   * 순서가 곧 ⌘1~⌘5 라서, 여기 배열이 바뀌면 손가락이 기억하는 번호가 바뀐 것이다.
   * 터미널은 10-28 에 걷었다가 10-29 에 앱 안 세션으로 돌아왔다 — 맨 뒤라 앞 넷의 번호는 그대로다.
   */
  it("탭은 다섯 — 오늘 · 작업 일지 · 계획 · 변경 · 터미널", () => {
    expect(NAV_ENTRIES.map((e) => e.id)).toEqual(["today", "journal", "planner", "diff", "terminal"]);
  });

  it("⌘1~⌘5 는 배열(=윗줄 표시) 순서를 그대로 따른다", () => {
    expect(NAV_SHORTCUT_KEYS).toEqual(["1", "2", "3", "4", "5"]);
    NAV_SHORTCUT_KEYS.forEach((key, idx) => {
      expect(navViewForKey(key)).toBe(NAV_ENTRIES[idx]?.id);
    });
    expect(navShortcutLabel("planner")).toBe("⌘3");
    expect(navShortcutLabel("diff")).toBe("⌘4");
    expect(navShortcutLabel("terminal")).toBe("⌘5");
  });

  it("번호 없는 키 입력은 undefined — ⌘6 부터는 아무 화면도 아니다", () => {
    for (const key of ["6", "9", "0", "\\", "k"]) expect(navViewForKey(key)).toBeUndefined();
    // 설정은 ⌘, 다 — 번호를 받지 않는다.
    expect(navShortcutLabel("settings")).toBeUndefined();
  });
});

describe("navRegistry — 화면 목록과의 정합", () => {
  it("화면은 여섯 — 탭 다섯 + 설정", () => {
    expect([...UI_V2_VIEWS]).toEqual(["today", "journal", "planner", "diff", "terminal", "settings"]);
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
    for (const gone of ["search", "skills", "discussion", "branch", "code"]) {
      expect(migrateUiV2View(gone)).toBe("today");
    }
    expect(migrateUiV2View("planner")).toBe("planner");
    // 터미널은 돌아왔다 — 저장된 값이 그대로 산다.
    expect(migrateUiV2View("terminal")).toBe("terminal");
  });
});
